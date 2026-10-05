/**
 * Protocol Handler
 *
 * Handles BLE communication protocol for PASCO devices.
 */

import type { BLEClientBase } from '@/ble/ble-adapter.js';
import { createPascoUuid, getServiceIdFromUuid, isPascoUuid } from '@/ble/ble-adapter.js';
import type { BLECharacteristic } from '@/types/ble.js';
import { type RetryOptions, withRetry } from '@/utils/retry.js';

import { CommunicationError } from '../errors.js';

/**
 * Protocol constants for PASCO BLE communication
 */
export const PROTOCOL = {
  SENSOR_SERVICE_ID: 0,
  SEND_CMD_CHAR_ID: 2,
  RECV_CMD_CHAR_ID: 3,
  SEND_ACK_CHAR_ID: 5,
  GCMD_CUSTOM_CMD: 0x37,
  GCMD_READ_ONE_SAMPLE: 0x05,
  GCMD_XFER_BURST_RAM: 0x0e,
  GCMD_CONTROL_NODE_CMD: 0x37,
  GRSP_RESULT: 0xc0,
  GEVT_SENSOR_ID: 0x82,
  CNTRLNODE_PLUGINS_CALLBACK: 0x82,
  CTRLNODE_CMD_DETECT_DEVICES: 8,
  WIRELESS_RMS_START: [0x37, 0x01, 0x00],
} as const;

/**
 * Handler function type for processing BLE notifications
 */
export type NotificationHandler = (serviceId: number, data: number[]) => void;

/**
 * Options for a command that waits for its matching response.
 */
export interface WriteAwaitOptions {
  /**
   * When false, a failed attempt is not sent again.
   * Defaults to true for reads and false for output/motor commands.
   */
  retry?: boolean;
}

/**
 * Control-node / code-node subcommands of 0x37 that move hardware or change outputs.
 * Retrying them can repeat a motion or a power write.
 */
const NON_IDEMPOTENT_SUBCOMMANDS = new Set<number>([
  0x02, // code.Node set one LED
  0x03, // servo, or code.Node LED matrix
  0x04, // stepper, or code.Node speaker
  0x05, // power-output signals
  0x06, // accessory transfer
  0x09, // stop accessories
  0x0a, // beeper
]);

/**
 * Reads can be repeated. Commands that move motors, servos, or outputs cannot.
 */
export function isIdempotentCommand(command: readonly number[]): boolean {
  if (command[0] !== PROTOCOL.GCMD_CONTROL_NODE_CMD) return true;
  const subcommand = command[1];
  if (subcommand === undefined) return true;
  return !NON_IDEMPOTENT_SUBCOMMANDS.has(subcommand);
}

interface PendingResponse {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Handles BLE protocol communication including notifications, commands, and acknowledgements
 */
export class ProtocolHandler {
  private _client: BLEClientBase | null = null;
  private _handleService: Map<number, number> = new Map();
  /** Waiters keyed by `${serviceId}:${commandByte}` so a late reply cannot complete a different command. */
  private _waiters: Map<string, PendingResponse[]> = new Map();
  private _onNotification: NotificationHandler | null = null;
  private _commandTimeoutMs = 5000;
  private _retryOptions: RetryOptions = {
    maxRetries: 0, // Disabled by default for backward compatibility
    initialDelayMs: 500,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
  };

  /**
   * Set the BLE client for communication
   */
  setClient(client: BLEClientBase | null): void {
    this._client = client;
    if (!client) {
      this._handleService.clear();
      this._failAllWaiters(new CommunicationError('BLE client is not connected'));
    }
  }

  /**
   * Default time to wait for a command response.
   * Used when {@link writeAwaitCallback} is called without an explicit timeout.
   */
  setCommandTimeout(timeoutMs: number): void {
    this._commandTimeoutMs = timeoutMs;
  }

  /**
   * Configure retry options for BLE operations
   * @param options Retry configuration
   */
  setRetryOptions(options: RetryOptions): void {
    this._retryOptions = { ...this._retryOptions, ...options };
  }

  /**
   * Get current retry options
   */
  getRetryOptions(): RetryOptions {
    return { ...this._retryOptions };
  }

  /**
   * Set the handler for incoming notifications
   */
  setNotificationHandler(handler: NotificationHandler): void {
    this._onNotification = handler;
  }

  /**
   * Build a mapping of characteristic handles to service IDs
   */
  buildHandleServiceMap(): void {
    if (!this._client) return;
    this._handleService.clear();

    for (const service of this._client.services) {
      for (const char of service.characteristics) {
        const serviceId = getServiceIdFromUuid(char.uuid);
        if (serviceId >= 0) {
          this._handleService.set(char.handle, serviceId);
        }
      }
    }
  }

  /**
   * Start notifications on all notifiable characteristics
   */
  async startNotifications(): Promise<void> {
    if (!this._client) return;

    for (const service of this._client.services) {
      for (const char of service.characteristics) {
        if (char.properties.includes('notify')) {
          await this._client.startNotify(char.uuid, this._handleNotify.bind(this));
        }
      }
    }
  }

  /**
   * Internal notification handler that routes to the registered handler
   */
  private _waiterKey(serviceId: number, commandByte: number): string {
    return `${serviceId}:${commandByte}`;
  }

  private _enqueueWaiter(key: string, pending: PendingResponse): void {
    const queue = this._waiters.get(key);
    if (queue) {
      queue.push(pending);
    } else {
      this._waiters.set(key, [pending]);
    }
  }

  private _removeWaiter(key: string, pending: PendingResponse): void {
    const queue = this._waiters.get(key);
    if (!queue) return;
    const index = queue.indexOf(pending);
    if (index >= 0) queue.splice(index, 1);
    if (queue.length === 0) this._waiters.delete(key);
  }

  private _takeWaiter(key: string): PendingResponse | undefined {
    const queue = this._waiters.get(key);
    if (!queue || queue.length === 0) return undefined;
    const pending = queue.shift();
    if (queue.length === 0) this._waiters.delete(key);
    return pending;
  }

  private _failAllWaiters(error: Error): void {
    const pending = [...this._waiters.values()].flat();
    this._waiters.clear();
    for (const waiter of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private _settleWaiter(serviceId: number, commandByte: number, error?: Error): void {
    const waiter = this._takeWaiter(this._waiterKey(serviceId, commandByte));
    if (!waiter) return;
    clearTimeout(waiter.timer);
    if (error) waiter.reject(error);
    else waiter.resolve();
  }

  /**
   * Service id echoed by the characteristic we wrote.
   * PASCO UUIDs carry the service digit; the handle map covers other adapters.
   */
  private _serviceIdFor(char: BLECharacteristic): number {
    if (isPascoUuid(char.uuid)) {
      const fromUuid = getServiceIdFromUuid(char.uuid);
      if (fromUuid >= 0) return fromUuid;
    }
    const mapped = this._handleService.get(char.handle);
    if (mapped !== undefined) return mapped;
    if (char.handle > 0) return char.handle;
    return 0;
  }

  private _handleNotify(char: BLECharacteristic, data: Uint8Array): void {
    const serviceId = this._serviceIdFor(char);

    // Deliver the payload before settling the waiter so plugin IDs are applied
    // before writeAwaitCallback's caller continues.
    if (this._onNotification) {
      this._onNotification(serviceId, Array.from(data));
    }

    if (data[0] === PROTOCOL.GRSP_RESULT && data[2] !== undefined) {
      const echoedCommand = data[2];
      if (data[1] === 0x00) {
        this._settleWaiter(serviceId, echoedCommand);
      } else {
        this._settleWaiter(
          serviceId,
          echoedCommand,
          new CommunicationError(
            `Command 0x${echoedCommand.toString(16)} failed with status ${data[1]}`,
          ),
        );
      }
    } else if (data[0] === PROTOCOL.GEVT_SENSOR_ID) {
      // Plugin detection is sent as [CTRLNODE_CMD_DETECT_DEVICES] and answered with 0x82,
      // which does not echo the command byte the way a 0xC0 result does.
      this._settleWaiter(serviceId, PROTOCOL.CTRLNODE_CMD_DETECT_DEVICES);
    }
  }

  /**
   * Write a command to the device (internal, without retry)
   */
  private _requireClient(): BLEClientBase {
    if (!this._client) {
      throw new CommunicationError('BLE client is not connected');
    }
    return this._client;
  }

  private async _writeInternal(serviceId: number, command: number[]): Promise<void> {
    const uuid = createPascoUuid(serviceId, PROTOCOL.SEND_CMD_CHAR_ID);
    try {
      await this._requireClient().writeGattChar(uuid, new Uint8Array(command));
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new CommunicationError(`Failed to write command to service ${serviceId}`, { cause });
    }
  }

  /**
   * Write a command to the device with optional retry
   */
  async write(serviceId: number, command: number[], options?: WriteAwaitOptions): Promise<void> {
    const allowRetry = options?.retry ?? isIdempotentCommand(command);
    if (allowRetry && this._retryOptions.maxRetries && this._retryOptions.maxRetries > 0) {
      return withRetry(() => this._writeInternal(serviceId, command), {
        ...this._retryOptions,
        isRetryable: (error) => error instanceof CommunicationError,
      });
    }
    return this._writeInternal(serviceId, command);
  }

  /**
   * Send an acknowledgement to the device (internal, without retry)
   */
  private async _sendAckInternal(serviceId: number, command: number[]): Promise<void> {
    const uuid = createPascoUuid(serviceId, PROTOCOL.SEND_ACK_CHAR_ID);
    try {
      await this._requireClient().writeGattChar(uuid, new Uint8Array(command));
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new CommunicationError(`Failed to send acknowledgement to service ${serviceId}`, {
        cause,
      });
    }
  }

  /**
   * Send an acknowledgement to the device with optional retry
   */
  async sendAck(serviceId: number, command: number[]): Promise<void> {
    if (this._retryOptions.maxRetries && this._retryOptions.maxRetries > 0) {
      return withRetry(() => this._sendAckInternal(serviceId, command), {
        ...this._retryOptions,
        isRetryable: (error) => error instanceof CommunicationError,
      });
    }
    return this._sendAckInternal(serviceId, command);
  }

  /**
   * Write a command and wait for callback response (internal, without retry)
   */
  private _writeAwaitCallbackInternal(
    serviceId: number,
    command: number[],
    timeoutMs: number,
  ): Promise<void> {
    if (!this._client) {
      return Promise.reject(new CommunicationError('BLE client is not connected'));
    }

    const commandByte = command[0] ?? -1;
    const key = this._waiterKey(serviceId, commandByte);

    return new Promise((resolve, reject) => {
      const pending: PendingResponse = {
        resolve: () => {
          clearTimeout(pending.timer);
          resolve();
        },
        reject,
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
      };
      pending.timer = setTimeout(() => {
        this._removeWaiter(key, pending);
        reject(new CommunicationError('Callback timeout'));
      }, timeoutMs);
      this._enqueueWaiter(key, pending);

      this._writeInternal(serviceId, command).catch((err) => {
        clearTimeout(pending.timer);
        this._removeWaiter(key, pending);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  /**
   * Write a command and wait for the matching status-0 response.
   * @param timeoutMs Defaults to the timeout from {@link setCommandTimeout}
   * @param options.retry Set false for commands that move hardware
   */
  async writeAwaitCallback(
    serviceId: number,
    command: number[],
    timeoutMs?: number,
    options?: WriteAwaitOptions,
  ): Promise<void> {
    const timeout = timeoutMs ?? this._commandTimeoutMs;
    const allowRetry = options?.retry ?? isIdempotentCommand(command);
    const run = () => this._writeAwaitCallbackInternal(serviceId, command, timeout);
    if (allowRetry && this._retryOptions.maxRetries && this._retryOptions.maxRetries > 0) {
      return withRetry(run, {
        ...this._retryOptions,
        isRetryable: (error) => error instanceof CommunicationError,
      });
    }
    return run();
  }
}
