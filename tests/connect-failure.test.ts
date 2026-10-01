import { describe, expect, it } from 'vitest';

import { BLEAdapterBase, BLEClientBase } from '@/ble/ble-adapter.js';
import { PASCOBLEDevice } from '@/device/pasco-ble-device.js';
import { BLEConnectionError } from '@/errors.js';
import type { BLEDevice, NotifyCallback } from '@/types/ble.js';

class NotificationFailureClient extends BLEClientBase {
  disconnects = 0;

  constructor() {
    super('device-address');
    this._services = [
      {
        uuid: '4a5c0000-0000-0000-0000-5c1e741f1c00',
        characteristics: [
          {
            uuid: '4a5c0000-0003-0000-0000-5c1e741f1c00',
            handle: 3,
            properties: ['notify'],
          },
        ],
      },
    ];
  }

  async connect(): Promise<void> {
    this._isConnected = true;
  }

  async disconnect(): Promise<void> {
    this.disconnects += 1;
    this._isConnected = false;
  }

  async writeGattChar(_uuid: string, _data: Uint8Array): Promise<void> {}
  async readGattChar(_uuid: string): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async startNotify(_uuid: string, _callback: NotifyCallback): Promise<void> {
    throw new Error('notification setup failed');
  }
  async stopNotify(_uuid: string): Promise<void> {}
  async discoverServicesAndCharacteristics(): Promise<void> {}
}

class NotificationFailureAdapter extends BLEAdapterBase {
  readonly client = new NotificationFailureClient();

  async scan(): Promise<BLEDevice[]> {
    return [];
  }
  async stopScan(): Promise<void> {}
  createClient(): BLEClientBase {
    return this.client;
  }
  isAvailable(): boolean {
    return true;
  }
}

describe('PASCOBLEDevice connection cleanup', () => {
  it('disconnects and permits another attempt when notification setup fails', async () => {
    const adapter = new NotificationFailureAdapter();
    const device = new PASCOBLEDevice(adapter);
    const sensor: BLEDevice = {
      name: 'Temperature 123-456-1',
      address: 'device-address',
      rssi: 0,
    };

    await expect(device.connect(sensor)).rejects.toBeInstanceOf(BLEConnectionError);
    expect(device.connectionState).toBe('disconnected');
    expect(device.client).toBeNull();
    expect(adapter.client.disconnects).toBe(1);

    await expect(device.connect(sensor)).rejects.toBeInstanceOf(BLEConnectionError);
    expect(adapter.client.disconnects).toBe(2);
  });
});
