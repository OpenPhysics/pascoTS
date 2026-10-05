/**
 * PASCO BLE Library - Internal/Advanced Exports
 *
 * This module exports internal utilities and low-level functions.
 * These are intended for advanced users building extensions or custom implementations.
 *
 * WARNING: These APIs are considered internal and may change between minor versions.
 * For stable APIs, use the main 'pasco-ble' import instead.
 *
 * @module pasco-ble/internal
 */

// ============================================================================
// BLE Adapter Internals
// ============================================================================

export {
  BLEAdapterBase,
  BLEClientBase,
  createPascoUuid,
  getCharacteristicIdFromUuid,
  getServiceIdFromUuid,
  isPascoUuid,
} from './ble/ble-adapter.js';
export { createBLEAdapter, Platform } from './ble/index.js';
export {
  WebBluetoothAdapter,
  WebBluetoothClient,
} from './ble/web-bluetooth-adapter.js';

// ============================================================================
// Device Internals
// ============================================================================

export {
  type ConnectionState,
  ConnectionStateMachine,
  createLogger,
  DEFAULT_DEVICE_OPTIONS,
  type DeviceLogger,
  type DeviceOptions,
  type LogLevel,
  MeasurementDecoder,
  type NotificationHandler,
  PROTOCOL,
  ProtocolHandler,
  SensorInitializer,
  SensorState,
  type SensorStateAccess,
  type SensorStateReader,
  type SensorStateWriter,
  type StateChangeCallback,
  type StateTransition,
} from './device/index.js';

// ============================================================================
// Datasheet Internals
// ============================================================================

export {
  createDatasheets,
  getInterface,
  getSensor,
  hasInterface,
  hasSensor,
  type ParsedInterface,
  type ParsedSensor,
  SENSORS,
  WIRELESS_INTERFACES,
} from './datasheets.js';

// ============================================================================
// Binary Utilities
// ============================================================================

export {
  binaryFloat,
  binaryFraction,
  buildByteValue,
  bytesToHex,
  copyDataView,
  decode64,
  packInt16LE,
  packInt32LE,
  twosComplement,
  unpackFloat32LE,
  unpackInt16LE,
  unpackInt32LE,
} from './utils/binary.js';

// ============================================================================
// Equation Parser
// ============================================================================

export {
  evaluateEquation,
  evaluateTableEquation,
  parentheticContents,
} from './utils/equation-parser.js';

// ============================================================================
// Math Utilities
// ============================================================================

export {
  calc4Params,
  calcLinearParams,
  calcRotaryPos,
  dewpoint,
  heatindex,
  limit,
  linearInterpolate,
  threeInputVector,
  usound,
  windchill,
} from './utils/math.js';

// ============================================================================
// Event Emitter
// ============================================================================

export {
  type DeviceEventName,
  type DeviceEvents,
  type EventListener,
  EventTimeoutError,
  TypedEventEmitter,
} from './utils/event-emitter.js';

// ============================================================================
// Error Utilities
// ============================================================================

export {
  ErrorCode,
  isPASCOError,
  isRetryableError,
  PASCOError,
  type PASCOErrorOptions,
} from './errors.js';

// ============================================================================
// Branded Types
// ============================================================================

export {
  asChannelId,
  asInterfaceId,
  asMeasurementId,
  asSensorId,
  type ChannelId,
  type InterfaceId,
  isValidId,
  type MeasurementId,
  type SensorId,
  toNumber,
} from './types/branded.js';

// ============================================================================
// Retry Utilities
// ============================================================================

export {
  calculateBackoffDelay,
  delay,
  type RetryOptions,
  retryable,
  withRetry,
} from './utils/retry.js';

// ============================================================================
// Character Library (for LED matrix extensions)
// ============================================================================

export {
  alphabet,
  type CharacterMatrix,
  getIcon,
  getWord,
  Icons as LEDIcons,
  type LEDCoordinate,
} from './character-library.js';

// ============================================================================
// Unit System Internals
// ============================================================================

export {
  convertUnit,
  getDefaultUnit,
  getUnitGroup,
  getUnitsInGroup,
  UNIT_GROUPS,
  UNIT_TAG_TO_GROUP,
  type UnitDefinition,
  type UnitGroup,
} from './units.js';
