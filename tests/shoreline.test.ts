import { describe, expect, it } from 'vitest';
import { dryness, findWet, gateStep } from '../src/creatures/shoreline';

/** Minimal world: a beach sloping up toward -x (seabed y = -x * 0.5 - 2), still water. */
function world(level = 0) {
  return {
    terrain: { heightAt: (x: number) => -x * 0.5 - 2 },
    water: { level, waves: { amps: new Float32Array(6) } },
  } as any;
}

describe('crab shoreline limits', () => {
  it('treats shallow seabed as dry and deep seabed as wet', () => {
    const ctx = world();
    expect(dryness(ctx, -6, 0)).toBeGreaterThan(0); // seabed at +1: above water
    expect(dryness(ctx, 0, 0)).toBeLessThan(0); // seabed at -2
  });

  it('needs deeper water when waves are high', () => {
    const ctx = world();
    const calm = dryness(ctx, -3, 0);
    ctx.water.waves.amps.fill(0.15);
    expect(dryness(ctx, -3, 0)).toBeGreaterThan(calm);
  });

  it('blocks steps onto dry ground but lets stranded crabs walk back down', () => {
    const ctx = world();
    const p = { x: -3.5, z: 0 }; // stepping from -3.0 (wet) to -3.5 (dry)
    expect(gateStep(ctx, p, -3.0, 0)).toBe(true);
    expect(p.x).toBe(-3.0);
    const q = { x: -5.5, z: 0 }; // stranded at -6, moving toward the water
    expect(gateStep(ctx, q, -6, 0)).toBe(false);
    expect(q.x).toBe(-5.5);
  });

  it('finds the nearest wet spot from dry land', () => {
    const ctx = world();
    const out = { x: 0, z: 0 };
    expect(findWet(ctx, -8, 0, out)).toBe(true);
    expect(dryness(ctx, out.x, out.z)).toBeLessThan(0);
    expect(out.x).toBeGreaterThan(-8);
  });

  it('tide falling makes the same spot dry', () => {
    expect(dryness(world(0), -2.5, 0)).toBeLessThan(0);
    expect(dryness(world(-1.2), -2.5, 0)).toBeGreaterThan(0);
  });
});
