# AGENTS.md

This file provides guidance for AI assistants working on the pasco-ble codebase.

## Quick Reference

```bash
npm run build      # TypeScript compilation to dist/
npm run lint       # Biome linter check
npm run lint:fix   # Biome linter with auto-fix
npm run format     # Biome formatter
npm run check      # Type-check only (tsc --noEmit)
npm run test       # Vitest unit tests
npm run clean      # Remove dist/ directory
```

## Project Overview

TypeScript library for PASCO wireless BLE sensors using Web Bluetooth API. See `documentation.md` for architecture details and `README.md` for API reference.

## Code Conventions

### TypeScript Strict Mode

The project uses strict TypeScript configuration with all strict checks enabled. Key settings:
- `noUncheckedIndexedAccess`: Array/object index access returns `T | undefined`
- `exactOptionalPropertyTypes`: Optional properties must be explicit
- `noImplicitOverride`: Override keyword required for inherited methods

### Path Aliases

Use path aliases for internal imports:
```typescript
import { BLEDevice } from '@/types/ble';
import { withRetry } from '@/utils/retry';
import { PASCOBLEDevice } from '@/device/pasco-ble-device';
import { BLEAdapterBase } from '@/ble/ble-adapter';
```

Aliases are configured in `tsconfig.json`:
- `@/types/*` → `src/types/*`
- `@/utils/*` → `src/utils/*`
- `@/device/*` → `src/device/*`
- `@/ble/*` → `src/ble/*`

### Export Structure

- `src/index.ts`: Public API (stable, user-facing)
- `src/internal.ts`: Internal API (for extension developers, may change)

New utilities go in `internal.ts` unless specifically intended for end users.

## Utility Functions

### Parameter Validation (`src/utils/validation.ts`)

Use validation utilities for consistent error messages:
```typescript
import { validateNumber, validateRange, validateNonEmptyString } from '@/utils/validation';

function setSpeed(speed: number): void {
  validateNumber(speed, 'speed');
  validateRange(speed, -100, 100, 'speed');
}
```

### Binary Operations (`src/utils/binary.ts`)

For building command byte arrays:
```typescript
import { splitInt16LE, int32ToBytes } from '@/utils/binary';

const [low, high] = splitInt16LE(0x1234);  // [0x34, 0x12]
const bytes = int32ToBytes(value);          // Spreadable array
```

### Timeout and Retry (`src/utils/retry.ts`)

```typescript
import { withRetry, withTimeout, TimeoutError } from '@/utils/retry';

// Retry with exponential backoff
const result = await withRetry(() => device.connect(), { maxRetries: 3 });

// Timeout wrapper (throws TimeoutError if operation takes too long)
const data = await withTimeout(device.readData('Temperature'), 5000);

// Handle timeout errors
try {
  await withTimeout(longOperation(), 1000);
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log('Operation timed out');
  }
}
```

### Math Operations (`src/utils/math.ts`)

```typescript
import { roundToPrecision, limit } from '@/utils/math';

const rounded = roundToPrecision(3.14159, 2);  // 3.14
const clamped = limit(value, 0, 100);
```

## Device Class Patterns

### Base Class Helpers

`PASCOBLEDevice` provides protected helpers for subclasses:

```typescript
class MyDevice extends PASCOBLEDevice {
  async doSomething(): Promise<void> {
    this.ensureConnected();  // Throws DeviceNotConnected if disconnected
    await this._delay(100);  // Promise-based delay
  }
}
```

### Event Emitter Debug Mode

```typescript
this._emitter.setDebugMode(true);  // Logs errors in event handlers
```

## Error Handling

Custom errors are defined in `src/errors.ts`. Use specific error types:
```typescript
import { InvalidParameter, DeviceNotConnected, MeasurementNotFound } from './errors';

throw new InvalidParameter('x must be in range [0-4]');
throw new DeviceNotConnected();
throw new MeasurementNotFound('Temperature');
```

## Common Pitfalls

1. **Array Index Access**: Always handle `undefined` due to `noUncheckedIndexedAccess`
   ```typescript
   const item = array[0];
   if (item) { /* use item */ }
   ```

2. **Override Modifier**: Add `override` when extending base class methods
   ```typescript
   override async disconnect(): Promise<void> { ... }
   ```

3. **Biome Pre-commit Hook**: Staged files are checked before commit. Run `npm run lint:fix` to fix lint and format issues.

## File Organization

Key files to understand:
- `src/device/pasco-ble-device.ts`: Base device class (connection, protocol)
- `src/device/sensor-manager.ts`: Sensor state and operations
- `src/device/measurement-decoder.ts`: Data decoding pipeline
- `src/datasheets.ts`: Sensor definitions (auto-generated, do not edit)
- `src/code-node-device.ts`: Code.Node LED/sound controls
- `src/control-node-device.ts`: Control.Node motor/servo controls
