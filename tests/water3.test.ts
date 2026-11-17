import { describe, it, expect } from 'vitest';
import { WaterSurfaceSimulation } from '../src/water/WaterSurfaceSimulation';

describe('Water surface W(x, z, t)', () => {
  it('micro ripples are part of the shared height field and fade out', () => {
    const sim = new WaterSurfaceSimulation();
    sim.updateMask(() => -6);
    sim.addRipple(0, 0, 0.06);
    let maxDev = 0;
    for (let f = 0; f < 30; f++) {
      sim.step(1 / 60, 0);
      for (let r = 0.2; r < 2; r += 0.05) maxDev = Math.max(maxDev, Math.abs(sim.rippleHeight(r, 0)));
    }
    expect(maxDev).toBeGreaterThan(0.005);
    for (let f = 0; f < 200; f++) sim.step(1 / 60, 0);
    expect(Math.abs(sim.rippleHeight(1, 0))).toBeLessThan(1e-4);
  });

  it('heightAt follows the sea level (tide)', () => {
    const sim = new WaterSurfaceSimulation();
    sim.updateMask(() => -6);
    const h0 = sim.heightAt(3, 1);
    sim.level = -0.8;
    expect(sim.heightAt(3, 1)).toBeCloseTo(h0 - 0.8, 5);
  });
});
