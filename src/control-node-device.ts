/**
 * Control.Node Device
 *
 * Extends PASCOBLEDevice with stepper motor, servo, and power output control
 * specific to the PASCO //control.Node device.
 */

import { PASCOBLEDevice } from './device/index.js';
import {
  CommunicationError,
  DeviceNotConnected,
  InvalidParameter,
  MeasurementNotFound,
} from './errors.js';
import { unpackInt16LE } from './utils/binary.js';
import { limit } from './utils/math.js';
import { validateNonEmptyString, validateNumber } from './utils/validation.js';

/**
 * Servo control type.
 * - 'standard': Position-based servo (0-180 degrees)
 * - 'continuous': Continuous rotation servo (speed -100 to 100)
 * - 0: Turn servo off
 */
export type ServoType = 'standard' | 'continuous' | 0;

/**
 * Power output type.
 * - 'USB': Simple on/off control for USB ports
 * - 'terminal': PWM control for terminal outputs (-100 to 100 power)
 */
export type OutputType = 'USB' | 'terminal';

/**
 * Motor/stepper port identifier.
 * The Control.Node has two motor ports labeled 'A' and 'B'.
 * Accepts both uppercase and lowercase for convenience.
 */
export type MotorPort = 'A' | 'B' | 'a' | 'b';

/**
 * Strict motor port (uppercase only).
 * Used internally after normalization.
 */
export type StrictMotorPort = 'A' | 'B';

/**
 * Servo port identifier.
 * The Control.Node has two servo ports numbered 1 and 2.
 */
export type ServoPort = 1 | 2;

/**
 * Power output channel.
 * Each motor port (A, B) has two power channels (1, 2).
 */
export type PowerChannel = 1 | 2;

/**
 * @deprecated Use MotorPort instead. Will be removed in v0.5.0.
 */
export type PortId = MotorPort;

/**
 * ControlNode Device class
 *
 * Provides stepper motor, servo, and power output control for the //control.Node.
 */
/**
 * Normalize a motor port to uppercase.
 * @param port The port identifier ('A', 'B', 'a', or 'b')
 * @returns The normalized uppercase port ('A' or 'B')
 * @throws InvalidParameter if port is not valid
 */
function normalizeMotorPort(port: MotorPort): StrictMotorPort {
  const upper = port.toUpperCase();
  if (upper !== 'A' && upper !== 'B') {
    throw new InvalidParameter('Port must be A or B');
  }
  return upper as StrictMotorPort;
}

/**
 * Validate a servo port number.
 * @param port The port number (1 or 2)
 * @throws InvalidParameter if port is not valid
 */
function validateServoPort(port: number): asserts port is ServoPort {
  if (port !== 1 && port !== 2) {
    throw new InvalidParameter('Servo port must be 1 or 2');
  }
}

/**
 * Validate a power channel number.
 * @param channel The channel number (1 or 2)
 * @throws InvalidParameter if channel is not valid
 */
function validatePowerChannel(channel: number): asserts channel is PowerChannel {
  if (channel !== 1 && channel !== 2) {
    throw new InvalidParameter('Power channel must be 1 or 2');
  }
}

export class ControlNodeDevice extends PASCOBLEDevice {
  // Control Node commands
  protected static readonly CTRLNODE_CMD_SET_SERVO = 3;
  protected static readonly CTRLNODE_CMD_SET_STEPPER = 4;
  protected static readonly CTRLNODE_CMD_SET_SIGNALS = 5;
  protected static readonly CTRLNODE_CMD_XFER_ACCESSORY = 6;
  protected static readonly CTRLNODE_CMD_READ_LINE_FOLLOWER = 7;
  protected static readonly CTRLNODE_CMD_GET_STEPPER_INFO = 8;
  protected static readonly CTRLNODE_CMD_STOP_ACCESSORIES = 9;
  protected static readonly CTRLNODE_CMD_SET_BEEPER = 10;

  // Stepper constants
  protected static readonly STEPS_PER_REV = 960;
  protected static readonly DEGREES_PER_REV = 360;
  protected static readonly DECISTEPS_PER_STEP = 10;

  // PWM period constants
  protected static readonly LSB_PWM_PERIOD = 0xd0;
  protected static readonly MSB_PWM_PERIOD = 0x07;

  // Accessory IDs
  protected static readonly CN_ACC_ID_NONE = 0;
  protected static readonly CN_ACC_ID_MOTOR_BASE = 2500;
  protected static readonly CN_ACC_ID_STEPPER_480 = 2501;
  protected static readonly CN_ACC_ID_LOW_SPEED_STEPPER = 2502;
  protected static readonly CN_ACC_ID_MOTOR_3 = 2503;
  protected static readonly CN_ACC_ID_LINE_FOLLOWER = 2504;
  protected static readonly CN_ACC_ID_RANGE_SENSOR = 2505;

  // Channel constants
  protected static readonly STEPPER_A_CHANNEL = 1;
  protected static readonly STEPPER_B_CHANNEL = 2;
  protected static readonly BOTH_STEPPER_CHANNEL = 3;

  // Plugin channel mapping
  protected static readonly PLUGIN_CHANNELS: Record<string | number, number> = {
    A: 0,
    B: 1,
    sensor: 2,
    1: 3,
    2: 3,
  };

  // ==================== Reading Data ====================

  /**
   * Read a sensor measurement
   * @param measurement Name of measurement to read
   * @param port Optional port of sensor ('A', 'B', 1, or 2)
   */
  override async readData(measurement: string, port?: string | number): Promise<number | null> {
    if (!this.isConnected()) {
      throw new DeviceNotConnected();
    }
    validateNonEmptyString(measurement, 'measurement');

    if (port === undefined) {
      return super.readData(measurement);
    }

    if (typeof port === 'string') {
      // Reading from stepper ports A or B
      const sensorId = ControlNodeDevice.PLUGIN_CHANNELS[port.toUpperCase()];
      if (sensorId === undefined) {
        throw new InvalidParameter('Invalid port');
      }

      await this._getSensorMeasurements(sensorId);

      // Find measurement ID using the helper method
      const measurementId = this.findMeasurementId(sensorId, measurement);
      if (measurementId === null) {
        throw new MeasurementNotFound();
      }

      let value = this.getSensorValueById(sensorId, measurementId) ?? null;

      // Convert from radians to degrees for angular measurements
      if (value !== null && (measurement === 'Angle' || measurement === 'AngularVelocity')) {
        value = Math.round(((value * 180) / Math.PI) * 10) / 10;
      }

      return value;
    }

    if (typeof port === 'number') {
      // Reading servo resistance
      const sensorId = ControlNodeDevice.PLUGIN_CHANNELS[port];
      if (sensorId === undefined) {
        throw new InvalidParameter('Invalid port');
      }

      await this._requestSensorData(sensorId);

      // Parse the response data using the helper method
      const responseData = this.getResponseData();
      // Servo resistance is a 16-bit value at a port-based offset. Ensure the
      // response is long enough for the 2 bytes at that offset before reading,
      // otherwise the DataView read would throw a RangeError.
      const offset = (port + 2) * 2;
      if (responseData.length >= offset + 2) {
        const value = unpackInt16LE(responseData, offset);
        return value * 12.5;
      }
    }

    throw new MeasurementNotFound();
  }

  // ==================== Steppers ====================

  /**
   * Get info on stepper remaining distances and accelerations
   * @internal
   */
  protected async _getStepperRemaining(): Promise<[number, number, number, number]> {
    const service = 0;
    const size = 2;
    const command = [
      PASCOBLEDevice.GCMD_CONTROL_NODE_CMD,
      ControlNodeDevice.CTRLNODE_CMD_GET_STEPPER_INFO,
      size,
    ];

    await this.writeAwaitCallback(service, command);

    // Parse response data using the helper method
    const data = this.getResponseData();
    const rawInfo = [
      unpackInt16LE(data, 0), // steps remaining A
      unpackInt16LE(data, 2), // steps remaining B
      unpackInt16LE(data, 4), // acceleration remaining A
      unpackInt16LE(data, 6), // acceleration remaining B
    ];

    // Add extra bits if available
    if (data.length > 9) {
      rawInfo[0] = rawInfo[0]! + ((data[8] ?? 0) << 8);
      rawInfo[1] = rawInfo[1]! + ((data[9] ?? 0) << 8);
    }

    // Convert to degrees
    const degreeInfo: [number, number, number, number] = [
      (rawInfo[0]! / ControlNodeDevice.STEPS_PER_REV) * ControlNodeDevice.DEGREES_PER_REV,
      (rawInfo[1]! / ControlNodeDevice.STEPS_PER_REV) * ControlNodeDevice.DEGREES_PER_REV,
      (rawInfo[2]! / ControlNodeDevice.STEPS_PER_REV) * ControlNodeDevice.DEGREES_PER_REV,
      (rawInfo[3]! / ControlNodeDevice.STEPS_PER_REV) * ControlNodeDevice.DEGREES_PER_REV,
    ];

    return degreeInfo;
  }

  /**
   * Send stepper motor command
   * @internal
   */
  protected async _sendStepperCommand(
    speedA: number | null,
    accelerationA: number | null,
    distanceA: number | 'continuous' | null,
    speedB: number | null,
    accelerationB: number | null,
    distanceB: number | 'continuous' | null,
  ): Promise<void> {
    // Determine which steppers to control
    let stepperChannel = ControlNodeDevice.BOTH_STEPPER_CHANNEL;
    let effSpeedA = speedA ?? 0;
    let effAccelA = accelerationA ?? 0;
    let effDistA = distanceA;
    let effSpeedB = speedB ?? 0;
    let effAccelB = accelerationB ?? 0;
    let effDistB = distanceB;

    if (accelerationA === null && accelerationB !== null) {
      stepperChannel = ControlNodeDevice.STEPPER_B_CHANNEL;
      effSpeedA = 0;
      effAccelA = 0;
      effDistA = 0;
    }
    if (accelerationB === null && accelerationA !== null) {
      stepperChannel = ControlNodeDevice.STEPPER_A_CHANNEL;
      effSpeedB = 0;
      effAccelB = 0;
      effDistB = 0;
    }

    // Check for continuous rotation
    const continuous1 = effDistA === 'continuous';
    const continuous2 = effDistB === 'continuous';

    // Calculate multipliers for low speed steppers using helper method
    const mul: Record<number, number> = {};
    const channels = this.filterChannels((ch) => !!ch.channel_id_tag);
    for (const sensor of channels) {
      mul[sensor.id] = sensor.sensor_id === ControlNodeDevice.CN_ACC_ID_LOW_SPEED_STEPPER ? 6 : 1;
    }
    const mulA = mul[0] ?? 1;
    const mulB = mul[1] ?? 1;

    // Convert units
    const stepsPerDeg = ControlNodeDevice.STEPS_PER_REV / ControlNodeDevice.DEGREES_PER_REV;
    const deciStepsPerDeg = ControlNodeDevice.DECISTEPS_PER_STEP * stepsPerDeg;

    let speedAVal = effSpeedA * mulA * deciStepsPerDeg;
    let speedBVal = effSpeedB * mulB * deciStepsPerDeg;
    let accelAVal = effAccelA * mulA * deciStepsPerDeg;
    let accelBVal = effAccelB * mulB * deciStepsPerDeg;
    let distAVal = continuous1
      ? 0
      : Math.abs(typeof effDistA === 'number' ? effDistA : 0) * mulA * stepsPerDeg;
    let distBVal = continuous2
      ? 0
      : Math.abs(typeof effDistB === 'number' ? effDistB : 0) * mulB * stepsPerDeg;

    // Apply limits
    speedAVal = Math.round(limit(speedAVal, -19200, 19200));
    accelAVal = Math.round(limit(accelAVal, 0, 65535));
    distAVal = Math.round(limit(distAVal, 0, 65535));
    speedBVal = Math.round(limit(speedBVal, -19200, 19200));
    accelBVal = Math.round(limit(accelBVal, 0, 65535));
    distBVal = Math.round(limit(distBVal, 0, 65535));

    // Build command
    const command = [
      PASCOBLEDevice.GCMD_CONTROL_NODE_CMD,
      ControlNodeDevice.CTRLNODE_CMD_SET_STEPPER,
      stepperChannel,
      speedAVal & 0xff,
      (speedAVal >> 8) & 0xff,
      accelAVal & 0xff,
      (accelAVal >> 8) & 0xff,
      distAVal & 0xff,
      (distAVal >> 8) & 0xff,
      speedBVal & 0xff,
      (speedBVal >> 8) & 0xff,
      accelBVal & 0xff,
      (accelBVal >> 8) & 0xff,
      distBVal & 0xff,
      (distBVal >> 8) & 0xff,
    ];

    await this.writeAwaitCallback(PASCOBLEDevice.SENSOR_SERVICE_ID, command, { retry: false });
  }

  /**
   * Rotate steppers continuously
   * @param speedA Target velocity for stepper A (deg/s)
   * @param accelerationA Acceleration for stepper A (deg/s/s)
   * @param speedB Target velocity for stepper B (deg/s)
   * @param accelerationB Acceleration for stepper B (deg/s/s)
   */
  async rotateSteppersContinuously(
    speedA: number | null,
    accelerationA: number | null,
    speedB: number | null,
    accelerationB: number | null,
  ): Promise<void> {
    if (!this.isConnected()) {
      throw new DeviceNotConnected();
    }

    await this._sendStepperCommand(
      speedA,
      accelerationA,
      'continuous',
      speedB,
      accelerationB,
      'continuous',
    );
  }

  /**
   * Rotate a single stepper continuously
   * @param port Port of stepper ('A' or 'B')
   * @param speed Target velocity (deg/s)
   * @param acceleration Acceleration (deg/s/s)
   */
  async rotateStepperContinuously(
    port: MotorPort,
    speed: number,
    acceleration: number,
  ): Promise<void> {
    const normalizedPort = normalizeMotorPort(port);
    if (normalizedPort === 'A') {
      await this.rotateSteppersContinuously(speed, acceleration, null, null);
    } else {
      await this.rotateSteppersContinuously(null, null, speed, acceleration);
    }
  }

  /**
   * Stop steppers with given decelerations
   * @param accelerationA Deceleration for stepper A (deg/s/s)
   * @param accelerationB Deceleration for stepper B (deg/s/s)
   */
  async stopSteppers(accelerationA: number | null, accelerationB: number | null): Promise<void> {
    await this._sendStepperCommand(0, accelerationA, 'continuous', 0, accelerationB, 'continuous');
  }

  /**
   * Stop a single stepper
   * @param port Port of stepper ('A' or 'B')
   * @param acceleration Deceleration (deg/s/s)
   */
  async stopStepper(port: MotorPort, acceleration: number): Promise<void> {
    const normalizedPort = normalizeMotorPort(port);
    if (normalizedPort === 'A') {
      await this.stopSteppers(acceleration, null);
    } else {
      await this.stopSteppers(null, acceleration);
    }
  }

  /**
   * Rotate steppers through specified distances
   * @param speedA Target velocity for stepper A (deg/s)
   * @param accelerationA Acceleration for stepper A (deg/s/s)
   * @param distanceA Distance for stepper A (deg)
   * @param speedB Target velocity for stepper B (deg/s)
   * @param accelerationB Acceleration for stepper B (deg/s/s)
   * @param distanceB Distance for stepper B (deg)
   * @param awaitCompletion Whether to wait for completion
   */
  async rotateSteppersThrough(
    speedA: number | null,
    accelerationA: number | null,
    distanceA: number | null,
    speedB: number | null,
    accelerationB: number | null,
    distanceB: number | null,
    awaitCompletion: boolean = false,
  ): Promise<void> {
    if (!this.isConnected()) {
      throw new DeviceNotConnected();
    }

    await this._sendStepperCommand(
      speedA,
      accelerationA,
      distanceA,
      speedB,
      accelerationB,
      distanceB,
    );

    if (awaitCompletion) {
      const deadline =
        Date.now() +
        this._stepperWaitBudgetMs(
          speedA,
          accelerationA,
          distanceA,
          speedB,
          accelerationB,
          distanceB,
        );
      let degreesRemaining = await this._getStepperRemaining();
      while (degreesRemaining[0] > 0 || degreesRemaining[1] > 0) {
        if (!this.isConnected()) {
          throw new DeviceNotConnected();
        }
        if (Date.now() >= deadline) {
          throw new CommunicationError('Timed out waiting for stepper motion to finish');
        }
        await this._delay(50);
        if (!this.isConnected()) {
          throw new DeviceNotConnected();
        }
        degreesRemaining = await this._getStepperRemaining();
      }
    }
  }

  /**
   * How long to wait for a finite stepper move before giving up.
   * Based on distance, speed, and the configured command timeout.
   */
  private _stepperWaitBudgetMs(
    speedA: number | null,
    accelerationA: number | null,
    distanceA: number | null,
    speedB: number | null,
    accelerationB: number | null,
    distanceB: number | null,
  ): number {
    const budget = (speed: number | null, acceleration: number | null, distance: number | null) => {
      const dist = typeof distance === 'number' ? Math.abs(distance) : 0;
      if (dist === 0) return 0;
      const spd = Math.abs(speed ?? 0);
      if (spd <= 0) return this._options.commandTimeout;
      const cruiseMs = (dist / spd) * 1000;
      const acc = Math.abs(acceleration ?? 0);
      const rampMs = acc > 0 ? (spd / acc) * 2000 : 0;
      return cruiseMs + rampMs + this._options.commandTimeout;
    };
    return Math.max(
      budget(speedA, accelerationA, distanceA),
      budget(speedB, accelerationB, distanceB),
      this._options.commandTimeout,
    );
  }

  /**
   * Rotate a single stepper through specified distance
   * @param port Port of stepper ('A' or 'B')
   * @param speed Target velocity (deg/s)
   * @param acceleration Acceleration (deg/s/s)
   * @param distance Distance (deg)
   * @param awaitCompletion Whether to wait for completion
   */
  async rotateStepperThrough(
    port: MotorPort,
    speed: number,
    acceleration: number,
    distance: number,
    awaitCompletion: boolean = false,
  ): Promise<void> {
    const normalizedPort = normalizeMotorPort(port);
    if (normalizedPort === 'A') {
      await this.rotateSteppersThrough(
        speed,
        acceleration,
        distance,
        null,
        null,
        null,
        awaitCompletion,
      );
    } else {
      await this.rotateSteppersThrough(
        null,
        null,
        null,
        speed,
        acceleration,
        distance,
        awaitCompletion,
      );
    }
  }

  // ==================== Servos ====================

  /**
   * Calculate PWM on-time for servo control
   * @internal
   */
  protected _calculateOnTime(measureType: ServoType, value: number): number {
    if (measureType === 'standard') {
      return Math.round(value + 150);
    } else if (measureType === 'continuous') {
      return Math.round(0.2 * value + 150);
    }
    return 0;
  }

  /**
   * Set both servos
   * @param ch1Type Servo 1 type ('standard', 'continuous', or 0 for off)
   * @param ch1Value Servo 1 value (degrees or percent speed)
   * @param ch2Type Servo 2 type ('standard', 'continuous', or 0 for off)
   * @param ch2Value Servo 2 value (degrees or percent speed)
   */
  async setServos(
    ch1Type: ServoType,
    ch1Value: number,
    ch2Type: ServoType,
    ch2Value: number,
  ): Promise<void> {
    if (!this.isConnected()) {
      throw new DeviceNotConnected();
    }

    // Determine channels
    let channels = (ch1Type !== 0 ? 1 : 0) + (ch2Type !== 0 ? 2 : 0);
    if (channels === 0) channels = 3; // All off command goes to both

    const period1 = 2000; // 20ms period
    const period2 = 2000;
    const onTime1 = this._calculateOnTime(ch1Type, ch1Value);
    const onTime2 = this._calculateOnTime(ch2Type, ch2Value);

    const cmd = [
      PASCOBLEDevice.GCMD_CONTROL_NODE_CMD,
      ControlNodeDevice.CTRLNODE_CMD_SET_SERVO,
      channels,
      onTime1 & 0xff,
      (onTime1 >> 8) & 0xff,
      period1 & 0xff,
      (period1 >> 8) & 0xff,
      onTime2 & 0xff,
      (onTime2 >> 8) & 0xff,
      period2 & 0xff,
      (period2 >> 8) & 0xff,
    ];

    await this.writeAwaitCallback(PASCOBLEDevice.SENSOR_SERVICE_ID, cmd, { retry: false });
  }

  /**
   * Set a single servo
   * @param port Servo channel (1 or 2)
   * @param type Servo type ('standard' or 'continuous')
   * @param value Degrees or percent speed
   */
  async setServo(port: ServoPort, type: ServoType, value: number): Promise<void> {
    validateServoPort(port);
    if (port === 1) {
      await this.setServos(type, value, 0, 0);
    } else {
      await this.setServos(0, 0, type, value);
    }
  }

  // ==================== Power Board ====================

  /**
   * Control the power output board
   * @param port Power Out port ('A' or 'B')
   * @param channel Channel (1 or 2)
   * @param outputType 'USB' or 'terminal'
   * @param value ON/OFF for USB (0 or 1) or percent power for terminal (-100 to 100)
   */
  async setPowerOut(
    port: MotorPort,
    channel: PowerChannel,
    outputType: OutputType,
    value: number,
  ): Promise<void> {
    const normalizedPort = normalizeMotorPort(port);
    validatePowerChannel(channel);

    const encodeWhichPins: Record<string, number> = {
      'A,1': 3,
      'A,2': 12,
      'B,1': 48,
      'B,2': 192,
    };

    const firstPinIndices: Record<string, number> = {
      'A,1': 0,
      'A,2': 2,
      'B,1': 4,
      'B,2': 6,
    };

    const key = `${normalizedPort},${channel}`;
    const whichPins = encodeWhichPins[key]!;
    const firstPinIndex = firstPinIndices[key]!;

    const lsbPwmPeriod =
      outputType.toLowerCase() === 'terminal' ? ControlNodeDevice.LSB_PWM_PERIOD : 0x00;
    const msbPwmPeriod =
      outputType.toLowerCase() === 'terminal' ? ControlNodeDevice.MSB_PWM_PERIOD : 0x00;

    const values = [0, 0, 0, 0, 0, 0, 0, 0];

    if (outputType.toUpperCase() === 'USB') {
      values[firstPinIndex] = value > 0 ? 255 : 0;
    } else if (outputType.toLowerCase() === 'terminal') {
      const dutyCycle = Math.round(2.53 * Math.abs(value) + 1);
      const i = value >= 0 ? firstPinIndex : firstPinIndex + 1;
      values[i] = dutyCycle;
    }

    const cmd = [
      PASCOBLEDevice.GCMD_CONTROL_NODE_CMD,
      ControlNodeDevice.CTRLNODE_CMD_SET_SIGNALS,
      whichPins,
      lsbPwmPeriod,
      msbPwmPeriod,
      ...values,
    ];

    await this.writeAwaitCallback(PASCOBLEDevice.SENSOR_SERVICE_ID, cmd, { retry: false });
  }

  /**
   * Set the frequency of the control node's built-in speaker
   * @param frequency Frequency in Hertz (0-20000)
   */
  async setSoundFrequency(frequency: number): Promise<void> {
    if (!this.isConnected()) {
      throw new DeviceNotConnected();
    }
    validateNumber(frequency, 'frequency');

    const freq = Math.round(limit(frequency, 0, 20000));

    const cmd = [
      PASCOBLEDevice.GCMD_CONTROL_NODE_CMD,
      ControlNodeDevice.CTRLNODE_CMD_SET_BEEPER,
      freq & 0xff,
      (freq >> 8) & 0xff,
    ];

    await this.writeAwaitCallback(PASCOBLEDevice.SENSOR_SERVICE_ID, cmd, { retry: false });
  }

  // ==================== Greenhouse Light ====================

  /**
   * Control the greenhouse light
   * @param port Port ('A' or 'B')
   * @param red Percent power of red light (0-100)
   * @param blue Percent power of blue light (0-100)
   */
  async setGreenhouseLight(port: MotorPort, red: number, blue: number): Promise<void> {
    const normalizedPort = normalizeMotorPort(port);
    const whichPins: Record<StrictMotorPort, number> = { A: 0x0f, B: 0xf0 };
    const pins = whichPins[normalizedPort];

    // Brightness is inverted: +5V turns off the light
    const redValue = Math.round((100 - red) * 2.55) + 1;
    const blueValue = Math.round((100 - blue) * 2.55) + 1;

    let values: number[];
    if (normalizedPort === 'A') {
      values = [redValue, 0, blueValue, 0];
    } else {
      values = [0, 0, 0, 0, redValue, 0, blueValue, 0];
    }

    const cmd = [
      PASCOBLEDevice.GCMD_CONTROL_NODE_CMD,
      ControlNodeDevice.CTRLNODE_CMD_SET_SIGNALS,
      pins,
      ControlNodeDevice.LSB_PWM_PERIOD,
      ControlNodeDevice.MSB_PWM_PERIOD,
      ...values,
    ];

    await this.writeAwaitCallback(PASCOBLEDevice.SENSOR_SERVICE_ID, cmd, { retry: false });
  }

  // ==================== Convenience ====================

  /**
   * Turn off all accessories on the control node
   */
  async reset(): Promise<void> {
    if (!this.isConnected()) {
      throw new DeviceNotConnected();
    }

    const cmd = [
      PASCOBLEDevice.GCMD_CONTROL_NODE_CMD,
      ControlNodeDevice.CTRLNODE_CMD_STOP_ACCESSORIES,
    ];
    await this.writeAwaitCallback(PASCOBLEDevice.SENSOR_SERVICE_ID, cmd, { retry: false });
  }

  /**
   * Disconnect from device, resetting all accessories first.
   * GATT is closed even when the accessory reset fails.
   */
  override async disconnect(): Promise<void> {
    try {
      if (this.isConnected()) {
        await this.reset();
      }
    } finally {
      await super.disconnect();
    }
  }
}
