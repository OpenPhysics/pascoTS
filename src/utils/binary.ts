/**
 * Binary data utilities - replacements for Python's struct module
 */

/**
 * Decode Base-64 character to corresponding integer (PASCO encoding)
 * 0-9   -> '0' - '9'
 * 10-25 -> 'K' - 'Z'
 * 26-35 -> 'A' - 'J'
 * 36-61 -> 'a' - 'z'
 * 62    -> '#'
 * 63    -> '*'
 */
export function decode64(charVal: string): number {
  if (charVal >= '0' && charVal <= '9') {
    return charVal.charCodeAt(0) - '0'.charCodeAt(0);
  } else if (charVal >= 'K' && charVal <= 'Z') {
    return charVal.charCodeAt(0) - 'A'.charCodeAt(0);
  } else if (charVal >= 'A' && charVal <= 'J') {
    return charVal.charCodeAt(0) - 'A'.charCodeAt(0) + 26;
  } else if (charVal >= 'a' && charVal <= 'z') {
    return charVal.charCodeAt(0) - 'a'.charCodeAt(0) + 36;
  } else if (charVal === '*') {
    return 62;
  } else if (charVal === '#') {
    return 63;
  } else {
    return -1;
  }
}

/**
 * Get two's complement of an integer value
 * @param value Integer value to convert
 * @param byteLen Number of bytes the integer is supposed to be
 */
export function twosComplement(value: number, byteLen: number): number {
  const bitLen = byteLen * 8;
  // Use 2 ** n instead of bitwise shifts: JavaScript's `<<` operates on
  // signed 32-bit integers with a mod-32 shift count, so `1 << 32` wraps to 1
  // and `1 << 31` is negative. That breaks 4-byte (32-bit) values entirely.
  const signBit = 2 ** (bitLen - 1);
  if (value >= signBit) {
    return value - 2 ** bitLen;
  }
  return value;
}

/**
 * Convert a 32-bit value to a fixed-point fraction
 */
export function binaryFraction(value: number): number {
  return (value >> 16) + (value & 0xffff) / 2 ** 16;
}

/**
 * IEEE 754 float conversion from integer value
 * @param value Integer value representing float bytes
 * @param byteLen Number of bytes (typically 4)
 */
export function binaryFloat(value: number, byteLen: number): number {
  const bitLen = byteLen * 8;
  const sign = value >> 31 === 0 ? 1 : -1;
  const exp = (value >> (bitLen - 9)) & 0xff;
  const mantissa = exp !== 0 ? (value & 0xffffff) | 0x800000 : value & 0x7fffffff;

  return sign * mantissa * 2 ** (exp - 150);
}

/**
 * Bytes addressed by a DataView, honoring byteOffset and byteLength.
 * `new Uint8Array(view.buffer)` would include bytes outside the view.
 */
export function copyDataView(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/**
 * Unpack a little-endian float from a byte array
 */
export function unpackFloat32LE(data: Uint8Array, offset: number = 0): number {
  const view = new DataView(data.buffer, data.byteOffset + offset, 4);
  return view.getFloat32(0, true);
}

/**
 * Unpack a little-endian 16-bit integer from a byte array
 */
export function unpackInt16LE(
  data: Uint8Array,
  offset: number = 0,
  signed: boolean = false,
): number {
  const view = new DataView(data.buffer, data.byteOffset + offset, 2);
  return signed ? view.getInt16(0, true) : view.getUint16(0, true);
}

/**
 * Unpack a little-endian 32-bit integer from a byte array
 */
export function unpackInt32LE(
  data: Uint8Array,
  offset: number = 0,
  signed: boolean = false,
): number {
  const view = new DataView(data.buffer, data.byteOffset + offset, 4);
  return signed ? view.getInt32(0, true) : view.getUint32(0, true);
}

/**
 * Pack a little-endian 16-bit integer into bytes
 */
export function packInt16LE(value: number): Uint8Array {
  const buffer = new ArrayBuffer(2);
  const view = new DataView(buffer);
  view.setInt16(0, value, true);
  return new Uint8Array(buffer);
}

/**
 * Pack a little-endian 32-bit integer into bytes
 */
export function packInt32LE(value: number): Uint8Array {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setInt32(0, value, true);
  return new Uint8Array(buffer);
}

/**
 * Convert byte array to hex string for debugging
 */
export function bytesToHex(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

/**
 * Build a byte value from a stack of bytes (little-endian)
 */
export function buildByteValue(stack: number[], dataSize: number): number {
  let byteValue = 0;
  for (let d = 0; d < dataSize && stack.length > 0; d++) {
    const stackValue = stack.shift()!;
    byteValue += stackValue * 2 ** (8 * d);
  }
  return byteValue;
}

// ==================== Byte Splitting Utilities ====================

/**
 * Split a 16-bit integer into individual bytes (little-endian order).
 * Useful for building command byte arrays.
 *
 * @param value The 16-bit integer value
 * @returns Tuple of [low byte, high byte]
 *
 * @example
 * ```typescript
 * const [low, high] = splitInt16LE(0x1234);
 * // low = 0x34, high = 0x12
 * ```
 */
export function splitInt16LE(value: number): [number, number] {
  return [value & 0xff, (value >> 8) & 0xff];
}

/**
 * Split a 32-bit integer into individual bytes (little-endian order).
 * Useful for building command byte arrays.
 *
 * @param value The 32-bit integer value
 * @returns Tuple of [byte0, byte1, byte2, byte3] (lowest to highest)
 *
 * @example
 * ```typescript
 * const bytes = splitInt32LE(0x12345678);
 * // bytes = [0x78, 0x56, 0x34, 0x12]
 * ```
 */
export function splitInt32LE(value: number): [number, number, number, number] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}

/**
 * Spread a 16-bit integer into a command array (little-endian).
 * Returns an array that can be spread into command building.
 *
 * @param value The 16-bit integer value
 * @returns Array of bytes [low, high]
 */
export function int16ToBytes(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

/**
 * Spread a 32-bit integer into a command array (little-endian).
 * Returns an array that can be spread into command building.
 *
 * @param value The 32-bit integer value
 * @returns Array of bytes [byte0, byte1, byte2, byte3]
 */
export function int32ToBytes(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}
