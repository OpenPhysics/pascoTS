[![npm](https://img.shields.io/npm/v/pasco-ble)](https://www.npmjs.com/package/pasco-ble)
[![TypeScript](https://img.shields.io/badge/types-included-blue)](https://www.npmjs.com/package/pasco-ble)
[![Web Bluetooth](https://img.shields.io/badge/Web%20Bluetooth-required-blue)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)

# PASCO BLE Library

A TypeScript/JavaScript library for connecting to PASCO Wireless sensors **in web browsers** using Web Bluetooth. Create your own data collection applications, build interactive science experiments, or integrate sensors with web-based educational tools!

> **Platform:** This library uses the **Web Bluetooth API** and works in Chrome, Edge, and other Chromium-based browsers. HTTPS is required.

> **Note:** This is an independent TypeScript implementation inspired by [PASCO Scientific's official Python library](https://github.com/PASCOscientific/pasco_python). While functionally equivalent, this library is not officially endorsed or maintained by PASCO Scientific.

## Contents

- [Getting Started](#getting-started)
- [Browser Compatibility](#browser-compatibility)
- [Compatible Sensors](#compatible-sensors)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Events](#events)
- [Streaming Data](#streaming-data)
- [Device Options](#device-options)
- [Error Handling](#error-handling)
- [Unit Conversion](#unit-conversion)
- [//code.Node](#codenode)
- [//control.Node](#controlnode)
- [PascoBot](#pascobot)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Getting Started

### Installation

```bash
npm install pasco-ble
```

**Requirements:**
- Web browser with Web Bluetooth support (Chrome, Edge, Opera)
- HTTPS connection (or localhost for development)
- User gesture to initiate Bluetooth operations

No native dependencies required.

### Using a CDN (no build step)

The package is published as ES modules and depends on `mathjs`, so load it from an ESM-aware CDN that rewrites bare imports, such as [esm.sh](https://esm.sh) or [jsDelivr](https://www.jsdelivr.com). Pin the version so a new release can't change your page unexpectedly:

```html
<script type="importmap">
{
  "imports": {
    "pasco-ble": "https://esm.sh/pasco-ble@0.3.70"
  }
}
</script>
<script type="module">
  import { PASCOBLEDevice } from 'pasco-ble';
</script>
```

Alternatively: `https://cdn.jsdelivr.net/npm/pasco-ble@0.3.70/+esm`. Importing `dist/index.js` directly from unpkg will **not** work, because the browser cannot resolve the `mathjs` import.

## Browser Compatibility

This library uses the **Web Bluetooth API**, which has limited browser support:

| Browser | Support | Minimum Version | Platforms |
|---------|---------|-----------------|-----------|
| Chrome | ✅ Supported | 56+ | Windows, macOS, Linux, Android |
| Edge | ✅ Supported | 79+ | Windows, macOS |
| Opera | ✅ Supported | 43+ | Windows, macOS, Linux |
| Firefox | ❌ Not supported | - | - |
| Safari | ❌ Not supported | - | - |

**Additional Requirements:**
- HTTPS connection required (localhost works for development)
- User gesture required to initiate Bluetooth operations (e.g., button click)

### Check Browser Support Programmatically

```typescript
import { isWebBluetoothSupported } from 'pasco-ble';

if (!isWebBluetoothSupported()) {
  alert('Please use Chrome, Edge, or Opera to connect to sensors.');
}
```

For more detail (browser name, support level, and a user-facing message), use `checkBrowserSupport()`. `checkBluetoothAvailability()` additionally checks whether a Bluetooth adapter is available.

## Compatible Sensors

- //control.Node
- //code.Node
- Smart Cart
- Wireless Acceleration Altimeter
- Wireless CO2
- Wireless Conductivity
- Wireless Current
- Wireless Diffraction
- Wireless Drop Counter
- Wireless Force Acceleration
- Wireless Light
- Wireless Load Cell
- Wireless Magnetic Field
- Wireless Motion
- Wireless O2
- Wireless Optical DO
- Wireless pH
- Wireless Pressure
- Wireless Rotary Motion
- Wireless Temperature
- Wireless Voltage
- Wireless Weather

## Quick Start

### Basic Sensor Reading

```html
<!DOCTYPE html>
<html>
<body>
  <button id="connect">Connect to Sensor</button>
  <div id="output"></div>

  <script type="module">
    import { PASCOBLEDevice } from 'https://esm.sh/pasco-ble@0.3.70';

    document.getElementById('connect').onclick = async () => {
      const sensor = new PASCOBLEDevice();

      // Scan opens browser's device picker
      const devices = await sensor.scan();

      if (devices.length > 0) {
        await sensor.connect(devices[0]);

        // Read temperature
        const temp = await sensor.readData('Temperature');
        const units = sensor.getMeasurementUnit('Temperature');

        document.getElementById('output').textContent = `${temp} ${units}`;

        await sensor.disconnect();
      }
    };
  </script>
</body>
</html>
```

### Continuous Data Reading

```html
<!DOCTYPE html>
<html>
<body>
  <button id="connect">Connect and Start Reading</button>
  <button id="stop">Stop</button>
  <div id="output"></div>

  <script type="module">
    import { PASCOBLEDevice } from 'https://esm.sh/pasco-ble@0.3.70';

    const sensor = new PASCOBLEDevice();
    let reading = false;

    document.getElementById('connect').onclick = async () => {
      const [device] = await sensor.scan();
      if (!device) return;  // User cancelled the picker

      await sensor.connect(device);
      console.log('Available:', sensor.getMeasurementList());

      const unit = sensor.getMeasurementUnit('Temperature');
      reading = true;
      for await (const temp of sensor.streamData('Temperature', 100)) {
        if (!reading) break;
        document.getElementById('output').textContent = `Temperature: ${temp} ${unit}`;
      }
    };

    document.getElementById('stop').onclick = async () => {
      reading = false;
      await sensor.disconnect();
    };
  </script>
</body>
</html>
```

## API Reference

### PASCOBLEDevice

```typescript
import { PASCOBLEDevice } from 'pasco-ble';

const device = new PASCOBLEDevice(options?);  // See Device Options

// Scanning & Connection
await device.scan(filter?: string);           // Open the browser's device picker (optional name-prefix filter)
await device.connect(bleDevice);              // Connect to a device returned by scan()
await device.connectById('123-456');          // Scan + connect by 6-digit device ID
await device.disconnect();                    // Disconnect from device
await device.reconnect();                     // Reconnect to the last device; resolves true on success
device.isConnected();                         // Check connection status
device.connectionState;                       // 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'reconnecting'

// Device Information
device.name;                                  // Device name
device.serialId;                              // Device serial ID
device.address;                               // BLE address

// Sensors & Measurements
device.getSensorList();                       // Get list of sensors
device.getMeasurementList(sensorName?);       // Get available measurements
device.getMeasurementUnit(measurement);       // Get unit for a measurement
device.getMeasurementUnitList(measurements);  // Get units for multiple measurements

// Reading Data
await device.readData(measurement);           // Read single measurement (number | null)
await device.readDataList(measurements);      // Read multiple measurements (Record<string, number | null>)
device.streamData(measurement, intervalMs?);  // Async iterator of readings (default 100 ms)
device.streamDataList(measurements, intervalMs?);
```

> **Web Bluetooth note:** browsers do not allow silent scanning. `scan()` opens the browser's device picker and resolves with the single device the user selects (or an empty array if they cancel). It must be called from a user gesture such as a button click.

## Events

`PASCOBLEDevice` (and every device class built on it) is a typed event emitter:

```typescript
device.on('connected', ({ name, address }) => console.log(`Connected to ${name}`));
device.on('disconnected', ({ reason }) => console.log('Disconnected', reason));
device.on('stateChange', ({ previousState, newState }) => console.log(previousState, '→', newState));
device.on('sensorsReady', ({ sensors }) => console.log('Sensors:', sensors));
device.on('data', ({ measurement, value, unit }) => console.log(measurement, value, unit));
device.on('error', ({ error, context }) => console.error(context, error));

device.once('connected', handler);   // Fire once
device.off('data', handler);         // Remove a listener
```

`data` events are emitted for every read (disable with `emitDataEvents: false`). Raw BLE `notification` events are off by default (`emitNotificationEvents: true` to enable).

## Streaming Data

```typescript
// One measurement
for await (const force of device.streamData('Force', 50)) {
  console.log(force);
  if (force !== null && force > 20) break;   // Breaking stops the stream
}

// Several measurements at once
for await (const data of device.streamDataList(['Position', 'Velocity'], 100)) {
  console.log(data.Position, data.Velocity);
}
```

Streams end automatically when the device disconnects.

## Device Options

```typescript
import { PASCOBLEDevice } from 'pasco-ble';

const device = new PASCOBLEDevice({
  connectionTimeout: 10000,     // ms to wait for connection (default 10000)
  commandTimeout: 5000,         // ms to wait for command responses (default 5000)
  retry: { maxRetries: 3 },     // Retry BLE operations with exponential backoff (0 disables)
  autoReconnect: true,          // Reconnect after an unexpected disconnect (default false)
  maxReconnectAttempts: 3,      // default 3
  reconnectDelay: 2000,         // ms between attempts (default 2000)
  logLevel: 'warn',             // 'none' | 'error' | 'warn' | 'info' | 'debug' (default 'error')
});
```

The defaults are exported as `DEFAULT_DEVICE_OPTIONS`.

## Error Handling

All library errors extend `PASCOError` and carry an `ErrorCode`:

```typescript
import { isPASCOError, isRetryableError, MeasurementNotFound } from 'pasco-ble';

try {
  await device.readData('Temprature');
} catch (error) {
  if (error instanceof MeasurementNotFound) {
    console.log('Try one of:', device.getMeasurementList());
  } else if (isPASCOError(error)) {
    console.error(error.code, error.message, isRetryableError(error));
  }
}
```

| Error | When |
|-------|------|
| `BLEScanFailed` | Scanning failed |
| `BLEConnectionError` | Connection failed or device not found |
| `BLEAlreadyConnectedError` | `connect()` called while connected |
| `DeviceNotConnected` | Operation requires a connection |
| `CommunicationError` | BLE command failed or timed out |
| `MeasurementNotFound` / `SensorNotFound` | Unknown measurement or sensor name |
| `CouldNotDecodeData` | Sensor data could not be decoded |
| `SensorSetupError` | Sensor initialization failed |
| `InvalidParameter` / `InvalidEquation` | Bad argument or datasheet equation |

## Unit Conversion

```typescript
import { convertUnit, getUnitGroup, getUnitsInGroup, getDefaultUnit } from 'pasco-ble';

convertUnit(25, 'DegC', 'DegF');          // 77
getUnitGroup('DegC');                     // 'Temperature'
getUnitsInGroup('Temperature');           // ['DegC', 'DegF', 'K']
getDefaultUnit('Temperature', true);      // 'DegF' (US default)
```

## Python to TypeScript

This library provides a functionally equivalent API to [PASCO's official Python library](https://github.com/PASCOscientific/pasco_python), using TypeScript conventions:

| Python | TypeScript |
|--------|------------|
| `PASCOBLEDevice()` | `new PASCOBLEDevice()` |
| `device.scan()` | `await device.scan()` |
| `device.connect(ble_device)` | `await device.connect(bleDevice)` |
| `device.connect_by_id(id)` | `await device.connectById(id)` |
| `device.disconnect()` | `await device.disconnect()` |
| `device.is_connected()` | `device.isConnected()` |
| `device.get_sensor_list()` | `device.getSensorList()` |
| `device.get_measurement_list()` | `device.getMeasurementList()` |
| `device.read_data(measurement)` | `await device.readData(measurement)` |
| `device.get_measurement_unit(m)` | `device.getMeasurementUnit(m)` |

**Key Differences:**
- Python uses `snake_case`, TypeScript uses `camelCase`
- All I/O operations return Promises in TypeScript
- Full TypeScript type definitions for IDE support

## //code.Node

The //code.Node features a 5x5 LED matrix, RGB LED, speaker, and various sensors.

```typescript
import { CodeNodeDevice, Icons } from 'pasco-ble';

const codeNode = new CodeNodeDevice();
const [node] = await codeNode.scan('//code.Node');   // Picker shows only //code.Nodes
await codeNode.connect(node);

// 5x5 LED Matrix
await codeNode.setLedInArray(2, 2, 255);              // Set single LED (x, y, intensity)
await codeNode.setLedsInArray([[0,0], [1,1]], 128);   // Set multiple LEDs
await codeNode.scrollTextInArray('HELLO');            // Scroll text
await codeNode.showImageInArray(Icons.smile);         // Display icon

// RGB LED
await codeNode.setRgbLed(255, 0, 0);                  // Red

// Speaker
await codeNode.setSoundFrequency(440);                // 440 Hz tone
await codeNode.setSoundFrequency(0);                  // Turn off

// Reset all outputs
await codeNode.reset();

// Read sensors
const brightness = await codeNode.readData('Brightness');
const button = await codeNode.readData('Button1');
```

### LED Matrix Coordinates

```
| 0,0  1,0  2,0  3,0  4,0 |
| 0,1  1,1  2,1  3,1  4,1 |
| 0,2  1,2  2,2  3,2  4,2 |
| 0,3  1,3  2,3  3,3  4,3 |
| 0,4  1,4  2,4  3,4  4,4 |
```

### Available Icons

`Icons` is also exported as `LEDIcons`. `getIcon()` and `getWord()` convert icons and text into LED coordinate lists.

```typescript
import { Icons } from 'pasco-ble';

Icons.heart      Icons.heartSmall   Icons.smile
Icons.sad        Icons.surprise     Icons.star
Icons.arrowTop   Icons.arrowLeft    Icons.arrowBottom
Icons.arrowRight Icons.arrowTopLeft Icons.arrowTopRight
Icons.arrowBottomLeft Icons.arrowBottomRight Icons.alien
```

## //control.Node

The //control.Node can control stepper motors, servos, and power outputs, plus connect to plugin sensors.

```typescript
import { ControlNodeDevice } from 'pasco-ble';

const controlNode = new ControlNodeDevice();
const [node] = await controlNode.scan('//control.Node');
await controlNode.connect(node);
```

### Stepper Motors

```typescript
// Rotate both steppers continuously (speed in deg/s, acceleration in deg/s²)
await controlNode.rotateSteppersContinuously(360, 360, 360, 360);

// Rotate single stepper continuously
await controlNode.rotateStepperContinuously('A', 360, 360);

// Rotate through a specific angle
await controlNode.rotateSteppersThrough(
  360, 360, 180,  // Speed A, Accel A, Distance A (degrees)
  360, 360, 180,  // Speed B, Accel B, Distance B (degrees)
  true            // Wait for completion
);

// Stop steppers
await controlNode.stopSteppers(360, 360);  // With deceleration

// Read stepper position
const angleA = await controlNode.readData('Angle', 'A');
const angleB = await controlNode.readData('Angle', 'B');
```

### Servos

```typescript
// Standard servo (angle: -90 to 90 degrees)
await controlNode.setServo(1, 'standard', 45);

// Continuous servo (speed: -100 to 100 percent)
await controlNode.setServo(2, 'continuous', 50);

// Control both servos
await controlNode.setServos('standard', 45, 'continuous', -50);

// Read servo current (for detecting resistance)
const current = await controlNode.readData('ServoCurrentOrd', 1);
```

### Power Output Board

```typescript
// USB output (on/off: 0 or 1)
await controlNode.setPowerOut('A', 1, 'USB', 1);

// Terminal output (PWM duty cycle: 0-100%)
await controlNode.setPowerOut('B', 2, 'terminal', 75);
```

### Greenhouse Light

```typescript
// Control red and blue LEDs (0-100%)
await controlNode.setGreenhouseLight('A', 50, 75);
```

### Speaker

```typescript
await controlNode.setSoundFrequency(440);  // 440 Hz
```

## PascoBot

High-level robotics interface for wheeled robots.

```typescript
import { PascoBot } from 'pasco-ble';

const bot = new PascoBot();                  // A //control.Node-based robot
const [node] = await bot.scan('//control.Node');
await bot.connect(node);

// Drive forward (speed in cm/s, acceleration in cm/s²)
await bot.drive(10, 5);

// Turn (angle in degrees, velocity in deg/s)
await bot.turn(90, 180);

// Turn continuously (angular velocity in deg/s)
await bot.turnContinuous(45);

// Stop
await bot.stop();

await bot.disconnect();
```

## Examples

Live browser demos (force, motion, Smart Cart 3D, //code.Node, //control.Node, X-Y and multi-sensor graphing) are in the [pasco-BLE-examples](https://github.com/OpenPhysics/pasco-BLE-examples) repository.

## Troubleshooting

### 1. Web Bluetooth not working

- **Browser Support**: Use Chrome, Edge, or Opera (Web Bluetooth required)
- **HTTPS Required**: Page must be served over HTTPS (localhost works for development)
- **Bluetooth Enabled**: Check that Bluetooth is enabled on your computer
- **User Gesture**: Scan must be initiated by a user action (button click, not on page load)
- **Permissions**: Browser may prompt for Bluetooth permissions

### 2. Device not found during scan

- **Red Light Blinking**: Device should have a red blinking light (ready to connect)
- **Green Light**: If solid green, device is already connected to another application
- **Reset Device**: Hold power button to turn off, then press to turn on again
- **Range**: Ensure you're within Bluetooth range (typically 10-30 feet)

### 3. Connection drops or times out

- **Distance**: Move closer to the device
- **Other Connections**: Ensure no other application is connected to the device
- **Reset**: Try resetting the device (power off/on)
- **Browser Tab**: Keep the browser tab active (some browsers throttle background tabs)

### 4. Cannot read measurement

- Use `getMeasurementList()` to see available measurements
- Measurement names are case-sensitive
- Some measurements require specific sensors to be connected

### 5. `Failed to resolve module specifier "mathjs"` or 400 errors from the CDN

- Load the library from an ESM CDN (esm.sh or jsDelivr `+esm`), not raw `dist/index.js` (see [Using a CDN](#using-a-cdn-no-build-step))
- Pin a version (`pasco-ble@0.3.70`) rather than relying on the latest

## Development

```bash
npm install
npm run build      # tsc + tsc-alias → dist/
npm test           # Vitest unit tests
npm run lint       # Biome
npm run check      # Type-check only (tsc --noEmit)
```

Requires Node.js 24+. Architecture and protocol details are in [documentation.md](documentation.md).

## License

This TypeScript library is licensed for personal, non-commercial, and educational use only.

**Copyright (c) 2024 Martin Veillette**

This is an independent TypeScript implementation inspired by PASCO Scientific's original Python library. While this implementation references PASCO's protocol specifications and sensor datasheets, it is a separate codebase with its own architecture.

### Key License Points

- ✅ **Permitted**: Personal projects, educational use, research, open-source contributions
- ❌ **Not Permitted**: Commercial use without written permission
- 🏷️ **Trademarks**: PASCO® is a registered trademark of PASCO Scientific

### Acknowledgments

- Original protocol and specifications: [PASCO Scientific](https://www.pasco.com)
- Python implementation reference: [pasco_python](https://github.com/PASCOscientific/pasco_python)
- This project is not officially endorsed by PASCO Scientific

See the [LICENSE](LICENSE) file for complete terms and conditions.
