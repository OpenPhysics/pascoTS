import { afterEach, describe, expect, it, vi } from 'vitest';

import { BLEAdapterBase, BLEClientBase, createPascoUuid } from '@/ble/ble-adapter.js';
import { PASCOBLEDevice } from '@/device/pasco-ble-device.js';
import { PROTOCOL, ProtocolHandler } from '@/device/protocol-handler.js';
import { CommunicationError } from '@/errors.js';
import type { NotifyCallback } from '@/types/ble.js';

class FakeClient extends BLEClientBase {
  writes = 0;
  mode: 'ok' | 'bad-status' | 'wrong-service' | 'other-command' | 'fail' | 'none' = 'none';
  private _notify: NotifyCallback | null = null;

  constructor() {
    super('addr');
    this._services = [
      {
        uuid: createPascoUuid(0, 0),
        characteristics: [
          {
            uuid: createPascoUuid(0, PROTOCOL.RECV_CMD_CHAR_ID),
            handle: 0,
            properties: ['notify'],
          },
        ],
      },
    ];
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async writeGattChar(_uuid: string, _data: Uint8Array): Promise<void> {
    this.writes += 1;
    if (this.mode === 'fail') throw new Error('gatt write failed');
    if (this.mode === 'ok')
      this.emit(0, [PROTOCOL.GRSP_RESULT, 0x00, PROTOCOL.GCMD_READ_ONE_SAMPLE]);
    if (this.mode === 'bad-status') {
      this.emit(0, [PROTOCOL.GRSP_RESULT, 0x01, PROTOCOL.GCMD_READ_ONE_SAMPLE]);
    }
    if (this.mode === 'wrong-service') {
      this.emit(1, [PROTOCOL.GRSP_RESULT, 0x00, PROTOCOL.GCMD_READ_ONE_SAMPLE]);
    }
    if (this.mode === 'other-command') {
      this.emit(0, [PROTOCOL.GRSP_RESULT, 0x00, PROTOCOL.GCMD_CONTROL_NODE_CMD]);
    }
  }

  async readGattChar(): Promise<Uint8Array> {
    return new Uint8Array();
  }

  async startNotify(_uuid: string, callback: NotifyCallback): Promise<void> {
    this._notify = callback;
  }

  async stopNotify(): Promise<void> {}
  async discoverServicesAndCharacteristics(): Promise<void> {}

  emit(serviceId: number, bytes: number[]): void {
    this._notify?.(
      {
        uuid: createPascoUuid(serviceId, PROTOCOL.RECV_CMD_CHAR_ID),
        handle: serviceId,
        properties: ['notify'],
      },
      new Uint8Array(bytes),
    );
  }
}

async function listeningProtocol(client: FakeClient): Promise<ProtocolHandler> {
  const protocol = new ProtocolHandler();
  protocol.setClient(client);
  await protocol.startNotifications();
  return protocol;
}

describe('ProtocolHandler responses', () => {
  it('rejects immediately when the client is null', async () => {
    const protocol = new ProtocolHandler();
    const started = Date.now();
    await expect(
      protocol.writeAwaitCallback(0, [PROTOCOL.GCMD_READ_ONE_SAMPLE, 1], 5000),
    ).rejects.toBeInstanceOf(CommunicationError);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('resolves only a status-0 response for the same service and command', async () => {
    const client = new FakeClient();
    client.mode = 'ok';
    const protocol = await listeningProtocol(client);
    await protocol.writeAwaitCallback(0, [PROTOCOL.GCMD_READ_ONE_SAMPLE, 4], 200);
    expect(client.writes).toBe(1);
  });

  it('rejects a non-zero status instead of treating it as success', async () => {
    const client = new FakeClient();
    client.mode = 'bad-status';
    const protocol = await listeningProtocol(client);
    await expect(
      protocol.writeAwaitCallback(0, [PROTOCOL.GCMD_READ_ONE_SAMPLE, 4], 200),
    ).rejects.toThrow(/status/i);
  });

  it('does not let another service or command complete the waiter', async () => {
    const wrongService = new FakeClient();
    wrongService.mode = 'wrong-service';
    const protocol = await listeningProtocol(wrongService);
    await expect(
      protocol.writeAwaitCallback(0, [PROTOCOL.GCMD_READ_ONE_SAMPLE, 4], 20),
    ).rejects.toThrow(/timeout/i);

    const otherCommand = new FakeClient();
    otherCommand.mode = 'other-command';
    const protocol2 = await listeningProtocol(otherCommand);
    await expect(
      protocol2.writeAwaitCallback(0, [PROTOCOL.GCMD_READ_ONE_SAMPLE, 4], 20),
    ).rejects.toThrow(/timeout/i);
  });

  it('does not retry stepper commands and does retry reads', async () => {
    const client = new FakeClient();
    client.mode = 'fail';
    const protocol = new ProtocolHandler();
    protocol.setRetryOptions({
      maxRetries: 3,
      initialDelayMs: 1,
      maxDelayMs: 5,
      backoffMultiplier: 1,
    });
    protocol.setClient(client);

    await expect(
      protocol.writeAwaitCallback(0, [PROTOCOL.GCMD_CONTROL_NODE_CMD, 0x04], 200),
    ).rejects.toBeInstanceOf(CommunicationError);
    expect(client.writes).toBe(1);

    client.writes = 0;
    await expect(
      protocol.writeAwaitCallback(0, [PROTOCOL.GCMD_READ_ONE_SAMPLE, 1], 200),
    ).rejects.toBeInstanceOf(CommunicationError);
    expect(client.writes).toBe(4);
  });
});

describe('commandTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is the deadline used by writeAwaitCallback', async () => {
    vi.useFakeTimers();

    class Probe extends PASCOBLEDevice {
      constructor() {
        super(
          new (class extends BLEAdapterBase {
            async scan(): Promise<never[]> {
              return [];
            }
            async stopScan(): Promise<void> {}
            createClient(): BLEClientBase {
              throw new Error('unused');
            }
            isAvailable(): boolean {
              return false;
            }
          })(),
        );
        this._options.commandTimeout = 40;
        this._protocol.setRetryOptions({ maxRetries: 0 });
      }

      sendRead(): Promise<void> {
        const client = new FakeClient();
        this._protocol.setClient(client);
        return this.writeAwaitCallback(0, [PROTOCOL.GCMD_READ_ONE_SAMPLE, 1]);
      }
    }

    const probe = new Probe();
    let status = 'pending';
    const done = probe.sendRead().then(
      () => {
        status = 'resolved';
      },
      () => {
        status = 'rejected';
      },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(status).toBe('pending');
    await vi.advanceTimersByTimeAsync(39);
    expect(status).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(status).toBe('rejected');
  });
});
