import { describe, expect, it } from 'vitest';

import { MeasurementDecoder } from '@/device/measurement-decoder.js';
import { SensorState } from '@/device/sensor-state.js';
import type { Measurement } from '@/types/index.js';

/**
 * Build a SensorState pre-populated with a single sensor that has one
 * measurement, plus a raw little-endian data stack ready to decode.
 */
function makeState(sensorId: number, measurement: Measurement, stack: number[]): SensorState {
  const state = new SensorState();
  state.initMeasurementsForSensor(sensorId);
  state.setMeasurement(sensorId, measurement.ID, measurement);
  state.initSensorDataForSensor(sensorId);
  state.setSensorValue(sensorId, measurement.ID, null);
  state.setDataStack(sensorId, stack);
  return state;
}

describe('MeasurementDecoder RawDigital', () => {
  const sensorId = 0;

  it('decodes a positive 4-byte value', () => {
    const m: Measurement = { ID: 1, NameTag: 'Count', Type: 'RawDigital', DataSize: 4, Visible: 1 };
    // 100 as little-endian 32-bit
    const state = makeState(sensorId, m, [0x64, 0x00, 0x00, 0x00]);
    new MeasurementDecoder(state).decode(sensorId);
    expect(state.getSensorValue(sensorId, 1)).toBe(100);
  });

  // Regression for the 32-bit two's-complement bug: a 4-byte value with the
  // high bit set must decode as a negative number, not a ~4-billion positive.
  it('decodes a negative 4-byte value (two-s complement)', () => {
    const m: Measurement = { ID: 1, NameTag: 'Count', Type: 'RawDigital', DataSize: 4, Visible: 1 };
    // 0xFFFFFFFF little-endian => -1
    const state = makeState(sensorId, m, [0xff, 0xff, 0xff, 0xff]);
    new MeasurementDecoder(state).decode(sensorId);
    expect(state.getSensorValue(sensorId, 1)).toBe(-1);
  });

  it('decodes a signed 2-byte value when TwosComp is set', () => {
    const m: Measurement = {
      ID: 1,
      NameTag: 'Temp',
      Type: 'RawDigital',
      DataSize: 2,
      TwosComp: '1',
      Visible: 1,
    };
    // 0xFF9C little-endian => -100
    const state = makeState(sensorId, m, [0x9c, 0xff]);
    new MeasurementDecoder(state).decode(sensorId);
    expect(state.getSensorValue(sensorId, 1)).toBe(-100);
  });

  it('publishes visible results by name', () => {
    const m: Measurement = { ID: 1, NameTag: 'Count', Type: 'RawDigital', DataSize: 4, Visible: 1 };
    const state = makeState(sensorId, m, [0x0a, 0x00, 0x00, 0x00]);
    new MeasurementDecoder(state).decode(sensorId);
    expect(state.getResult('Count')).toBe(10);
  });
});

describe('MeasurementDecoder LinearConv', () => {
  const sensorId = 0;

  it('applies y = m*x + b using an input measurement', () => {
    const state = new SensorState();
    state.initMeasurementsForSensor(sensorId);
    // Raw input measurement (ID 1) and derived linear measurement (ID 2).
    const raw: Measurement = { ID: 1, NameTag: 'Raw', Type: 'RawDigital', DataSize: 2, Visible: 0 };
    const linear: Measurement = {
      ID: 2,
      NameTag: 'Scaled',
      Type: 'LinearConv',
      Inputs: '1',
      Params: '2,3',
      Visible: 1,
    };
    state.setMeasurement(sensorId, 1, raw);
    state.setMeasurement(sensorId, 2, linear);
    state.initSensorDataForSensor(sensorId);
    state.setSensorValue(sensorId, 1, null);
    state.setSensorValue(sensorId, 2, null);
    state.setDataStack(sensorId, [10, 0]); // raw = 10

    new MeasurementDecoder(state).decode(sensorId);

    expect(state.getSensorValue(sensorId, 1)).toBe(10);
    expect(state.getSensorValue(sensorId, 2)).toBe(23); // 2*10 + 3
    expect(state.getResult('Scaled')).toBe(23);
  });
});
