/**
 * Sensor Manager
 *
 * Manages sensor state, initialization, and data reading for PASCO BLE devices.
 * Coordinates between SensorInitializer and MeasurementDecoder through a
 * centralized SensorState container.
 *
 * Architecture:
 * - SensorState: Single source of truth for all sensor data
 * - SensorInitializer: Reads datasheets and populates state during setup
 * - MeasurementDecoder: Reads raw data and updates state during data collection
 * - SensorManager: Orchestrates the above and provides the public API
 */

import type { Measurement, SensorChannel } from '@/types/index.js';
import { validateArray, validateNonEmptyString, validateString } from '@/utils/validation.js';

import { DeviceNotConnected, MeasurementNotFound, SensorNotFound } from '../errors.js';
import { MeasurementDecoder } from './measurement-decoder.js';
import { PROTOCOL, type ProtocolHandler } from './protocol-handler.js';
import { SensorInitializer } from './sensor-initializer.js';
import { SensorState } from './sensor-state.js';

/**
 * Options for sensor manager
 */
export interface SensorManagerOptions {
  /** Device type for special handling */
  devType?: string | null;
  /** Protocol handler for reading sensor data */
  protocolHandler: ProtocolHandler;
  /** Check if device is connected */
  isConnected: () => boolean;
  /**
   * Optional callback for handling errors that occur in async contexts
   * where they can't be propagated normally (e.g., notification handlers).
   * If not provided, errors will be logged to console.warn.
   */
  onError?: (error: Error, context: string) => void;
}

/**
 * Manages all sensor-related state and operations
 */
export class SensorManager {
  // Options
  private readonly _options: SensorManagerOptions;

  // Centralized state container
  private readonly _state: SensorState;

  // Specialized handlers
  private readonly _decoder: MeasurementDecoder;
  private readonly _initializer: SensorInitializer;

  // Track which sensor we're reading from
  private _notifySensorId: number | null = null;

  constructor(options: SensorManagerOptions) {
    this._options = options;

    // Create centralized state
    this._state = new SensorState();

    // Create handlers with state access
    this._decoder = new MeasurementDecoder(this._state);
    this._initializer = new SensorInitializer(this._state);
  }

  /**
   * Handle errors that occur in async contexts where they can't be propagated.
   * Uses the configured onError callback if available, otherwise logs to console.
   */
  private _handleAsyncError(error: unknown, context: string): void {
    const err = error instanceof Error ? error : new Error(String(error));
    if (this._options.onError) {
      this._options.onError(err, context);
    } else {
      console.warn(`[SensorManager] Error in ${context}:`, err.message);
    }
  }

  // ==================== Properties ====================

  /**
   * Get the centralized state object (for advanced use cases)
   * @internal
   */
  get state(): SensorState {
    return this._state;
  }

  get dataResults(): Map<string, number | null> {
    return this._state.dataResultsMap;
  }

  get deviceSensors(): Map<string, SensorChannel> {
    return this._state.sensorNamesMap;
  }

  get deviceChannels(): SensorChannel[] {
    return [...this._state.getChannels()];
  }

  /**
   * Get device measurements map (for subclass compatibility)
   * @internal
   */
  get deviceMeasurements(): Map<number, Map<number, Measurement>> {
    return this._state.deviceMeasurementsMap;
  }

  /**
   * Get sensor data map (for subclass compatibility)
   * @internal
   */
  get sensorData(): Map<number, Map<number, number | null>> {
    return this._state.sensorDataMap;
  }

  // ==================== Initialization ====================

  /**
   * Initialize device sensors from interface ID
   */
  async initializeFromInterface(interfaceId: number): Promise<string[]> {
    this._initializer.initializeFromInterface(interfaceId);

    // Fixed channels (//control.Node steppers on interface 1057, and every
    // non-pluggable port) must be initialized even when the interface also
    // has hot-plug ports. Plugin IDs arrive later on the service-0 0x82 callback.
    this._initializer.initializeSensors();
    if (this._initializer.hasPluggableSensors()) {
      await this._scanControlnodePlugins();
    }

    // Return list of sensor names
    return Array.from(this._state.getSensorNames());
  }

  /**
   * Reset all sensor state (for reconnection)
   */
  reset(): void {
    this._state.reset();
    this._notifySensorId = null;
  }

  // ==================== Sensor Validation Helpers ====================

  /**
   * Check if a sensor is initialized and ready
   * @param sensorName The sensor name to check
   * @returns true if the sensor exists and is initialized
   */
  isSensorReady(sensorName: string): boolean {
    return this._state.hasSensor(sensorName);
  }

  /**
   * Ensure a sensor is initialized, throwing if not
   * @param sensorName The sensor name to validate
   * @throws SensorNotFound if the sensor is not initialized
   */
  ensureSensorReady(sensorName: string): void {
    if (!this._state.hasSensor(sensorName)) {
      throw new SensorNotFound(`Sensor "${sensorName}" not initialized`);
    }
  }

  /**
   * Get sensor channel info, throwing if not found
   * @param sensorName The sensor name
   * @returns The sensor channel information
   * @throws SensorNotFound if the sensor does not exist
   */
  getSensorOrThrow(sensorName: string): SensorChannel {
    const sensor = this._state.getSensorByName(sensorName);
    if (!sensor) {
      throw new SensorNotFound(`Sensor "${sensorName}" not found`);
    }
    return sensor;
  }

  /**
   * Check if a measurement is available
   * @param measurement The measurement name to check
   * @returns true if the measurement exists
   */
  isMeasurementReady(measurement: string): boolean {
    return this._state.hasMeasurement(measurement);
  }

  /**
   * Ensure a measurement is available, throwing if not
   * @param measurement The measurement name to validate
   * @throws MeasurementNotFound if the measurement is not available
   */
  ensureMeasurementReady(measurement: string): void {
    if (!this._state.hasMeasurement(measurement)) {
      throw new MeasurementNotFound(`Measurement "${measurement}" not available`);
    }
  }

  // ==================== Low-Level Sensor Access (for subclasses) ====================

  /**
   * Get channel information by sensor ID
   * @param sensorId The sensor/channel ID
   * @returns The channel information, or undefined if not found
   */
  getChannelById(sensorId: number): SensorChannel | undefined {
    return this._state.getChannel(sensorId);
  }

  /**
   * Find the measurement ID for a named measurement on a specific sensor
   * @param sensorId The sensor ID to search
   * @param measurementName The name of the measurement
   * @returns The measurement ID, or null if not found
   */
  findMeasurementId(sensorId: number, measurementName: string): number | null {
    const measurements = this._state.getMeasurements(sensorId);
    if (!measurements) return null;

    for (const [mId, m] of measurements) {
      if (m.NameTag === measurementName) {
        return mId;
      }
    }
    return null;
  }

  /**
   * Get a sensor value by sensor ID and measurement ID
   * @param sensorId The sensor ID
   * @param measurementId The measurement ID
   * @returns The sensor value, or null/undefined if not available
   */
  getSensorValueById(sensorId: number, measurementId: number): number | null | undefined {
    return this._state.getSensorValue(sensorId, measurementId);
  }

  /**
   * Iterate over device channels that match a filter
   * @param filter Optional filter function
   * @returns Array of matching channels
   */
  filterChannels(filter?: (channel: SensorChannel) => boolean): SensorChannel[] {
    const channels = this._state.getChannels();
    if (!filter) return [...channels];
    return [...channels].filter(filter);
  }

  // ==================== Sensor API ====================

  /**
   * Get list of sensors on this device
   */
  getSensorList(): string[] {
    if (!this._options.isConnected()) {
      throw new DeviceNotConnected();
    }
    return Array.from(this._state.getSensorNames());
  }

  /**
   * Get list of measurements available from a sensor
   * @param sensorName Optional sensor name to filter by
   */
  getMeasurementList(sensorName?: string): string[] {
    if (!this._options.isConnected()) {
      throw new DeviceNotConnected();
    }

    if (sensorName !== undefined) {
      validateString(sensorName, 'sensorName');
    }

    if (!sensorName) {
      const measurementList: string[] = [];
      for (const sensor of this._state.getChannels()) {
        measurementList.push(...sensor.measurements);
      }
      return measurementList;
    }

    const sensor = this._state.getSensorByName(sensorName);
    if (!sensor) {
      throw new SensorNotFound();
    }

    return sensor.measurements;
  }

  /**
   * Get the unit type for a measurement
   * @param measurement The measurement name
   */
  getMeasurementUnit(measurement: string): string | null {
    if (!this._options.isConnected()) {
      throw new DeviceNotConnected();
    }
    validateNonEmptyString(measurement, 'measurement');

    const sensorId = this._state.getMeasurementSensorId(measurement);
    if (sensorId === undefined) {
      throw new MeasurementNotFound(measurement);
    }

    const measurements = this._state.getMeasurements(sensorId);
    if (measurements) {
      for (const [, m] of measurements) {
        if (m.NameTag === measurement) {
          return m.UnitType ?? null;
        }
      }
    }

    return null;
  }

  /**
   * Get units for multiple measurements
   * @param measurements Array of measurement names
   */
  getMeasurementUnitList(measurements: string[]): Record<string, string | null> {
    if (!this._options.isConnected()) {
      throw new DeviceNotConnected();
    }
    validateArray(measurements, 'measurements');

    const result: Record<string, string | null> = {};
    for (const measurement of measurements) {
      result[measurement] = this.getMeasurementUnit(measurement);
    }
    return result;
  }

  /**
   * Read a single measurement
   * @param measurement The measurement name to read
   */
  async readData(measurement: string): Promise<number | null> {
    if (!this._options.isConnected()) {
      throw new DeviceNotConnected();
    }
    validateNonEmptyString(measurement, 'measurement');

    const sensorId = this._state.getMeasurementSensorId(measurement);
    if (sensorId === undefined) {
      throw new MeasurementNotFound();
    }

    await this._getSensorMeasurements(sensorId);
    return this._state.getResult(measurement) ?? null;
  }

  /**
   * Read multiple measurements
   * @param measurements Array of measurement names to read
   */
  async readDataList(measurements: string[]): Promise<Record<string, number | null>> {
    if (!this._options.isConnected()) {
      throw new DeviceNotConnected();
    }
    validateArray(measurements, 'measurements');

    for (const m of measurements) {
      validateString(m, 'measurements[item]');
    }

    // Get unique sensor IDs
    const sensorIds = new Set<number>();
    for (const m of measurements) {
      const sensorId = this._state.getMeasurementSensorId(m);
      if (sensorId === undefined) {
        throw new MeasurementNotFound();
      }
      sensorIds.add(sensorId);
    }

    // Request data from each sensor
    for (const sensorId of sensorIds) {
      await this._getSensorMeasurements(sensorId);
    }

    // Build result
    const result: Record<string, number | null> = {};
    for (const measurement of measurements) {
      result[measurement] = this._state.getResult(measurement) ?? null;
    }
    return result;
  }

  // ==================== Notification Handling ====================

  /**
   * Handle incoming measurement response from sensor
   */
  handleMeasurementResponse(sensorId: number, data: number[]): void {
    if (data[0] !== undefined && data[0] <= 0x1f) {
      // Periodic data
      this._state.appendToDataStack(sensorId, data.slice(1));

      const counter = this._state.incrementAckCounter(sensorId);
      this._decoder.decode(sensorId);

      // Send acknowledgement every 8 packets
      if (counter > 8) {
        this._state.setAckCounter(sensorId, 0);
        const responseServiceId = sensorId + 1;
        this._options.protocolHandler.sendAck(responseServiceId, [data[0]!]).catch((error) => {
          this._handleAsyncError(error, 'sendAck');
        });
      }
    } else if (data[0] === PROTOCOL.CNTRLNODE_PLUGINS_CALLBACK) {
      this._updateControlnodePluginSensor(data);
    } else if (data[0] === PROTOCOL.GRSP_RESULT && data[1] === 0x00) {
      if (data[2] === PROTOCOL.GCMD_READ_ONE_SAMPLE) {
        // Store data for the sensor we requested from
        if (this._notifySensorId !== null) {
          this._state.setDataStack(this._notifySensorId, data.slice(3));
        }
      }
    }
  }

  /**
   * Request and decode sensor measurements by sensor ID (for subclass use)
   * @internal
   */
  async requestSensorMeasurements(sensorId: number): Promise<void> {
    await this._getSensorMeasurements(sensorId);
  }

  // ==================== Internal Methods ====================

  /**
   * Detect devices attached to control node
   */
  private async _scanControlnodePlugins(): Promise<void> {
    await this._options.protocolHandler.writeAwaitCallback(PROTOCOL.SENSOR_SERVICE_ID, [
      PROTOCOL.CTRLNODE_CMD_DETECT_DEVICES,
    ]);
  }

  /**
   * Apply a //control.Node plugin-detection payload (command 0x82).
   * Service 0 responses are delivered here; sensor-service responses also
   * arrive through {@link handleMeasurementResponse}.
   */
  applyControlNodePlugins(data: number[]): void {
    this._updateControlnodePluginSensor(data);
  }

  /**
   * Update control node plugin sensors
   */
  private _updateControlnodePluginSensor(data: number[]): void {
    // Unpack sensor IDs (little-endian 16-bit integers)
    const sensorIds: number[] = [];
    for (let i = 1; i < data.length - 1; i += 2) {
      const low = data[i] ?? 0;
      const high = data[i + 1] ?? 0;
      sensorIds.push(low | (high << 8));
    }
    this._initializer.initializeSensors(sensorIds);
  }

  /**
   * Request and decode sensor measurements
   */
  private async _getSensorMeasurements(sensorId: number): Promise<void> {
    // Track which sensor we're requesting data from
    this._notifySensorId = sensorId;

    // Find packet size for this sensor
    let packetSize = 0;
    const channel = this._state.getChannel(sensorId);
    if (channel) {
      packetSize = channel.total_data_size;
    }

    // Request data
    const serviceId = sensorId + 1;
    await this._options.protocolHandler.writeAwaitCallback(serviceId, [
      PROTOCOL.GCMD_READ_ONE_SAMPLE,
      packetSize,
    ]);

    // Decode the received data
    this._decoder.decode(sensorId);
  }
}
