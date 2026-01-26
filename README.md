[![TypeScript](https://img.shields.io/badge/typescript-5.9+-blue)](https://www.npmjs.com/package/pasco-ble)
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
- [//code.Node](#codenode)
- [//control.Node](#controlnode)
- [PascoBot](#pascobot)
- [Troubleshooting](#troubleshooting)
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

No additional setup or native dependencies required!

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
    import { PASCOBLEDevice } from 'https://unpkg.com/pasco-ble/dist/index.js';

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
    import { PASCOBLEDevice } from 'https://unpkg.com/pasco-ble/dist/index.js';

    let reading = false;
    const sensor = new PASCOBLEDevice();

    document.getElementById('connect').onclick = async () => {
      const devices = await sensor.scan();

      if (devices.length > 0) {
        await sensor.connect(devices[0]);

        // Get available measurements
        const measurements = sensor.getMeasurementList();
        console.log('Available:', measurements);

        // Read continuously
        reading = true;
        while (reading) {
          const temp = await sensor.readData('Temperature');
          document.getElementById('output').textContent =
            `Temperature: ${temp} ${sensor.getMeasurementUnit('Temperature')}`;
          await new Promise(r => setTimeout(r, 100));
        }
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

const device = new PASCOBLEDevice();

// Scanning & Connection
await device.scan(filter?: string);           // Scan for devices (optional name filter)
await device.connect(bleDevice);              // Connect to a scanned device
await device.connectById('123-456');          // Connect by 6-digit device ID
await device.disconnect();                    // Disconnect from device
device.isConnected();                         // Check connection status

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
await device.readData(measurement);           // Read single measurement
await device.readDataList(measurements);      // Read multiple measurements
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
await codeNode.connectById('481-782');

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

```typescript
import { Icons } from 'pasco-ble';

Icons.heart      Icons.heartSmall   Icons.smile
Icons.sad        Icons.surprise     Icons.star
Icons.arrowTop   Icons.arrowLeft    Icons.arrowBottom
Icons.arrowRight Icons.alien
```

## //control.Node

The //control.Node can control stepper motors, servos, and power outputs, plus connect to plugin sensors.

```typescript
import { ControlNodeDevice } from 'pasco-ble';

const controlNode = new ControlNodeDevice();
await controlNode.connectById('664-591');
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

const bot = new PascoBot();
await bot.connectById('664-591');

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
