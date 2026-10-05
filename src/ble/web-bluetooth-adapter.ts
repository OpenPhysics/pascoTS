/**
 * Web Bluetooth API Adapter
 *
 * Browser implementation of the BLE adapter using the Web Bluetooth API.
 * Requires HTTPS context and user gesture to initiate scan/connect.
 */

import type { BLECharacteristic, BLEDevice, NotifyCallback } from '@/types/ble.js';
import { COMPATIBLE_DEVICES } from '@/types/device.js';
import { copyDataView } from '@/utils/binary.js';

import { BLEAdapterBase, BLEClientBase, getServiceIdFromUuid, isPascoUuid } from './ble-adapter.js';

/** GATT services requested for every PASCO device, including //control.Node PluginB (service 5). */
const PASCO_OPTIONAL_SERVICES = [
  '4a5c0000-0000-0000-0000-5c1e741f1c00',
  '4a5c0001-0000-0000-0000-5c1e741f1c00',
  '4a5c0002-0000-0000-0000-5c1e741f1c00',
  '4a5c0003-0000-0000-0000-5c1e741f1c00',
  '4a5c0004-0000-0000-0000-5c1e741f1c00',
  '4a5c0005-0000-0000-0000-5c1e741f1c00',
  '4a5c0006-0000-0000-0000-5c1e741f1c00',
  '4a5c0007-0000-0000-0000-5c1e741f1c00',
  '4a5c0008-0000-0000-0000-5c1e741f1c00',
  '4a5c0009-0000-0000-0000-5c1e741f1c00',
] as const;

/**
 * Extended BLEDevice that includes the native Web Bluetooth device reference
 */
export interface WebBLEDevice extends BLEDevice {
  _nativeDevice?: BluetoothDevice;
}

/**
 * Result of browser support check
 */
export interface BrowserSupportResult {
  /** Whether Web Bluetooth API is available */
  isSupported: boolean;
  /** Whether the page is served over HTTPS (required for Web Bluetooth) */
  isSecureContext: boolean;
  /** Detailed reason if not supported */
  reason?: string;
}

/** Cached browser support result */
let cachedBrowserSupport: BrowserSupportResult | null = null;

/**
 * Web Bluetooth adapter for browser environments
 */
export class WebBluetoothAdapter extends BLEAdapterBase {
  isAvailable(): boolean {
    return typeof navigator !== 'undefined' && navigator.bluetooth !== undefined;
  }

  /**
   * Check browser support for Web Bluetooth with detailed information.
   * Results are cached after first check for performance.
   * @returns Detailed browser support information
   */
  static checkBrowserSupport(): BrowserSupportResult {
    if (cachedBrowserSupport !== null) {
      return cachedBrowserSupport;
    }

    // Check if running in browser
    if (typeof navigator === 'undefined' || typeof window === 'undefined') {
      cachedBrowserSupport = {
        isSupported: false,
        isSecureContext: false,
        reason: 'Not running in a browser environment',
      };
      return cachedBrowserSupport;
    }

    // Check secure context (HTTPS required)
    const isSecureContext = window.isSecureContext ?? false;
    if (!isSecureContext) {
      cachedBrowserSupport = {
        isSupported: false,
        isSecureContext: false,
        reason: 'Web Bluetooth requires HTTPS (secure context)',
      };
      return cachedBrowserSupport;
    }

    // Check Web Bluetooth API availability
    if (!navigator.bluetooth) {
      cachedBrowserSupport = {
        isSupported: false,
        isSecureContext: true,
        reason:
          'Web Bluetooth API not available. Supported browsers: Chrome 56+, Edge 79+, Opera 43+',
      };
      return cachedBrowserSupport;
    }

    cachedBrowserSupport = {
      isSupported: true,
      isSecureContext: true,
    };
    return cachedBrowserSupport;
  }

  /**
   * Clear the cached browser support result.
   * Useful for testing or when conditions may have changed.
   */
  static clearBrowserSupportCache(): void {
    cachedBrowserSupport = null;
  }

  async scan(nameFilters?: string[], _timeout?: number): Promise<WebBLEDevice[]> {
    if (!this.isAvailable()) {
      throw new Error('Web Bluetooth API is not available');
    }

    try {
      // Web Bluetooth requires explicit user gesture and uses requestDevice
      // which shows a picker dialog rather than returning all devices
      const filters = (nameFilters ?? [...COMPATIBLE_DEVICES]).map((name) => ({
        namePrefix: name,
      }));

      // Request device with PASCO service UUID filter
      const device = await navigator.bluetooth.requestDevice({
        filters,
        optionalServices: [...PASCO_OPTIONAL_SERVICES],
      });

      // Return the selected device with native reference preserved
      return [
        {
          name: device.name ?? null,
          address: device.id,
          rssi: 0, // Web Bluetooth doesn't expose RSSI during scan
          _nativeDevice: device,
        },
      ];
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFoundError') {
        // User cancelled the picker
        return [];
      }
      throw error;
    }
  }

  async stopScan(): Promise<void> {
    // Web Bluetooth doesn't support stopping scans as it uses a picker dialog
  }

  createClient(device: BLEDevice): WebBluetoothClient {
    const webDevice = device as WebBLEDevice;
    return new WebBluetoothClient(device.address, device.name, webDevice._nativeDevice);
  }
}

/**
 * Web Bluetooth client implementation
 */
export class WebBluetoothClient extends BLEClientBase {
  private _device: BluetoothDevice | null = null;
  private _server: BluetoothRemoteGATTServer | null = null;
  private _characteristics: Map<string, BluetoothRemoteGATTCharacteristic> = new Map();
  private _deviceName: string | null;
  /** Incremented when an attempt is abandoned so a late gatt.connect() cannot stay open. */
  private _connectGeneration = 0;
  private _gattDisconnectListener: (() => void) | null = null;
  private _notifyListeners = new Map<string, (event: Event) => void>();

  constructor(address: string, name: string | null = null, nativeDevice?: BluetoothDevice) {
    super(address);
    this._deviceName = name;
    this._device = nativeDevice ?? null;
  }

  async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth API is not available');
    }

    const generation = ++this._connectGeneration;

    try {
      // If we don't have a device yet (e.g., connectById flow), we need to request one
      if (!this._device) {
        const filters: BluetoothLEScanFilter[] = [];
        if (this._deviceName) {
          filters.push({ name: this._deviceName });
        }

        this._device = await navigator.bluetooth.requestDevice({
          filters: filters.length > 0 ? filters : undefined,
          acceptAllDevices: filters.length === 0,
          optionalServices: [...PASCO_OPTIONAL_SERVICES],
        });
        this._throwIfAbandoned(generation, null);
      }

      // Connect to GATT server. A timeout may abandon this attempt before it resolves.
      const server = (await this._device.gatt?.connect()) ?? null;
      this._throwIfAbandoned(generation, server);
      if (!server) {
        throw new Error('Failed to connect to GATT server');
      }

      this._server = server;
      this._isConnected = true;
      await this.discoverServicesAndCharacteristics();
      this._throwIfAbandoned(generation, this._server);

      this._attachGattDisconnectListener();
    } catch (error) {
      if (generation === this._connectGeneration) {
        this._isConnected = false;
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    // Abandon any gatt.connect() that has not returned yet.
    this._connectGeneration++;
    this._detachGattDisconnectListener();
    this._detachAllNotifyListeners();
    if (this._server?.connected) {
      this._server.disconnect();
    }
    this._isConnected = false;
    this._server = null;
    this._characteristics.clear();
  }

  /**
   * Drop a GATT server that belongs to an attempt disconnect() or a timeout already gave up on.
   */
  private _throwIfAbandoned(generation: number, server: BluetoothRemoteGATTServer | null): void {
    if (generation === this._connectGeneration) return;
    this._isConnected = false;
    if (server?.connected) {
      server.disconnect();
    }
    if (this._server === server) {
      this._server = null;
    }
    throw new Error('Connection attempt abandoned');
  }

  private _attachGattDisconnectListener(): void {
    if (!this._device) return;
    this._detachGattDisconnectListener();
    this._gattDisconnectListener = () => {
      this._detachGattDisconnectListener();
      this._isConnected = false;
      this._server = null;
      this._notifyUnexpectedDisconnect();
    };
    this._device.addEventListener('gattserverdisconnected', this._gattDisconnectListener);
  }

  private _detachGattDisconnectListener(): void {
    if (this._device && this._gattDisconnectListener) {
      this._device.removeEventListener('gattserverdisconnected', this._gattDisconnectListener);
    }
    this._gattDisconnectListener = null;
  }

  async discoverServicesAndCharacteristics(): Promise<void> {
    if (!this._server) {
      throw new Error('Not connected to GATT server');
    }

    this._services = [];
    this._characteristics.clear();

    // Retry logic for service discovery
    const maxRetries = 3;
    const generation = this._connectGeneration;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check if still connected. A late connect must not outlive an abandoned attempt.
        if (!this._server?.connected) {
          const server = (await this._device?.gatt?.connect()) ?? null;
          this._throwIfAbandoned(generation, server);
          if (!server) {
            throw new Error('Failed to connect to GATT server');
          }
          this._server = server;
        }

        if (!this._server) {
          throw new Error('Not connected to GATT server');
        }
        const services = await this._server.getPrimaryServices();

        for (const service of services) {
          const characteristics = await service.getCharacteristics();
          const charList: BLECharacteristic[] = [];

          for (const char of characteristics) {
            const props: string[] = [];
            if (char.properties.read) props.push('read');
            if (char.properties.write) props.push('write');
            if (char.properties.writeWithoutResponse) props.push('write-without-response');
            if (char.properties.notify) props.push('notify');
            if (char.properties.indicate) props.push('indicate');

            charList.push({
              uuid: char.uuid,
              handle: 0, // Web Bluetooth doesn't expose handles
              properties: props,
            });

            // Cache characteristic for later use
            this._characteristics.set(char.uuid, char);
          }

          this._services.push({
            uuid: service.uuid,
            characteristics: charList,
          });
        }

        // Success - exit retry loop
        return;
      } catch (error) {
        if (generation !== this._connectGeneration) {
          throw error;
        }
        if (attempt < maxRetries) {
          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    // Service discovery failed after all retries
    throw new Error('Service discovery failed after all retries');
  }

  async writeGattChar(uuid: string, data: Uint8Array): Promise<void> {
    const char = this._characteristics.get(uuid.toLowerCase());
    if (!char) {
      throw new Error(`Characteristic ${uuid} not found`);
    }

    // Create a new ArrayBuffer copy to ensure compatibility with BufferSource
    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);
    if (char.properties.writeWithoutResponse) {
      await char.writeValueWithoutResponse(buffer);
    } else {
      await char.writeValueWithResponse(buffer);
    }
  }

  async readGattChar(uuid: string): Promise<Uint8Array> {
    const char = this._characteristics.get(uuid.toLowerCase());
    if (!char) {
      throw new Error(`Characteristic ${uuid} not found`);
    }

    const value = await char.readValue();
    return copyDataView(value);
  }

  async startNotify(uuid: string, callback: NotifyCallback): Promise<void> {
    const key = uuid.toLowerCase();
    const char = this._characteristics.get(key);
    if (!char) {
      throw new Error(`Characteristic ${uuid} not found`);
    }

    this._notifyCallbacks.set(key, callback);
    this._removeNotifyListener(key);

    const handleValueChanged = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const value = target.value;
      if (value) {
        const data = copyDataView(value);
        const serviceId = isPascoUuid(target.uuid) ? getServiceIdFromUuid(target.uuid) : 0;
        const charInfo: BLECharacteristic = {
          uuid: target.uuid,
          handle: serviceId,
          properties: [],
        };
        callback(charInfo, data);
      }
    };

    this._notifyListeners.set(key, handleValueChanged);
    char.addEventListener('characteristicvaluechanged', handleValueChanged);
    await char.startNotifications();
  }

  async stopNotify(uuid: string): Promise<void> {
    const key = uuid.toLowerCase();
    const char = this._characteristics.get(key);
    this._removeNotifyListener(key);
    this._notifyCallbacks.delete(key);
    if (!char) {
      return;
    }

    try {
      await char.stopNotifications();
    } catch {
      // Ignore errors when stopping notifications
    }
  }

  private _removeNotifyListener(key: string): void {
    const listener = this._notifyListeners.get(key);
    const char = this._characteristics.get(key);
    if (listener && char) {
      char.removeEventListener('characteristicvaluechanged', listener);
    }
    this._notifyListeners.delete(key);
  }

  private _detachAllNotifyListeners(): void {
    for (const key of this._notifyListeners.keys()) {
      this._removeNotifyListener(key);
    }
    this._notifyCallbacks.clear();
  }
}
