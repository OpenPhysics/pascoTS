/**
 * PASCO BLE Device
 *
 * Main class for connecting to and communicating with PASCO BLE sensors.
 * This is the refactored version that delegates to specialized modules.
 */

import type { BLEAdapterBase, BLEClientBase } from '@/ble/ble-adapter.js';
import { createBLEAdapter } from '@/ble/index.js';
import type { BLEDevice } from '@/types/ble.js';
import { COMPATIBLE_DEVICES } from '@/types/device.js';
import type { Measurement, SensorChannel } from '@/types/index.js';
import { decode64 } from '@/utils/binary.js';
import { type DeviceEvents, TypedEventEmitter } from '@/utils/event-emitter.js';
import { TimeoutError, withTimeout } from '@/utils/retry.js';

import {
  BLEAlreadyConnectedError,
  BLEConnectionError,
  BLEScanFailed,
  DeviceNotConnected,
  InvalidParameter,
} from '../errors.js';
import { type ConnectionState, ConnectionStateMachine } from './connection-state.js';
import {
  createLogger,
  DEFAULT_DEVICE_OPTIONS,
  type DeviceLogger,
  type DeviceOptions,
} from './device-options.js';
import { PROTOCOL, ProtocolHandler } from './protocol-handler.js';
import { SensorManager } from './sensor-manager.js';

/**
 * PASCO BLE Device class
 *
 * Provides functionality for connecting to and reading data from PASCO BLE sensors.
 * Extends TypedEventEmitter to provide event-based notifications.
 *
 * @example
 * ```typescript
 * // Basic usage
 * const device = new PASCOBLEDevice();
 *
 * // With configuration options
 * const device = new PASCOBLEDevice({
 *   connectionTimeout: 15000,
 *   retry: { maxRetries: 3 },
 *   logLevel: 'debug',
 * });
 *
 * // Listen for events
 * device.on('connected', ({ name }) => console.log(`Connected to ${name}`));
 * device.on('data', ({ measurement, value }) => console.log(`${measurement}: ${value}`));
 * device.on('error', ({ error }) => console.error(error));
 *
 * // Connect and read data
 * const devices = await device.scan();
 * await device.connect(devices[0]);
 * ```
 */
export class PASCOBLEDevice extends TypedEventEmitter<DeviceEvents> {
  // Static constants for backward compatibility with subclasses
  protected static readonly SENSOR_SERVICE_ID = PROTOCOL.SENSOR_SERVICE_ID;
  protected static readonly SEND_CMD_CHAR_ID = PROTOCOL.SEND_CMD_CHAR_ID;
  protected static readonly RECV_CMD_CHAR_ID = PROTOCOL.RECV_CMD_CHAR_ID;
  protected static readonly SEND_ACK_CHAR_ID = PROTOCOL.SEND_ACK_CHAR_ID;
  protected static readonly GCMD_CUSTOM_CMD = PROTOCOL.GCMD_CUSTOM_CMD;
  protected static readonly GCMD_READ_ONE_SAMPLE = PROTOCOL.GCMD_READ_ONE_SAMPLE;
  protected static readonly GCMD_XFER_BURST_RAM = PROTOCOL.GCMD_XFER_BURST_RAM;
  protected static readonly GCMD_CONTROL_NODE_CMD = PROTOCOL.GCMD_CONTROL_NODE_CMD;
  protected static readonly GRSP_RESULT = PROTOCOL.GRSP_RESULT;
  protected static readonly GEVT_SENSOR_ID = PROTOCOL.GEVT_SENSOR_ID;
  protected static readonly CNTRLNODE_PLUGINS_CALLBACK = PROTOCOL.CNTRLNODE_PLUGINS_CALLBACK;
  protected static readonly CTRLNODE_CMD_DETECT_DEVICES = PROTOCOL.CTRLNODE_CMD_DETECT_DEVICES;
  protected static readonly WIRELESS_RMS_START = PROTOCOL.WIRELESS_RMS_START;

  // Configuration options
  protected _options: Required<Omit<DeviceOptions, 'logger'>>;
  protected _logger: DeviceLogger;

  // Connection state machine
  protected _stateMachine: ConnectionStateMachine;
  protected _reconnectAttempts = 0;
  protected _lastConnectedDevice: BLEDevice | null = null;

  // BLE adapter and client
  protected _adapter: BLEAdapterBase;
  protected _client: BLEClientBase | null = null;
  protected _protocol: ProtocolHandler;

  // Device info
  protected _address: string | null = null;
  protected _name: string | null = null;
  protected _serialId: string | null = null;
  protected _interfaceId: number | null = null;
  protected _devType: string | null = null;
  protected _airlinkSensorId: number | null = null;
  protected _type = 'BLE';

  // Device response data
  protected _dataPacket: number[] = [];
  protected _responseData: Uint8Array = new Uint8Array();

  // Compatible devices list
  protected _compatibleDevices: readonly string[] = COMPATIBLE_DEVICES;

  // Sensor manager
  protected _sensorManager: SensorManager;

  /**
   * Create a new PASCOBLEDevice instance.
   *
   * @param options - Configuration options or a BLE adapter for backward compatibility
   */
  constructor(options?: DeviceOptions | BLEAdapterBase) {
    super();

    // Handle backward compatibility: if an adapter is passed directly
    let adapter: BLEAdapterBase | undefined;
    let deviceOptions: DeviceOptions = {};

    if (options && typeof options === 'object' && 'scan' in options) {
      // It's a BLE adapter (has scan method)
      adapter = options as BLEAdapterBase;
    } else if (options) {
      // It's configuration options
      deviceOptions = options as DeviceOptions;
    }

    // Merge options with defaults
    this._options = { ...DEFAULT_DEVICE_OPTIONS, ...deviceOptions };
    this._logger = createLogger(this._options.logLevel, deviceOptions.logger);

    // Initialize state machine
    this._stateMachine = new ConnectionStateMachine();
    this._stateMachine.onStateChange((transition) => {
      this._logger.debug(
        `State changed: ${transition.from} -> ${transition.to}`,
        transition.reason ?? '',
      );
      this.emit('stateChange', {
        previousState: transition.from,
        newState: transition.to,
      });
    });

    this._adapter = adapter ?? createBLEAdapter();
    this._protocol = new ProtocolHandler();
    this._protocol.setNotificationHandler(this._handleNotification.bind(this));

    // Apply retry options to protocol handler
    if (this._options.retry) {
      this._protocol.setRetryOptions(this._options.retry);
    }

    this._logger.debug('PASCOBLEDevice initialized with options:', this._options);

    // Create sensor manager
    this._sensorManager = new SensorManager({
      protocolHandler: this._protocol,
      isConnected: () => this.isConnected(),
      onError: (error, context) => {
        this._logger.warn(`Async error in ${context}:`, error.message);
        this.emit('error', { error, context });
      },
    });
  }

  // ==================== Properties ====================

  get name(): string | null {
    return this._name;
  }

  get serialId(): string | null {
    return this._serialId;
  }

  get client(): BLEClientBase | null {
    return this._client;
  }

  get address(): string | null {
    return this._address;
  }

  get dataResults(): Map<string, number | null> {
    return this._sensorManager.dataResults;
  }

  get deviceSensors(): Map<string, SensorChannel> {
    return this._sensorManager.deviceSensors;
  }

  /**
   * Get current configuration options
   */
  get options(): Readonly<Required<Omit<DeviceOptions, 'logger'>>> {
    return this._options;
  }

  /**
   * Get current connection state
   */
  get connectionState(): ConnectionState {
    return this._stateMachine.state;
  }

  // ==================== Connection ====================

  /**
   * Scan for PASCO BLE devices
   * @param sensorNameFilter Optional sensor name to filter for
   * @returns Array of found BLE devices
   */
  async scan(sensorNameFilter?: string): Promise<BLEDevice[]> {
    try {
      const filters = sensorNameFilter ? [sensorNameFilter] : [...this._compatibleDevices];
      return await this._adapter.scan(filters);
    } catch {
      throw new BLEScanFailed();
    }
  }

  /**
   * Connect to a BLE device
   * @param bleDevice The device to connect to (from scan results)
   */
  async connect(bleDevice: BLEDevice): Promise<void> {
    if (!bleDevice) {
      throw new InvalidParameter();
    }

    // Check state machine - can only connect from disconnected state
    if (!this._stateMachine.canConnect) {
      if (this._stateMachine.isConnected) {
        throw new BLEAlreadyConnectedError();
      }
      throw new BLEConnectionError(
        `Cannot connect: device is in '${this._stateMachine.state}' state`,
      );
    }

    // Transition to connecting state
    this._stateMachine.transitionTo('connecting', 'connect() called');
    this._lastConnectedDevice = bleDevice;

    this._logger.info('Connecting to device:', bleDevice.name);
    this._client = this._adapter.createClient(bleDevice);

    try {
      // Create connection with timeout
      await withTimeout(
        this._client.connect(),
        this._options.connectionTimeout,
        `Connection timeout after ${this._options.connectionTimeout}ms`,
      );
    } catch (e) {
      // If the connection attempt timed out, the underlying GATT connect may
      // still be in-flight (or may have since succeeded). Proactively tear it
      // down so we don't leak a live GATT connection with no reference to it.
      try {
        await this._client?.disconnect();
      } catch {
        // Best-effort cleanup; ignore errors from disconnecting a client
        // that never finished connecting.
      }
      this._client = null;
      this._stateMachine.transitionTo('disconnected', 'connection failed');
      const error =
        e instanceof BLEConnectionError
          ? e
          : e instanceof TimeoutError
            ? new BLEConnectionError(e.message)
            : new BLEConnectionError();
      this._logger.error('Connection failed:', error.message);
      this.emit('error', { error, context: 'connect' });
      throw error;
    }

    this._setDeviceParams(bleDevice);
    this._protocol.setClient(this._client);
    this._protocol.buildHandleServiceMap();
    await this._protocol.startNotifications();

    // Special handling for Rotary Motion sensor
    if (this._devType === 'Rotary Motion') {
      await this._protocol.writeAwaitCallback(PROTOCOL.SENSOR_SERVICE_ID, [
        ...PROTOCOL.WIRELESS_RMS_START,
      ]);
    }

    await this._initializeDevice();

    // Transition to connected state
    this._stateMachine.transitionTo('connected', 'initialization complete');
    this._reconnectAttempts = 0;

    this._logger.info('Connected to device:', this._name);
    // Emit connected event
    this.emit('connected', { name: this._name, address: this._address });
  }

  /**
   * Connect to a device using its 6-digit ID
   * @param pascoDeviceId The device's 6-digit ID, e.g. '481-782' (the dash is optional)
   */
  async connectById(pascoDeviceId: string): Promise<void> {
    const digits = (pascoDeviceId ?? '').trim().replace('-', '');
    if (!/^\d{6}$/.test(digits)) {
      throw new InvalidParameter(
        `Invalid device ID '${pascoDeviceId}': expected 6 digits such as '481-782'`,
      );
    }
    const deviceId = `${digits.slice(0, 3)}-${digits.slice(3)}`;

    if (this._client !== null) {
      throw new BLEAlreadyConnectedError();
    }

    try {
      // Device names look like '{DeviceType} {SerialId}-{InterfaceId}' and Web Bluetooth
      // can only match name prefixes, so filter on '{DeviceType} {SerialId}' for each type.
      const filters = this._compatibleDevices.map((type) => `${type} ${deviceId}`);
      const foundDevices = await this._adapter.scan(filters);
      const device = foundDevices.find((d) => d.name?.includes(deviceId));
      if (device) {
        await this.connect(device);
      } else {
        throw new BLEConnectionError(`Device with ID '${deviceId}' not found`);
      }
    } catch (error) {
      if (error instanceof BLEConnectionError) {
        throw error;
      }
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new BLEConnectionError(`Failed to connect to device '${pascoDeviceId}'`, {
        cause,
      });
    }
  }

  /**
   * Check if the device is connected
   */
  isConnected(): boolean {
    return this._stateMachine.isConnected;
  }

  /**
   * Ensure the device is connected, throwing if not.
   * Use this helper at the start of methods that require a connection.
   * @throws DeviceNotConnected if the device is not connected
   */
  protected ensureConnected(): void {
    if (!this.isConnected()) {
      throw new DeviceNotConnected();
    }
  }

  /**
   * Helper function to create a delay.
   * Useful for waiting between operations or polling.
   * @param ms Delay duration in milliseconds
   */
  protected _delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Disconnect from the device
   */
  async disconnect(): Promise<void> {
    if (!this._stateMachine.canDisconnect) {
      return; // Already disconnected or disconnecting
    }

    this._stateMachine.transitionTo('disconnecting', 'disconnect() called');

    if (this._client) {
      await this._client.disconnect();
    }
    this._client = null;
    this._protocol.setClient(null);
    this._sensorManager.reset();

    this._stateMachine.transitionTo('disconnected', 'disconnection complete');
    this.emit('disconnected', { reason: 'user' });
  }

  /**
   * Attempt to reconnect to the last connected device
   * @returns true if reconnection was successful
   */
  async reconnect(): Promise<boolean> {
    if (!this._lastConnectedDevice) {
      this._logger.warn('No previous device to reconnect to');
      return false;
    }

    if (!this._stateMachine.canConnect) {
      this._logger.warn('Cannot reconnect: invalid state', this._stateMachine.state);
      return false;
    }

    this._stateMachine.transitionTo('connecting', 'reconnect() called');
    this._reconnectAttempts++;

    try {
      // Reset state before reconnecting
      this._stateMachine.reset();
      await this.connect(this._lastConnectedDevice);
      return true;
    } catch (error) {
      this._logger.error('Reconnection failed:', error);
      return false;
    }
  }

  /**
   * Handle unexpected disconnection with auto-reconnect support
   */
  protected async _handleUnexpectedDisconnect(): Promise<void> {
    const wasConnected = this._stateMachine.isConnected;

    if (wasConnected) {
      this._stateMachine.tryTransitionTo('disconnected', 'unexpected disconnection');
      this.emit('disconnected', { reason: 'unexpected' });

      // Attempt auto-reconnect if enabled
      if (
        this._options.autoReconnect &&
        this._reconnectAttempts < this._options.maxReconnectAttempts
      ) {
        this._logger.info(
          `Attempting auto-reconnect (${this._reconnectAttempts + 1}/${this._options.maxReconnectAttempts})`,
        );

        // Add jitter to prevent thundering herd when multiple devices reconnect
        // Jitter is ±25% of the base delay
        const jitter = this._options.reconnectDelay * 0.25;
        const delay = this._options.reconnectDelay + (Math.random() * 2 - 1) * jitter;

        await new Promise((resolve) => setTimeout(resolve, delay));
        await this.reconnect();
      }
    }
  }

  // ==================== Public API ====================

  /**
   * Get list of sensors on this device
   */
  getSensorList(): string[] {
    return this._sensorManager.getSensorList();
  }

  /**
   * Get list of measurements available from a sensor
   * @param sensorName Optional sensor name to filter by
   */
  getMeasurementList(sensorName?: string): string[] {
    return this._sensorManager.getMeasurementList(sensorName);
  }

  /**
   * Get the unit type for a measurement
   * @param measurement The measurement name
   */
  getMeasurementUnit(measurement: string): string | null {
    return this._sensorManager.getMeasurementUnit(measurement);
  }

  /**
   * Get units for multiple measurements
   * @param measurements Array of measurement names
   */
  getMeasurementUnitList(measurements: string[]): Record<string, string | null> {
    return this._sensorManager.getMeasurementUnitList(measurements);
  }

  /**
   * Read a single measurement
   * @param measurement The measurement name to read
   */
  async readData(measurement: string): Promise<number | null> {
    this._logger.debug('Reading measurement:', measurement);
    const value = await this._sensorManager.readData(measurement);

    // Emit data event if enabled
    if (this._options.emitDataEvents) {
      const unit = this.getMeasurementUnit(measurement);
      this.emit('data', { measurement, value, unit });
    }

    return value;
  }

  /**
   * Read multiple measurements
   * @param measurements Array of measurement names to read
   */
  async readDataList(measurements: string[]): Promise<Record<string, number | null>> {
    const result = await this._sensorManager.readDataList(measurements);

    // Emit data events if enabled
    if (this._options.emitDataEvents) {
      for (const measurement of measurements) {
        const value = result[measurement] ?? null;
        const unit = this.getMeasurementUnit(measurement);
        this.emit('data', { measurement, value, unit });
      }
    }

    return result;
  }

  /**
   * Stream continuous measurement data using an async iterator.
   * Yields values at the specified interval until the device disconnects
   * or the iterator is broken out of.
   *
   * @param measurement The measurement name to read
   * @param intervalMs Time between readings in milliseconds (default: 100)
   * @yields The measurement value (number or null if reading failed)
   *
   * @example
   * ```typescript
   * // Read temperature continuously
   * for await (const temp of device.streamData('Temperature', 200)) {
   *   console.log(`Temperature: ${temp}°C`);
   *   if (temp !== null && temp > 100) {
   *     console.log('Too hot!');
   *     break;  // Stop streaming
   *   }
   * }
   *
   * // With error handling
   * try {
   *   for await (const value of device.streamData('pH')) {
   *     updateDisplay(value);
   *   }
   * } catch (error) {
   *   console.error('Stream error:', error);
   * }
   * ```
   */
  async *streamData(measurement: string, intervalMs = 100): AsyncGenerator<number | null> {
    while (this.isConnected()) {
      const value = await this.readData(measurement);
      yield value;

      // Check if still connected before waiting
      if (!this.isConnected()) {
        break;
      }

      await this._delay(intervalMs);
    }
  }

  /**
   * Stream multiple measurements continuously using an async iterator.
   * Yields all measurement values at the specified interval.
   *
   * @param measurements Array of measurement names to read
   * @param intervalMs Time between readings in milliseconds (default: 100)
   * @yields Object with measurement names as keys and values
   *
   * @example
   * ```typescript
   * // Read multiple measurements
   * const measurements = ['Temperature', 'Humidity', 'Pressure'];
   * for await (const data of device.streamDataList(measurements, 500)) {
   *   console.log(`Temp: ${data['Temperature']}, Humidity: ${data['Humidity']}`);
   * }
   * ```
   */
  async *streamDataList(
    measurements: string[],
    intervalMs = 100,
  ): AsyncGenerator<Record<string, number | null>> {
    while (this.isConnected()) {
      const values = await this.readDataList(measurements);
      yield values;

      // Check if still connected before waiting
      if (!this.isConnected()) {
        break;
      }

      await this._delay(intervalMs);
    }
  }

  /**
   * Detect devices attached to control node
   */
  async scanControlnodePlugins(): Promise<void> {
    if (!this.isConnected()) {
      throw new DeviceNotConnected();
    }

    await this._protocol.writeAwaitCallback(PROTOCOL.SENSOR_SERVICE_ID, [
      PROTOCOL.CTRLNODE_CMD_DETECT_DEVICES,
    ]);
  }

  // ==================== Protected Methods for Subclasses ====================

  /**
   * Write a command to the device (for subclass use)
   */
  protected async write(serviceId: number, command: number[]): Promise<void> {
    return this._protocol.write(serviceId, command);
  }

  /**
   * Write and await callback (for subclass use)
   */
  protected async writeAwaitCallback(serviceId: number, command: number[]): Promise<void> {
    return this._protocol.writeAwaitCallback(serviceId, command);
  }

  /**
   * Get sensor measurements (for subclass use)
   */
  protected async _getSensorMeasurements(sensorId: number): Promise<void> {
    await this._sensorManager.requestSensorMeasurements(sensorId);
  }

  /**
   * Request sensor data (for subclass use)
   */
  protected async _requestSensorData(sensorId: number): Promise<void> {
    await this._sensorManager.requestSensorMeasurements(sensorId);
  }

  // ==================== Protected Helpers (Preferred API for Subclasses) ====================

  /**
   * Get the last response data packet from a command.
   * Use this instead of accessing _dataPacket directly.
   */
  protected getResponseData(): Uint8Array {
    return new Uint8Array(this._dataPacket);
  }

  /**
   * Find measurement ID by name for a specific sensor
   * @param sensorId The sensor/channel ID
   * @param measurementName The measurement name to find
   * @returns The measurement ID, or null if not found
   */
  protected findMeasurementId(sensorId: number, measurementName: string): number | null {
    return this._sensorManager.findMeasurementId(sensorId, measurementName);
  }

  /**
   * Get a sensor value by sensor ID and measurement ID
   * @param sensorId The sensor/channel ID
   * @param measurementId The measurement ID
   * @returns The sensor value, or null/undefined if not available
   */
  protected getSensorValueById(sensorId: number, measurementId: number): number | null | undefined {
    return this._sensorManager.getSensorValueById(sensorId, measurementId);
  }

  /**
   * Get channel information by sensor ID
   * @param sensorId The sensor/channel ID
   * @returns The channel info, or undefined if not found
   */
  protected getChannelById(sensorId: number): SensorChannel | undefined {
    return this._sensorManager.getChannelById(sensorId);
  }

  /**
   * Filter device channels by a predicate
   * @param filter Optional filter function
   * @returns Matching channels
   */
  protected filterChannels(filter?: (channel: SensorChannel) => boolean): SensorChannel[] {
    return this._sensorManager.filterChannels(filter);
  }

  // ==================== Deprecated Raw Access (Use Helpers Above Instead) ====================

  /**
   * Get device measurements map (for subclass use)
   * @deprecated Use findMeasurementId() instead
   */
  protected get _deviceMeasurements(): Map<number, Map<number, Measurement>> {
    return this._sensorManager.deviceMeasurements;
  }

  /**
   * Get sensor data map (for subclass use)
   * @deprecated Use getSensorValueById() instead
   */
  protected get _sensorData(): Map<number, Map<number, number | null>> {
    return this._sensorManager.sensorData;
  }

  /**
   * Get device channels (for subclass use)
   * @deprecated Use filterChannels() or getChannelById() instead
   */
  protected get _deviceChannels(): SensorChannel[] {
    return this._sensorManager.deviceChannels;
  }

  // ==================== Internal Methods ====================

  /**
   * Set device parameters from BLE device info
   */
  protected _setDeviceParams(bleDevice: BLEDevice): void {
    this._address = bleDevice.address;
    const nameParts = (bleDevice.name ?? '').split(' ');
    if (nameParts.length >= 2) {
      this._devType = nameParts.slice(0, -1).join(' ');
      const lastPart = nameParts[nameParts.length - 1] ?? '';
      this._serialId = lastPart.substring(0, 7);
      this._name = `${this._devType} ${this._serialId}`;
      // Interface ID character is at index 8 (after 7-char serial + separator)
      if (lastPart.length > 8) {
        this._interfaceId = decode64(lastPart[8]!) + 1024;
      }
    }
  }

  /**
   * Initialize device by parsing datasheet
   */
  protected async _initializeDevice(): Promise<void> {
    const sensors = await this._sensorManager.initializeFromInterface(this._interfaceId ?? 0);

    // Emit sensors ready event
    this.emit('sensorsReady', { sensors });
  }

  /**
   * Handle incoming BLE notifications
   */
  protected _handleNotification(serviceId: number, data: number[]): void {
    // Emit notification event for debugging/advanced usage if enabled
    if (this._options.emitNotificationEvents) {
      this.emit('notification', { serviceId, data });
    }

    if (serviceId > 0) {
      // Sensor measurement response - route to sensor manager
      this._sensorManager.handleMeasurementResponse(serviceId - 1, data);
    } else {
      // Device response
      this._processDeviceResponse(data);
    }
  }

  /**
   * Process device response
   */
  protected _processDeviceResponse(data: number[]): void {
    this._responseData = new Uint8Array(data);

    if (data[0] === PROTOCOL.GRSP_RESULT && data[1] === 0x00) {
      if (data[2] === PROTOCOL.GCMD_READ_ONE_SAMPLE) {
        this._dataPacket = data.slice(3);
      } else if (data[2] === PROTOCOL.GCMD_CONTROL_NODE_CMD) {
        this._dataPacket = data.slice(3);
      }
    }
  }
}
