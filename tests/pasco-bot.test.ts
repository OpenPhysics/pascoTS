import { describe, expect, it } from 'vitest';

import { BLEAdapterBase, type BLEClientBase } from '@/ble/ble-adapter.js';
import { PascoBot } from '@/pasco-bot.js';
import type { BLEDevice } from '@/types/ble.js';

class UnusedAdapter extends BLEAdapterBase {
  async scan(): Promise<BLEDevice[]> {
    return [];
  }
  async stopScan(): Promise<void> {}
  createClient(): BLEClientBase {
    throw new Error('unused');
  }
  isAvailable(): boolean {
    return false;
  }
}

class TestBot extends PascoBot {
  captured: {
    speedA: number | null;
    accelerationA: number | null;
    speedB: number | null;
    accelerationB: number | null;
  } | null = null;

  constructor() {
    super(new UnusedAdapter());
    this._stateMachine.transitionTo('connecting', 'test');
    this._stateMachine.transitionTo('connected', 'test');
  }

  protected override async _sendStepperCommand(
    speedA: number | null,
    accelerationA: number | null,
    _distanceA: number | 'continuous' | null,
    speedB: number | null,
    accelerationB: number | null,
    _distanceB: number | 'continuous' | null,
  ): Promise<void> {
    this.captured = { speedA, accelerationA, speedB, accelerationB };
  }

  protected override async _getStepperRemaining(): Promise<[number, number, number, number]> {
    return [0, 0, 0, 0];
  }
}

describe('PascoBot.turn', () => {
  it('keeps speed signed and uses a positive acceleration for negative angles', async () => {
    const bot = new TestBot();
    await bot.turn(-90);

    expect(bot.captured?.speedA).toBeLessThan(0);
    expect(bot.captured?.speedB).toBeLessThan(0);
    expect(bot.captured?.accelerationA).toBe(360);
    expect(bot.captured?.accelerationB).toBe(360);
  });

  it('keeps a positive speed for a positive angle', async () => {
    const bot = new TestBot();
    await bot.turn(90);

    expect(bot.captured?.speedA).toBeGreaterThan(0);
    expect(bot.captured?.speedB).toBeGreaterThan(0);
    expect(bot.captured?.accelerationA).toBe(360);
    expect(bot.captured?.accelerationB).toBe(360);
  });
});
