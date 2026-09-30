import { describe, expect, it } from 'vitest';

import { BLEAdapterBase, type BLEClientBase } from '@/ble/ble-adapter.js';
import { PASCOBLEDevice } from '@/device/pasco-ble-device.js';
import { BLEConnectionError, InvalidParameter } from '@/errors.js';
import type { BLEDevice } from '@/types/ble.js';
import { COMPATIBLE_DEVICES } from '@/types/device.js';

/**
 * Adapter that records the name filters passed to scan() and returns a fixed
 * device list, so connectById can be tested without Web Bluetooth.
 */
class RecordingAdapter extends BLEAdapterBase {
  filters: string[] | undefined;

  constructor(private readonly devices: BLEDevice[] = []) {
    super();
  }

  async scan(nameFilters?: string[]): Promise<BLEDevice[]> {
    this.filters = nameFilters;
    return this.devices;
  }

  async stopScan(): Promise<void> {}

  createClient(): BLEClientBase {
    throw new Error('not used');
  }

  isAvailable(): boolean {
    return true;
  }
}

describe('PASCOBLEDevice.connectById', () => {
  it('filters on "{DeviceType} {SerialId}" prefixes for every compatible device type', async () => {
    const adapter = new RecordingAdapter();
    const device = new PASCOBLEDevice(adapter);

    await expect(device.connectById('481-782')).rejects.toBeInstanceOf(BLEConnectionError);

    expect(adapter.filters).toEqual(COMPATIBLE_DEVICES.map((type) => `${type} 481-782`));
    expect(adapter.filters).toContain('//code.Node 481-782');
    expect(adapter.filters).toContain('Temperature 481-782');
  });

  it('accepts an ID without the dash', async () => {
    const adapter = new RecordingAdapter();
    const device = new PASCOBLEDevice(adapter);

    await expect(device.connectById('481782')).rejects.toBeInstanceOf(BLEConnectionError);

    expect(adapter.filters).toContain('//control.Node 481-782');
  });

  it('does not connect to a device whose name lacks the requested ID', async () => {
    const adapter = new RecordingAdapter([
      { name: 'Temperature 123-456-1025', address: 'x', rssi: 0 },
    ]);
    const device = new PASCOBLEDevice(adapter);

    await expect(device.connectById('481-782')).rejects.toThrow(
      "Device with ID '481-782' not found",
    );
  });

  it.each(['', '48-782', '481-78a', 'Temperature 481-782'])(
    'rejects malformed ID %j',
    async (id) => {
      const device = new PASCOBLEDevice(new RecordingAdapter());

      await expect(device.connectById(id)).rejects.toBeInstanceOf(InvalidParameter);
    },
  );
});
