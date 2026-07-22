import { describe, expect, it } from 'vitest';

import {
  calc4Params,
  calcLinearParams,
  calcRotaryPos,
  limit,
  linearInterpolate,
  roundToPrecision,
  threeInputVector,
} from '@/utils/math.js';

describe('calcLinearParams', () => {
  it('computes y = m*x + b', () => {
    expect(calcLinearParams(10, 2, 3)).toBe(23);
    expect(calcLinearParams(0, 5, -1)).toBe(-1);
  });
});

describe('calc4Params', () => {
  it('recovers a linear fit through two calibration points', () => {
    // Points (x1,y1)=(0,0) and (x2,y2)=(10,100) => slope 10, offset 0.
    expect(calc4Params(5, 0, 0, 10, 100)).toBeCloseTo(50, 6);
  });
});

describe('limit', () => {
  it('clamps values into range', () => {
    expect(limit(5, 0, 10)).toBe(5);
    expect(limit(-1, 0, 10)).toBe(0);
    expect(limit(99, 0, 10)).toBe(10);
  });
});

describe('roundToPrecision', () => {
  it('rounds to the requested number of decimals', () => {
    expect(roundToPrecision(1.2345, 2)).toBe(1.23);
    expect(roundToPrecision(3.4, 0)).toBe(3);
    expect(roundToPrecision(123.456, 1)).toBe(123.5);
  });
});

describe('threeInputVector', () => {
  it('computes the 3D magnitude', () => {
    expect(threeInputVector(3, 4, 0)).toBe(5);
    expect(threeInputVector(2, 3, 6)).toBe(7);
  });
});

describe('calcRotaryPos', () => {
  it('scales count by x/r', () => {
    expect(calcRotaryPos(960, 360, 960)).toBe(360);
  });
});

describe('linearInterpolate', () => {
  const points: [number, number][] = [
    [0, 0],
    [10, 100],
    [20, 300],
  ];

  it('interpolates within the range', () => {
    expect(linearInterpolate(5, points)).toBeCloseTo(50, 6);
    expect(linearInterpolate(15, points)).toBeCloseTo(200, 6);
  });

  it('extrapolates below and above the range', () => {
    expect(linearInterpolate(-5, points)).toBeCloseTo(-50, 6);
    expect(linearInterpolate(25, points)).toBeCloseTo(400, 6);
  });

  it('throws when given fewer than 2 points', () => {
    expect(() => linearInterpolate(1, [[0, 0]])).toThrow();
  });
});
