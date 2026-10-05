/**
 * BLE Adapter Abstract Interface
 *
 * Defines the platform-agnostic interface for BLE operations.
 * Currently only Web Bluetooth (browser) is implemented.
 *
 * The abstract base classes are provided as extension points for developers
 * who need to support other platforms (e.g., Node.js with Noble/Bleno).
 *
 * @example Implementing a custom adapter
 * ```typescript
 * import { BLEAdapterBase, BLEClientBase } from 'pasco-ble/internal';
 *
 * class MyCustomAdapter extends BLEAdapterBase {
 *   scan(nameFilters?: string[]): Promise<BLEDevice[]> { ... }
 *   stopScan(): Promise<void> { ... }
 *   createClient(device: BLEDevice): BLEClientBase { ... }
 *   isAvailable(): boolean { ... }
 * }
 *
 * const device = new PASCOBLEDevice({ adapter: new MyCustomAdapter() });
 * ```
 */

import type { BLECharacteristic, BLEClient, BLEDevice, NotifyCallback } from '@/types/ble.js';

/**
 * Abstract BLE adapter interface
 */
export abstract class BLEAdapterBase {
  /**
   * Scan for BLE devices
   * @param nameFilters Optional array of name substrings to filter devices
   * @param timeout Scan timeout in milliseconds (default: 5000)
   */
  abstract scan(nameFilters?: string[], timeout?: number): Promise<BLEDevice[]>;

  /**
   * Stop an ongoing scan
   */
  abstract stopScan(): Promise<void>;

  /**
   * Create a client for connecting to a device
   * @param device The BLE device to create a client for
   */
  abstract createClient(device: BLEDevice): BLEClientBase;

  /**
   * Check if BLE is available on this platform
   */
  abstract isAvailable(): boolean;
}

/**
 * Abstract BLE client interface for device communication
 */
export abstract class BLEClientBase implements BLEClient {
  protected _address: string;
  protected _isConnected: boolean = false;
  protected _services: { uuid: string; characteristics: BLECharacteristic[] }[] = [];
  protected _notifyCallbacks: Map<string, NotifyCallback> = new Map();
  private _unexpectedDisconnectHandler: (() => void) | null = null;

  constructor(address: string) {
    this._address = address;
  }

  get address(): string {
    return this._address;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get services(): { uuid: string; characteristics: BLECharacteristic[] }[] {
    return this._services;
  }

  /**
   * Called when the link drops without {@link disconnect}.
   * The device state machine uses this to leave the connected state.
   */
  setUnexpectedDisconnectHandler(handler: (() => void) | null): void {
    this._unexpectedDisconnectHandler = handler;
  }

  protected _notifyUnexpectedDisconnect(): void {
    this._unexpectedDisconnectHandler?.();
  }

  /**
   * Connect to the device
   */
  abstract connect(): Promise<void>;

  /**
   * Disconnect from the device
   */
  abstract disconnect(): Promise<void>;

  /**
   * Write data to a GATT characteristic
   * @param uuid The characteristic UUID
   * @param data The data to write
   */
  abstract writeGattChar(uuid: string, data: Uint8Array): Promise<void>;

  /**
   * Read data from a GATT characteristic
   * @param uuid The characteristic UUID
   */
  abstract readGattChar(uuid: string): Promise<Uint8Array>;

  /**
   * Start notifications for a characteristic
   * @param uuid The characteristic UUID
   * @param callback Function to call when data is received
   */
  abstract startNotify(uuid: string, callback: NotifyCallback): Promise<void>;

  /**
   * Stop notifications for a characteristic
   * @param uuid The characteristic UUID
   */
  abstract stopNotify(uuid: string): Promise<void>;

  /**
   * Discover all services and characteristics
   */
  abstract discoverServicesAndCharacteristics(): Promise<void>;
}

// ==================== PASCO UUID Utilities ====================

/**
 * PASCO UUID patterns for matching and validation
 * All PASCO BLE UUIDs follow the format: 4a5c000X-000Y-0000-0000-5c1e741f1c00
 */
export const PASCO_UUID = {
  /** Base prefix for all PASCO UUIDs */
  PREFIX: '4a5c000',
  /** Suffix for all PASCO UUIDs */
  SUFFIX: '5c1e741f1c00',
  /** Pattern to extract service ID (single digit after prefix) */
  SERVICE_ID_PATTERN: /4a5c000(\d)/,
  /** Pattern to extract characteristic ID */
  CHARACTERISTIC_ID_PATTERN: /4a5c000\d-000(\d)/,
} as const;

/**
 * Create a PASCO BLE UUID from service and characteristic IDs
 * Creates UUIDs in the format: 4a5c000X-000Y-0000-0000-5c1e741f1c00
 * where X is the service ID and Y is the characteristic ID
 *
 * @param serviceId The service ID (0-9)
 * @param characteristicId The characteristic ID (0-9)
 * @returns The full UUID string
 */
export function createPascoUuid(serviceId: number, characteristicId: number): string {
  return `${PASCO_UUID.PREFIX}${serviceId}-000${characteristicId}-0000-0000-${PASCO_UUID.SUFFIX}`;
}

/**
 * Extract service ID from a PASCO UUID
 *
 * @param uuid The UUID string to parse
 * @returns The service ID (0-9), or -1 if not a valid PASCO UUID
 */
export function getServiceIdFromUuid(uuid: string): number {
  const match = uuid.toLowerCase().match(PASCO_UUID.SERVICE_ID_PATTERN);
  if (match?.[1]) {
    return parseInt(match[1], 10);
  }
  return -1;
}

/**
 * Extract characteristic ID from a PASCO UUID
 *
 * @param uuid The UUID string to parse
 * @returns The characteristic ID (0-9), or -1 if not a valid PASCO UUID
 */
export function getCharacteristicIdFromUuid(uuid: string): number {
  const match = uuid.toLowerCase().match(PASCO_UUID.CHARACTERISTIC_ID_PATTERN);
  if (match?.[1]) {
    return parseInt(match[1], 10);
  }
  return -1;
}

/**
 * Check if a UUID is a PASCO BLE UUID
 *
 * @param uuid The UUID string to check
 * @returns true if the UUID matches the PASCO format
 */
export function isPascoUuid(uuid: string): boolean {
  const lower = uuid.toLowerCase();
  return lower.startsWith(PASCO_UUID.PREFIX) && lower.endsWith(PASCO_UUID.SUFFIX);
}
