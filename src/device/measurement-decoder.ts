/**
 * Measurement Decoder
 *
 * Handles decoding of raw sensor data into measurement values.
 */

import type { Measurement } from '@/types/index.js';
import { binaryFraction, twosComplement } from '@/utils/binary.js';
import { evaluateEquation } from '@/utils/equation-parser.js';
import {
  calc4Params,
  calcLinearParams,
  calcRotaryPos,
  limit,
  threeInputVector,
} from '@/utils/math.js';

import { CouldNotDecodeData, InvalidEquation } from '../errors.js';
import type { SensorStateAccess } from './sensor-state.js';

/**
 * Decodes raw binary data from sensors into calculated measurement values
 */
export class MeasurementDecoder {
  private readonly _state: SensorStateAccess;

  constructor(state: SensorStateAccess) {
    this._state = state;
  }

  /**
   * Decode data for a specific sensor
   */
  decode(sensorId: number): void {
    try {
      // Save previous data for derivative calculations
      this._state.savePreviousSensorData(sensorId);

      const measurements = this._state.getMeasurements(sensorId);
      if (!measurements) return;

      // Phase 1: Decode raw measurements from binary data
      this._decodeRawMeasurements(sensorId, measurements);

      // Phase 2: Calculate derived measurements
      this._calculateDerivedMeasurements(sensorId, measurements);

      // Phase 3: Update visible results map
      this._updateVisibleResults();
    } catch (e) {
      if (e instanceof CouldNotDecodeData || e instanceof InvalidEquation) {
        throw e;
      }
      throw new CouldNotDecodeData();
    }
  }

  /**
   * Decode raw measurements from binary stack
   */
  private _decodeRawMeasurements(
    sensorId: number,
    measurements: ReadonlyMap<number, Measurement>,
  ): void {
    for (const [mId, m] of measurements) {
      let resultValue: number | null = null;

      if (m.Type === 'RawDigital' && m.DataSize) {
        resultValue = this._decodeRawDigital(m, sensorId);
      } else if (m.Type === 'Direct' && m.DataSize) {
        resultValue = this._decodeDirect(m, sensorId);
      } else if (m.Type === 'Constant') {
        resultValue = this._decodeConstant(m);
      }

      this._state.setSensorValue(sensorId, mId, resultValue);
    }
  }

  /**
   * Decode RawDigital measurement type
   */
  private _decodeRawDigital(m: Measurement, sensorId: number): number {
    const bytes = this._state.consumeFromDataStack(sensorId, m.DataSize!);
    let byteValue = 0;
    for (let d = 0; d < bytes.length; d++) {
      byteValue += (bytes[d] ?? 0) * 2 ** (8 * d);
    }

    if (m.DataSize === 4 || (m.TwosComp && parseInt(m.TwosComp, 10) === 1)) {
      byteValue = twosComplement(byteValue, m.DataSize!);
    }

    return byteValue;
  }

  /**
   * Decode Direct measurement type
   */
  private _decodeDirect(m: Measurement, sensorId: number): number {
    const bytes = this._state.consumeFromDataStack(sensorId, m.DataSize!);
    let byteValue = 0;
    for (let d = 0; d < bytes.length; d++) {
      byteValue += (bytes[d] ?? 0) * 2 ** (8 * d);
    }

    let resultValue: number;
    if (m.DataSize === 4) {
      byteValue = twosComplement(byteValue, m.DataSize);
      resultValue = binaryFraction(byteValue);
    } else {
      resultValue = byteValue;
    }

    if (m.Precision !== undefined) {
      resultValue = Math.round(resultValue * 10 ** m.Precision) / 10 ** m.Precision;
    }

    return resultValue;
  }

  /**
   * Decode Constant measurement type
   */
  private _decodeConstant(m: Measurement): number {
    let value = typeof m.Value === 'number' ? m.Value : parseFloat(m.Value?.toString() ?? '0');

    if (m.Precision !== undefined) {
      value = Math.round(value * 10 ** m.Precision) / 10 ** m.Precision;
    }

    return value;
  }

  /**
   * Calculate derived measurements that depend on raw values
   */
  private _calculateDerivedMeasurements(
    sensorId: number,
    measurements: ReadonlyMap<number, Measurement>,
  ): void {
    for (const [mId, m] of measurements) {
      const currentValue = this._state.getSensorValue(sensorId, mId);
      if (currentValue !== null) continue;

      let resultValue = this._getMeasurementValue(sensorId, mId);

      if (m.Precision !== undefined && resultValue !== null) {
        resultValue = Math.round(resultValue * 10 ** m.Precision) / 10 ** m.Precision;
      }

      if (m.Limits && resultValue !== null) {
        const limits = m.Limits.split(',').map((l) => parseInt(l, 10));
        if (limits.length === 2 && limits[0] !== undefined && limits[1] !== undefined) {
          resultValue = limit(resultValue, limits[0], limits[1]);
        }
      }

      this._state.setSensorValue(sensorId, mId, resultValue);
    }
  }

  /**
   * Get the calculated value for a measurement
   */
  private _getMeasurementValue(sensorId: number, measurementId: number): number | null {
    const m = this._state.getMeasurement(sensorId, measurementId);
    if (!m) return null;

    if (m.Inputs !== undefined) {
      return this._calculateWithInput(m, sensorId);
    }

    if (m.Equation) {
      return this._calculateWithEquation(m, sensorId);
    }

    return null;
  }

  /**
   * Calculate measurement value using input references
   */
  private _calculateWithInput(m: Measurement, sensorId: number): number | null {
    const inputStr = m.Inputs?.toString() ?? '';

    switch (m.Type) {
      case 'ThreeInputVector':
        return this._calcThreeInputVector(inputStr, sensorId);
      case 'Select':
        return this._calcSelect(inputStr, sensorId);
      case 'UserCal':
      case 'FactoryCal':
        return this._calcCalibration(m, inputStr, sensorId);
      case 'LinearConv':
        return this._calcLinear(m, inputStr, sensorId);
      case 'Derivative':
        return this._calcDerivative(inputStr, sensorId);
      case 'RotaryPos':
        return this._calcRotary(m, inputStr, sensorId);
      default:
        return null;
    }
  }

  /**
   * Calculate 3D vector magnitude from three inputs
   */
  private _calcThreeInputVector(inputStr: string, sensorId: number): number | null {
    const inputs = inputStr.split(',').map((i) => parseInt(i, 10));
    if (inputs.length !== 3) return null;

    const ax = this._state.getSensorValue(sensorId, inputs[0]!);
    const ay = this._state.getSensorValue(sensorId, inputs[1]!);
    const az = this._state.getSensorValue(sensorId, inputs[2]!);

    if (ax == null || ay == null || az == null) return null;
    return threeInputVector(ax, ay, az);
  }

  /**
   * Select value from input
   */
  private _calcSelect(inputStr: string, sensorId: number): number | null {
    const inputs = inputStr.split(',').map((i) => parseInt(i, 10));
    const needInput = inputs[0];
    if (needInput === undefined) return null;

    const value = this._state.getSensorValue(sensorId, needInput);
    if (value != null) return value;

    return this._getMeasurementValue(sensorId, needInput);
  }

  /**
   * Calculate calibrated value using 4-parameter calibration
   */
  private _calcCalibration(m: Measurement, inputStr: string, sensorId: number): number | null {
    const inputValue = this._getInputValue(inputStr, sensorId);
    if (inputValue === null) return null;

    const params = (m.Params ?? '').split(',').map((p) => parseFloat(p));
    if (params.length < 4) return null;

    return calc4Params(inputValue, params[0]!, params[1]!, params[2]!, params[3]!);
  }

  /**
   * Calculate linear conversion
   */
  private _calcLinear(m: Measurement, inputStr: string, sensorId: number): number | null {
    const inputValue = this._getInputValue(inputStr, sensorId);
    if (inputValue === null) return null;

    const params = (m.Params ?? '').split(',').map((p) => parseFloat(p));
    if (params.length < 2) return null;

    return calcLinearParams(inputValue, params[0]!, params[1]!);
  }

  /**
   * Calculate derivative (rate of change)
   */
  private _calcDerivative(inputStr: string, sensorId: number): number | null {
    const needInput = parseInt(inputStr, 10);
    const inputValue = this._getInputValue(inputStr, sensorId);
    if (inputValue === null) return null;

    const prevValue = this._state.getPreviousSensorValue(sensorId, needInput);
    if (prevValue == null) return null;

    // Rate of change over the fixed two-sample window used by the PASCO
    // protocol (matches the reference implementation's derivative divisor).
    return (inputValue - prevValue) / 2;
  }

  /**
   * Calculate rotary position
   */
  private _calcRotary(m: Measurement, inputStr: string, sensorId: number): number | null {
    const inputValue = this._getInputValue(inputStr, sensorId);
    if (inputValue === null) return null;

    const params = (m.Params ?? '').split(',').map((p) => parseFloat(p));
    if (params.length < 2) return null;

    const currentVal = typeof m.Value === 'number' ? m.Value : 0;
    const newVal = currentVal + calcRotaryPos(inputValue, params[0]!, params[1]!);
    m.Value = newVal;
    return newVal;
  }

  /**
   * Get input value from stored data or calculate it
   */
  private _getInputValue(inputStr: string, sensorId: number): number | null {
    const needInput = parseInt(inputStr, 10);
    const storedValue = this._state.getSensorValue(sensorId, needInput);

    if (storedValue != null) return storedValue;
    return this._getMeasurementValue(sensorId, needInput);
  }

  /**
   * Calculate measurement value using equation
   */
  private _calculateWithEquation(m: Measurement, sensorId: number): number | null {
    const rawEquation = m.Equation ?? '';
    const variables: Record<string, number | null> = {};
    const varMatches = rawEquation.match(/\[([0-9_]+)\]/g) || [];

    for (const match of varMatches) {
      const varKey = match.slice(1, -1);
      const varId = parseInt(varKey, 10);

      let value = this._state.getSensorValue(sensorId, varId);
      if (value == null) {
        value = this._getMeasurementValue(sensorId, varId);
      }

      variables[varKey] = value ?? null;
    }

    try {
      return evaluateEquation(rawEquation, variables);
    } catch {
      throw new InvalidEquation();
    }
  }

  /**
   * Update the visible results map with decoded values
   */
  private _updateVisibleResults(): void {
    // Get all sensor IDs that have measurements
    const deviceMeasurements = this._state.deviceMeasurementsMap;
    for (const [sid, meas] of deviceMeasurements) {
      for (const [mId, m] of meas) {
        if (m.Visible === 1) {
          const value = this._state.getSensorValue(sid, mId);
          if (value != null) {
            this._state.setResult(m.NameTag, value);
          }
        }
      }
    }
  }
}
