import { describe, expect, it, vi } from 'vitest';

import { BLEAdapterBase, type BLEClientBase } from '@/ble/ble-adapter.js';
import { PASCOBLEDevice } from '@/device/pasco-ble-device.js';
import { ProtocolHandler } from '@/device/protocol-handler.js';
import { SensorInitializer } from '@/device/sensor-initializer.js';
import { SensorManager } from '@/device/sensor-manager.js';
import { SensorState } from '@/device/sensor-state.js';
import type { BLEDevice } from '@/types/ble.js';

class UnusedAdapter extends BLEAdapterBase {
  async scan(): Promise<BLEDevice[]> {
    return [];
  }
  async stopScan(): Promise<void> {}
  createClient(): BLEClientBase {
    throw new Error('unused');
  }
  isAvailable(): boolean {
    return false;
  }
}

describe('visible derivative measurements', () => {
  it('includes Velocity and Acceleration and hides internal rows', () => {
    const state = new SensorState();
    const initializer = new SensorInitializer(state);
    initializer.initializeFromInterface(1029);
    initializer.initializeSensors();

    const position = initializer.deviceChannels.find((channel) => channel.sensor_id === 2027);
    expect(position?.measurements).toEqual(
      expect.arrayContaining(['Position', 'Velocity', 'Acceleration']),
    );
    expect(position?.measurements).not.toContain('RawCountChange');
  });
});

describe('//control.Node fixed channels', () => {
  it('initializes stepper channels even when the interface has pluggable ports', async () => {
    class QuietProtocol extends ProtocolHandler {
      override async writeAwaitCallback(): Promise<void> {
        return;
      }
    }

    const manager = new SensorManager({
      protocolHandler: new QuietProtocol(),
      isConnected: () => true,
    });

    await manager.initializeFromInterface(1057);

    const stepper = manager.deviceChannels.find((channel) => channel.id === 0);
    expect(stepper?.measurements).toContain('StepperAngle');
    expect(stepper?.measurements).not.toContain('StepperPosition');
  });

  it('applies a service-0 0x82 plugin payload without dropping fixed channels', async () => {
    const spy = vi
      .spyOn(ProtocolHandler.prototype, 'writeAwaitCallback')
      .mockResolvedValue(undefined);

    class Probe extends PASCOBLEDevice {
      constructor() {
        super(new UnusedAdapter());
      }

      async boot(): Promise<void> {
        this._stateMachine.transitionTo('connecting', 'test');
        this._stateMachine.transitionTo('connected', 'test');
        this._interfaceId = 1057;
        await this._initializeDevice();
      }

      pushPlugins(data: number[]): void {
        this._handleNotification(0, data);
      }
    }

    try {
      const probe = new Probe();
      await probe.boot();
      expect(probe.getMeasurementList()).toContain('StepperAngle');
      expect(probe.getMeasurementList()).not.toContain('Temperature');

      // Sensor 2020 (temperature) as a little-endian id, plus two empty plugin slots.
      probe.pushPlugins([0x82, 0xe4, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00]);

      const measurements = probe.getMeasurementList();
      expect(measurements).toContain('Temperature');
      expect(measurements).toContain('StepperAngle');
    } finally {
      spy.mockRestore();
    }
  });
});
