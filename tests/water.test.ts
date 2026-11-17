import { describe, it, expect } from 'vitest';
import { WaterSurfaceSimulation } from '../src/water/WaterSurfaceSimulation';
import { CONFIG } from '../src/config';

describe('WaterSurfaceSimulation', () => {
  it('stays bounded and decays after impulses (no blow-up)', () => {
    const sim = new WaterSurfaceSimulation();
    sim.updateMask(() => -6);
    for (let i = 0; i < 10; i++) sim.disturb(-5 + i, 2.5, -CONFIG.water.clickImpulse * 3, 0.5);
    let maxEarly = 0;
    for (let f = 0; f < 120; f++) {
      sim.step(1 / 60, 0);
      for (const h of sim.h) maxEarly = Math.max(maxEarly, Math.abs(h));
    }
    expect(maxEarly).toBeGreaterThan(0.01);
    expect(maxEarly).toBeLessThanOrEqual(CONFIG.water.maxDisplacement + 1e-6);
    for (let f = 0; f < 1800; f++) sim.step(1 / 60, 0);
    let maxLate = 0;
    for (const h of sim.h) maxLate = Math.max(maxLate, Math.abs(h));
    expect(maxLate).toBeLessThan(maxEarly * 0.2);
    for (const h of sim.h) expect(Number.isFinite(h)).toBe(true);
  });

  it('drag pull lifts the surface toward the target but never beyond the clamp', () => {
    const sim = new WaterSurfaceSimulation();
    sim.updateMask(() => -6);
    for (let f = 0; f < 90; f++) sim.pull(0, 2.6, 5, CONFIG.water.dragStiffness, 0.9, 1 / 60), sim.step(1 / 60, 0);
    const h = sim.simHeight(0, 2.6);
    expect(h).toBeGreaterThan(0.2);
    expect(h).toBeLessThanOrEqual(CONFIG.water.maxDisplacement + 1e-6);
  });

  it('keeps island cells as walls', () => {
    const sim = new WaterSurfaceSimulation();
    sim.updateMask((x) => (Math.abs(x + 8) < 2 ? 1 : -6));
    sim.disturb(-8, 0, -5, 1.5);
    for (let f = 0; f < 60; f++) sim.step(1 / 60, 0.5);
    expect(Math.abs(sim.simHeight(-8, 0))).toBeLessThan(1e-6);
  });
});
