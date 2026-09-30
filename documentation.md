# Technical Documentation

### A detailed description of how the PASCO BLE library works

> **Note:** This is an independent TypeScript implementation inspired by [PASCO Scientific's official Python library](https://github.com/PASCOscientific/pasco_python). The architecture and implementation details described here are specific to this TypeScript version.

## Contents

- [Architecture Overview](#architecture-overview)
- [Module Exports](#module-exports)
- [Browser Support](#browser-support)
- [BLE Communication](#ble-communication)
- [Device Initialization](#device-initialization)
- [Data Decoding Pipeline](#data-decoding-pipeline)
- [Platform Adapters](#platform-adapters)
- [Control Node Specifics](#control-node-specifics)

---

## Architecture Overview

The PASCO BLE library provides a TypeScript interface for communicating with PASCO wireless sensors over Bluetooth Low Energy (BLE). The library is designed to work in web browsers using the Web Bluetooth API.

### Library Layers

```
┌─────────────────────────────────────────────────────────────┐
│                      User Application                        │
├─────────────────────────────────────────────────────────────┤
│   PascoBot          CodeNodeDevice      ControlNodeDevice   │
│   (robotics)        (LED/sound)         (motors/servos)     │
├─────────────────────────────────────────────────────────────┤
│                      PASCOBLEDevice                          │
│           (connection & protocol management)                 │
├────────────────────────┬────────────────────────────────────┤
│    SensorManager       │      ProtocolHandler               │
│  (sensor operations)   │   (BLE communication)              │
├────────────────────────┼────────────────────────────────────┤
│  SensorInitializer     │  MeasurementDecoder                │
│  (sensor setup)        │  (data decoding)                   │
├────────────────────────┴────────────────────────────────────┤
│              BLE Adapter Abstraction Layer                   │
│         (BLEAdapterBase / BLEClientBase)                    │
├─────────────────────────────────────────────────────────────┤
│               WebBluetoothAdapter                            │
│            (Web Bluetooth API - Browser)                     │
└─────────────────────────────────────────────────────────────┘
```

### Module Structure

```
src/
├── index.ts                 # Public API exports (stable)
├── internal.ts              # Internal/advanced API exports
├── browser-support.ts       # Browser compatibility detection
├── errors.ts                # Custom error classes
├── units.ts                 # Unit conversion
├── code-node-device.ts      # Code.Node controls
├── control-node-device.ts   # Control.Node controls
├── pasco-bot.ts             # Robotics interface
├── character-library.ts     # LED matrix characters/icons
├── datasheets.ts            # Sensor definitions
├── device/
│   ├── pasco-ble-device.ts      # Base device class (connection/protocol)
│   ├── sensor-manager.ts        # Sensor state and operations
│   ├── sensor-state.ts          # Centralized sensor state container
│   ├── sensor-initializer.ts    # Sensor initialization from datasheets
│   ├── measurement-decoder.ts   # Data decoding pipeline
│   ├── protocol-handler.ts      # BLE communication protocol
│   ├── connection-state.ts      # Connection state machine
│   ├── device-options.ts        # Configuration options
│   └── index.ts                 # Device module exports
├── ble/
│   ├── ble-adapter.ts       # Abstract BLE interface
│   ├── web-bluetooth-adapter.ts  # Web Bluetooth implementation
│   └── index.ts             # BLE adapter factory
├── types/
│   ├── ble.ts               # BLE type definitions
│   ├── branded.ts           # Branded (nominal) types
│   ├── measurement.ts       # Measurement types
│   ├── device.ts            # Device/sensor types
│   └── index.ts             # Type exports
└── utils/
    ├── binary.ts            # Binary data utilities
    ├── math.ts              # Mathematical functions
    ├── equation-parser.ts   # Safe equation evaluation
    ├── event-emitter.ts     # Typed event emitter
    ├── retry.ts             # Retry and timeout utilities
    ├── validation.ts        # Parameter validation
    └── index.ts             # Utility exports
```

### Device Hierarchy

PASCO devices have three conceptual layers:

1. **Interface**: The physical device (e.g., Control Node, Temperature Sensor)
2. **Sensors**: Components within the device that provide data channels
3. **Measurements**: Individual data points from each sensor

**Example**: Wireless Weather Sensor
- Interface ID: 1036
- Sensors: WirelessWeatherSensor, WirelessGPSSensor, WirelessLightSensor, WirelessCompass
- Measurements: Temperature, RelativeHumidity, Latitude, UVIndex, WindDirection, etc.

---

## Module Exports

The library uses a tiered export structure to separate stable public APIs from internal utilities:

### Main API (`pasco-ble`)

The main entry point exports stable, user-facing APIs:

```typescript
import {
  // Device classes
  PASCOBLEDevice,
  CodeNodeDevice,
  ControlNodeDevice,
  PascoBot,

  // Browser support
  checkBrowserSupport,
  isWebBluetoothSupported,

  // Configuration
  DeviceOptions,
  DEFAULT_DEVICE_OPTIONS,

  // Error classes
  BLEConnectionError,
  DeviceNotConnected,
  MeasurementNotFound,
  // ... other errors

  // Unit conversions
  convertUnit,
  getDefaultUnit,

  // Event system
  TypedEventEmitter,

  // LED icons
  Icons,
  LEDIcons,
} from 'pasco-ble';
```

### Internal API (`pasco-ble/internal`)

Advanced utilities for extension developers. These APIs may change between minor versions:

```typescript
import {
  // BLE protocol internals
  BLEAdapterBase,
  BLEClientBase,
  ProtocolHandler,
  PROTOCOL,
  createPascoUuid,

  // Device internals
  ConnectionStateMachine,
  MeasurementDecoder,
  SensorInitializer,

  // Datasheet access
  SENSORS,
  WIRELESS_INTERFACES,
  getSensor,
  getInterface,

  // Binary utilities
  packInt16LE,
  unpackFloat32LE,
  twosComplement,
  binaryFraction,

  // Math utilities
  linearInterpolate,
  dewpoint,
  windchill,
  heatindex,

  // Retry utilities
  withRetry,
  delay,
} from 'pasco-ble/internal';
```

---

## Browser Support

### Runtime Detection

The library provides utilities to check browser compatibility before attempting BLE operations:

```typescript
import { checkBrowserSupport, isWebBluetoothSupported } from 'pasco-ble';

// Simple boolean check
if (!isWebBluetoothSupported()) {
  console.error('Web Bluetooth not available');
}

// Detailed check with diagnostic info
const support = checkBrowserSupport();
console.log(support);
// {
//   supported: false,
//   secureContext: true,
//   message: "Web Bluetooth API is not available. Firefox does not support Web Bluetooth...",
//   browser: "Firefox"
// }
```

### BrowserSupport Interface

```typescript
interface BrowserSupport {
  supported: boolean;      // Whether Web Bluetooth is available
  secureContext: boolean;  // Whether page is served over HTTPS
  message: string;         // Human-readable status message
  browser: string | undefined;  // Detected browser name
}
```

### Supported Browsers

| Browser | Minimum Version | Platforms |
|---------|-----------------|-----------|
| Chrome | 56+ | Windows, macOS, Linux, Android |
| Edge | 79+ | Windows, macOS |
| Opera | 43+ | Windows, macOS, Linux |

**Not Supported:** Firefox, Safari, Internet Explorer

---

## BLE Communication

### PASCO UUID Structure

PASCO devices use custom BLE UUIDs with this format:
```
4a5c000{serviceId}-000{charId}-0000-0000-5c1e741f1c00
```

- **Service ID (0-9)**: Identifies the sensor channel
  - Service 0: Main device commands
  - Services 1+: Individual sensor channels
- **Characteristic ID (2, 3, 5)**:
  - Char 2 (`SEND_CMD_CHAR_ID`): Send commands to device
  - Char 3 (`RECV_CMD_CHAR_ID`): Receive responses/notifications
  - Char 5 (`SEND_ACK_CHAR_ID`): Send acknowledgments

### Communication Flow

```
┌──────────┐                           ┌──────────────┐
│ Computer │                           │ PASCO Device │
└────┬─────┘                           └──────┬───────┘
     │                                        │
     │  1. Write command to Char 2            │
     │ ─────────────────────────────────────> │
     │                                        │
     │  2. Device sends notification on Char 3│
     │ <───────────────────────────────────── │
     │                                        │
     │  3. Send ACK on Char 5 (if needed)     │
     │ ─────────────────────────────────────> │
     │                                        │
```

### Command Protocol

**Request Format:**
```typescript
[COMMAND_ID, ...parameters]
```

**Response Format:**
```typescript
[0xC0, status, originalCommand, ...data]  // Generic response
[packetNum, ...data]                       // Measurement data (packetNum <= 0x1F)
```

### Key Commands

| Command | ID | Purpose |
|---------|-----|---------|
| `GCMD_READ_ONE_SAMPLE` | 0x05 | Read single measurement |
| `GCMD_CUSTOM_CMD` | 0x37 | Custom/device-specific command |
| `GCMD_XFER_BURST_RAM` | 0x0E | Burst RAM transfer |

### Synchronization with writeAwaitCallback

BLE communication is asynchronous. The `writeAwaitCallback()` method ensures proper synchronization:

```typescript
async writeAwaitCallback(serviceId: number, command: number[]): Promise<void> {
  // 1. Set up promise to wait for callback
  const callbackPromise = new Promise((resolve, reject) => {
    this._callbackResolve = resolve;
    this._callbackReject = reject;
  });

  // 2. Write command to device
  await this.write(serviceId, command);

  // 3. Wait for notification callback
  await callbackPromise;
}
```

When a notification arrives, `_notifyCallback()` resolves the promise, allowing execution to continue.

---

## Device Initialization

### Connection Sequence

```typescript
// 1. Create device and scan
const device = new PASCOBLEDevice();
const found = await device.scan();

// 2. Connect to device
await device.connect(found[0]);

// Internally:
// - Establish GATT connection
// - Discover services and characteristics
// - Start notifications on all channels
// - Parse device name to extract interface ID
// - Load interface definition from datasheets
// - Initialize sensors and measurements
```

### Device Name Parsing

PASCO device names follow this format:
```
{DeviceType} {SerialId}-{InterfaceId}
```

Example: `Temperature 055-808-1025`
- Device Type: Temperature
- Serial ID: 055-808
- Interface ID: 1025

### Datasheet Lookup

The `datasheets.ts` file contains definitions for all PASCO interfaces and sensors:

```typescript
interface ParsedInterface {
  ID: number;
  channels: InterfaceChannel[];
}

interface ParsedSensor {
  ID: number;
  Tag: string;
  measurements: Measurement[];
}
```

During initialization:
1. Look up interface by ID
2. For each channel, look up sensor definition
3. Build measurement lookup tables

---

## Data Decoding Pipeline

When sensor data is received, it goes through a multi-stage decoding process:

```
Raw BLE Bytes
      │
      ▼
┌─────────────────┐
│ Build byte value│  Little-endian assembly
│ from data stack │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Apply base type │  RawDigital, Direct, Constant
│ conversion      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Apply derived   │  LinearConv, FactoryCal, Derivative,
│ calculations    │  ThreeInputVector, RotaryPos, etc.
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Apply equation  │  table(), usound(), dewpoint(),
│ (if present)    │  windchill(), heatindex(), custom
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Apply precision │  Round to specified decimal places
│ and limits      │
└────────┬────────┘
         │
         ▼
   Final Value
```

### Measurement Types

| Type | Description |
|------|-------------|
| `RawDigital` | Raw sensor value, optionally two's complement |
| `Direct` | Direct conversion with binary fraction |
| `Constant` | Fixed predefined value |
| `LinearConv` | Linear transformation: `y = m*x + b` |
| `FactoryCal` | 4-parameter factory calibration |
| `UserCal` | 4-parameter user calibration |
| `ThreeInputVector` | Vector magnitude: `√(x² + y² + z²)` |
| `Derivative` | Rate of change from previous value |
| `RotaryPos` | Accumulated rotary position |
| `Select` | Pass-through from input measurement |

### Equation Evaluation

The library uses the `mathjs` library for safe equation evaluation (avoiding `eval()`):

```typescript
// Example equation from datasheet
"table((880*[1])+336.9,7122,45,14100,20,17245,15,51725,0)"

// Parsed and evaluated:
// 1. Replace [1] with measurement ID 1's value
// 2. Evaluate inner expression
// 3. Look up result in interpolation table
```

Supported functions: `sqrt`, `log`, `sin`, `cos`, `tan`, `abs`, `pow`, `exp`, `floor`, `ceil`, `round`, plus custom functions like `dewpoint()`, `windchill()`, `heatindex()`, `usound()`.

---

## Web Bluetooth Adapter

### BLE Adapter Interface

```typescript
abstract class BLEAdapterBase {
  abstract scan(nameFilters?: string[], timeout?: number): Promise<BLEDevice[]>;
  abstract stopScan(): Promise<void>;
  abstract createClient(device: BLEDevice): BLEClientBase;
  abstract isAvailable(): boolean;
}

abstract class BLEClientBase {
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract writeGattChar(uuid: string, data: Uint8Array): Promise<void>;
  abstract readGattChar(uuid: string): Promise<Uint8Array>;
  abstract startNotify(uuid: string, callback: NotifyCallback): Promise<void>;
  abstract stopNotify(uuid: string): Promise<void>;
  abstract discoverServicesAndCharacteristics(): Promise<void>;
}
```

### Web Bluetooth Implementation

The library uses the **Web Bluetooth API** available in modern browsers:

**Features:**
- Uses `navigator.bluetooth.requestDevice()` for device selection
- Shows native browser device picker dialog
- Requires HTTPS context (or localhost for development)
- Requires user gesture to initiate scan/connect operations
- Zero native dependencies - pure JavaScript/TypeScript

**Browser Support:**
- ✅ Chrome 56+ (Windows, macOS, Linux, Android)
- ✅ Edge 79+ (Windows, macOS)
- ✅ Opera 43+
- ❌ Firefox (Web Bluetooth not supported)
- ❌ Safari (Web Bluetooth not supported)

**Adapter Factory:**

```typescript
function createBLEAdapter(): BLEAdapterBase {
  if (typeof navigator !== 'undefined' && navigator.bluetooth !== undefined) {
    return new WebBluetoothAdapter();
  }
  throw new Error('Web Bluetooth API is not available in this environment');
}
```

### Security Requirements

Web Bluetooth has strict security requirements:

1. **HTTPS Only**: Must be served over HTTPS (localhost exempted)
2. **User Gesture**: Bluetooth operations must be initiated by user action
3. **Permission Prompt**: Browser shows permission dialog before accessing Bluetooth
4. **Secure Context**: Page must be in a secure context (not in iframe without proper permissions)

---

## Control Node Specifics

### Port-Based Measurement Reading

The Control Node supports multiple sensors on different ports (A, B, Sensor). The `readData()` method is overridden to handle port-specific readings:

```typescript
// Read angle from stepper on port A
const angleA = await controlNode.readData('Angle', 'A');

// Read angle from stepper on port B
const angleB = await controlNode.readData('Angle', 'B');
```

### Plugin Sensor Detection

When sensors are plugged into the Control Node, it sends a callback with updated sensor information:

```typescript
// Callback format: [0x82, sensorIdA_lo, sensorIdA_hi, sensorIdB_lo, sensorIdB_hi, ...]
```

The `update_controlnode_plugin_sensor()` method processes this and reinitializes the sensor list.

### Stepper Motor Commands

Stepper commands use this format:
```typescript
[0x37, 0x04, channel,
 speedA_lo, speedA_hi, accelA_lo, accelA_hi, distA_0, distA_1, distA_2, distA_3,
 speedB_lo, speedB_hi, accelB_lo, accelB_hi, distB_0, distB_1, distB_2, distB_3]
```

- Speed: deci-steps per second (960 steps = 360 degrees)
- Acceleration: deci-steps per second squared
- Distance: deci-steps (0 = continuous rotation)

### Servo PWM Calculation

```typescript
// Standard servo: angle (-90 to 90) → PWM on-time
onTime = angle + 150;  // microseconds

// Continuous servo: speed (-100 to 100) → PWM on-time
onTime = 0.2 * speed + 150;  // microseconds
```

For utilities and error classes, see `src/utils/`, `src/errors.ts` and the README.
