/**
 * Sensor Initializer
 *
 * Handles initialization of PASCO sensors from datasheets.
 *
 * The initialization process follows these steps:
 * 1. Load wireless interface definition (channels and capabilities)
 * 2. Detect pluggable sensors (if interface supports plug detection)
 * 3. Initialize each sensor channel with measurements and calibrations
 * 4. Build lookup tables for fast measurement access during data collection
 *
 * Some PASCO devices have fixed sensors, while others support hot-pluggable
 * sensors that are detected at runtime.
 */

import type { SensorChannel } from '@/types/index.js';

import { getInterface, getSensor } from '../datasheets.js';
import { SensorSetupError } from '../errors.js';
import type { SensorStateWriter } from './sensor-state.js';

/**
 * Initializes sensors from PASCO datasheets and builds lookup tables
 *
 * This class is responsible for:
 * - Loading wireless interface definitions from datasheets
 * - Initializing sensor channels with their measurements
 * - Building efficient lookup tables for data collection
 * - Managing state for both fixed and pluggable sensors
 */
export class SensorInitializer {
  private readonly _state: SensorStateWriter;
  private _deviceChannels: SensorChannel[] = [];

  constructor(state: SensorStateWriter) {
    this._state = state;
  }

  /**
   * Get the current device channels
   */
  get deviceChannels(): readonly SensorChannel[] {
    return this._deviceChannels;
  }

  /**
   * Initialize device channels from wireless interface definition
   *
   * Loads the interface specification from datasheets and creates
   * channel objects for each sensor port on the device.
   *
   * @param interfaceId - The wireless interface ID from PASCO datasheets
   * @throws {SensorSetupError} If the interface ID is not found
   */
  initializeFromInterface(interfaceId: number): void {
    const iface = getInterface(interfaceId);
    if (!iface) {
      throw new SensorSetupError(`Interface ${interfaceId} not found`);
    }

    this._deviceChannels = iface.channels.map((c) => ({
      id: c.ID,
      name: c.NameTag ?? '',
      sensor_id: c.SensorID ?? 0,
      type: c.Type ?? 'Pasport',
      output_type: c.OutputType ?? '',
      measurements: [],
      total_data_size: 0,
      plug_detect: c.PlugDetect ?? 0,
      channel_id_tag: c.ChannelIDTag ?? '',
      factory_cal_ids: [],
    }));

    // Update state with the new channels
    this._state.setChannels(this._deviceChannels);
  }

  /**
   * Check if any channels support pluggable sensors
   *
   * Some PASCO devices have ports that support hot-pluggable sensors
   * (e.g., wireless sensor ports). This method checks if the device
   * interface definition includes any such ports.
   *
   * @returns true if at least one channel supports plug detection
   */
  hasPluggableSensors(): boolean {
    return this._deviceChannels.some((ch) => ch.plug_detect === 1);
  }

  /**
   * Initialize all sensors, optionally with pluggable sensor IDs
   *
   * This is the main initialization method that:
   * 1. Updates sensor IDs for pluggable sensors (if provided)
   * 2. Initializes each PASPORT sensor channel
   * 3. Builds lookup tables for efficient measurement access
   *
   * @param pluginSensorIds - Optional array of sensor IDs detected on pluggable ports
   * @throws {SensorSetupError} If sensor initialization fails
   *
   * @example
   * // Fixed sensors (no pluggable sensors)
   * initializer.initializeSensors();
   *
   * // With detected pluggable sensors
   * const detectedIds = [65, 66]; // Temperature and Pressure sensor IDs
   * initializer.initializeSensors(detectedIds);
   */
  initializeSensors(pluginSensorIds?: number[]): void {
    try {
      // Update sensor IDs for plugin sensors
      if (pluginSensorIds) {
        let i = 0;
        for (const channel of this._deviceChannels) {
          if (channel.plug_detect === 1) {
            channel.sensor_id = pluginSensorIds[i] ?? 0;
            i++;
          }
        }
        // Sync updated channels back to state
        this._state.setChannels(this._deviceChannels);
      }

      // Initialize each sensor channel
      for (const channel of this._deviceChannels) {
        if (channel.type === 'Pasport' && channel.sensor_id !== 0) {
          this._initializeSensor(channel);
        }
      }

      // Build lookup tables
      this._buildLookupTables();
    } catch (e) {
      if (e instanceof SensorSetupError) {
        throw e;
      }
      const error = e instanceof Error ? e : new Error(String(e));
      throw new SensorSetupError('Failed to initialize sensors', { cause: error });
    }
  }

  /**
   * Initialize a single sensor channel
   *
   * This method:
   * 1. Initializes BLE protocol state (ack counters, data buffers)
   * 2. Loads sensor definition from datasheets
   * 3. Filters measurements by visibility (keeps visible derivatives; hides internal rows)
   * 4. Extracts factory calibration IDs
   * 5. Calculates total data size for BLE packet sizing
   * 6. Initializes data storage maps
   *
   * @param channel - The sensor channel to initialize
   * @private
   */
  private _initializeSensor(channel: SensorChannel): void {
    // Initialize BLE protocol state for this channel.
    // Reset the packet size so a second init (plugin detection) does not double it.
    channel.total_data_size = 0;
    this._state.setAckCounter(channel.id, 0);
    this._state.setDataStack(channel.id, []);
    this._state.initMeasurementsForSensor(channel.id);

    // Load sensor definition from datasheets
    const sensorData = getSensor(channel.sensor_id);
    if (!sensorData) return;

    channel.name = sensorData.tag;

    const measurements: string[] = [];
    const factoryCalIds: string[] = [];

    // Process all measurements defined in the sensor datasheet
    for (const [mId, m] of sensorData.measurements) {
      // Store full measurement definition for data decoding
      this._state.setMeasurement(channel.id, mId, { ...m });

      // User-visible measurements, including Visible derivatives such as Velocity.
      // Internal rows and non-Visible rows stay hidden.
      if (!m.Internal && m.Visible) {
        measurements.push(m.NameTag);
      }

      // Track factory calibration IDs for calibration management
      if (m.Type === 'FactoryCal') {
        factoryCalIds.push(m.ID.toString());
      }

      // Accumulate total data size for BLE packet processing
      // Used to validate incoming data packets
      if (m.DataSize) {
        channel.total_data_size += m.DataSize;
      }
    }

    channel.measurements = measurements;
    channel.factory_cal_ids = factoryCalIds;

    // Initialize sensor data storage
    // RotaryPos sensors start at 0, others start as null (no data yet)
    this._state.initSensorDataForSensor(channel.id);
    for (const [mId, m] of sensorData.measurements) {
      this._state.setSensorValue(channel.id, mId, m.Type === 'RotaryPos' ? 0 : null);
    }

    // Update the channel in state
    this._state.setChannels(this._deviceChannels);
  }

  /**
   * Build lookup tables for quick access to measurements
   *
   * Creates efficient index structures for:
   * 1. Finding which channel provides a given measurement (by name)
   * 2. Looking up sensor channels by sensor name
   * 3. Initializing data result storage for all measurements
   *
   * These lookup tables enable O(1) access during high-frequency data
   * collection instead of linear searches through all channels.
   *
   * @private
   */
  private _buildLookupTables(): void {
    // Clear existing lookups
    this._state.clearLookupTables();

    // Build measurement name -> channel ID map
    // Allows quick lookup of which sensor provides a measurement
    for (const channel of this._deviceChannels) {
      for (const measurement of channel.measurements) {
        this._state.mapMeasurementToSensor(measurement, channel.id);
        this._state.setResult(measurement, null);
      }
    }

    // Build sensor name -> channel map
    // Allows quick lookup of channels by sensor name
    for (const sensor of this._deviceChannels) {
      this._state.registerSensor(sensor.name, sensor);
    }
  }
}
