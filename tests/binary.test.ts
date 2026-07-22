import { describe, expect, it } from 'vitest';

import {
  binaryFloat,
  binaryFraction,
  buildByteValue,
  decode64,
  int16ToBytes,
  int32ToBytes,
  splitInt16LE,
  splitInt32LE,
  twosComplement,
} from '@/utils/binary.js';

describe('twosComplement', () => {
  it('leaves positive 1-byte values unchanged', () => {
    expect(twosComplement(0x64, 1)).toBe(100);
  });

  it('converts negative 1-byte values', () => {
    expect(twosComplement(0xff, 1)).toBe(-1);
    expect(twosComplement(0x80, 1)).toBe(-128); // most-negative boundary
  });

  it('handles 2-byte boundaries', () => {
    expect(twosComplement(0x0064, 2)).toBe(100);
    expect(twosComplement(0xffff, 2)).toBe(-1);
    expect(twosComplement(0x8000, 2)).toBe(-32768); // most-negative boundary
    expect(twosComplement(0x7fff, 2)).toBe(32767); // most-positive boundary
  });

  // Regression: 4-byte (32-bit) values used to be corrupted because the
  // implementation used `1 << 32` / `1 << 31`, which wrap under JS's signed
  // 32-bit bitwise operators. See src/utils/binary.ts.
  it('handles 4-byte values without 32-bit bitwise wraparound', () => {
    expect(twosComplement(100, 4)).toBe(100);
    expect(twosComplement(0xffffffff, 4)).toBe(-1);
    expect(twosComplement(0x80000000, 4)).toBe(-2147483648); // most-negative
    expect(twosComplement(0x7fffffff, 4)).toBe(2147483647); // most-positive
    expect(twosComplement(0xfffffffe, 4)).toBe(-2);
  });
});

describe('binaryFraction', () => {
  it('splits into integer and fractional parts', () => {
    expect(binaryFraction(0x00010000)).toBe(1); // 1.0
    expect(binaryFraction(0x00018000)).toBe(1.5); // 1 + 0.5
    expect(binaryFraction(0)).toBe(0);
  });
});

describe('binaryFloat', () => {
  it('reconstructs IEEE-754 single-precision values', () => {
    expect(binaryFloat(0x3f800000, 4)).toBeCloseTo(1, 6);
    expect(binaryFloat(0xbf800000, 4)).toBeCloseTo(-1, 6);
    expect(binaryFloat(0x40490fdb, 4)).toBeCloseTo(Math.PI, 5);
    expect(binaryFloat(0xc2f60000, 4)).toBeCloseTo(-123, 4);
  });
});

describe('decode64', () => {
  it('decodes the PASCO base-64 alphabet', () => {
    expect(decode64('0')).toBe(0);
    expect(decode64('9')).toBe(9);
    expect(decode64('K')).toBe(10);
    expect(decode64('Z')).toBe(25);
    expect(decode64('A')).toBe(26);
    expect(decode64('J')).toBe(35);
    expect(decode64('a')).toBe(36);
    expect(decode64('z')).toBe(61);
    expect(decode64('*')).toBe(62);
    expect(decode64('#')).toBe(63);
    expect(decode64('?')).toBe(-1);
  });
});

describe('byte helpers', () => {
  it('splits and builds little-endian integers', () => {
    expect(splitInt16LE(0x1234)).toEqual([0x34, 0x12]);
    expect(splitInt32LE(0x12345678)).toEqual([0x78, 0x56, 0x34, 0x12]);
    expect(int16ToBytes(0x1234)).toEqual([0x34, 0x12]);
    expect(int32ToBytes(0x12345678)).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it('builds a little-endian value from a byte stack', () => {
    const stack = [0x34, 0x12, 0xff];
    expect(buildByteValue(stack, 2)).toBe(0x1234);
    // consumed bytes are shifted off the stack
    expect(stack).toEqual([0xff]);
  });
});
