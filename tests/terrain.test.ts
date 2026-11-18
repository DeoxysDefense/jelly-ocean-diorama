import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { TerrainSystem } from '../src/world/TerrainSystem';
import { CONFIG } from '../src/config';

describe('TerrainSystem sediment', () => {
  it('adds sand on top of the base and removal never digs into the original seabed', () => {
    const t = new TerrainSystem();
    const base = t.base.slice();
    const h0 = t.heightAt(2, 0.5);
    for (let i = 0; i < 400; i++) t.addSediment(2 + (i % 5) * 0.05, 0.5, CONFIG.sand.grainVolume);
    for (let i = 0; i < 200; i++) t.relax(1 / 60);
    expect(t.heightAt(2, 0.5)).toBeGreaterThan(h0 + 0.05);
    // aggressive removal
    for (let i = 0; i < 300; i++) t.removeSediment(2, 0.5, 3, 3, 1);
    for (let k = 0; k < t.sed.length; k++) expect(t.sed[k]).toBeGreaterThanOrEqual(0);
    expect(t.base).toEqual(base);
    expect(Math.abs(t.heightAt(2, 0.5) - h0)).toBeLessThan(1e-4);
  });

  it('relaxes steep piles toward the angle of repose', () => {
    const t = new TerrainSystem();
    for (let i = 0; i < 1500; i++) t.addSediment(4, 0, CONFIG.sand.grainVolume);
    for (let i = 0; i < 600; i++) t.relax(1 / 60);
    let maxSlope = 0;
    for (let j = 1; j < t.nz - 1; j++)
      for (let i = 1; i < t.nx - 1; i++) {
        const k = j * t.nx + i;
        if (t.sed[k] <= 0) continue;
        const h = t.base[k] + t.sed[k];
        const hx = t.base[k + 1] + t.sed[k + 1];
        maxSlope = Math.max(maxSlope, (h - hx) / t.dx);
      }
    expect(maxSlope).toBeLessThan(CONFIG.sand.reposeSlope * 1.6);
  });

  it('snapshot / restore round-trips sediment', () => {
    const t = new TerrainSystem();
    const snap = t.snapshot();
    t.addSediment(0, 0, 0.05);
    expect(t.hasSediment()).toBe(true);
    t.restore(snap);
    expect(t.hasSediment()).toBe(false);
  });
});

describe('Terrain editor brushes', () => {
  it('island stamp rises above the water and is fully erasable', () => {
    const t = new TerrainSystem();
    const base = t.base.slice();
    const added = t.stampIsland(4, 1, 2.5);
    expect(added).toBeGreaterThan(1);
    expect(t.heightAt(4, 1)).toBeGreaterThan(CONFIG.world.waterLevel);
    for (let i = 0; i < 400; i++) t.removeSediment(4, 1, 13, 13, 1); // the shoreface skirt reaches ~radius + 8
    expect(t.hasSediment()).toBe(false);
    expect(t.base).toEqual(base);
  });

  it('smooth lowers a peak without touching the base', () => {
    const t = new TerrainSystem();
    const base = t.base.slice();
    for (let i = 0; i < 300; i++) t.addSediment(2, 0, CONFIG.sand.grainVolume);
    const peak = t.heightAt(2, 0);
    for (let i = 0; i < 60; i++) t.smoothSediment(2, 0, 1.2, 0.5);
    expect(t.heightAt(2, 0)).toBeLessThan(peak);
    expect(t.base).toEqual(base);
    for (const v of t.sed) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('raycasts the seabed from straight above (Top View)', () => {
    const t = new TerrainSystem();
    const ray = new THREE.Ray(new THREE.Vector3(5, 50, 2), new THREE.Vector3(0, -1, 0));
    const hit = t.raycast(ray);
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.y - t.heightAt(5, 2))).toBeLessThan(0.02);
  });
});
