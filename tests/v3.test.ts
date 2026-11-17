import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { MESSAGES, pickMessage, messageById } from '../src/content/messages';
import { migrateGrid } from '../src/platform/WorldStore';
import { Prefs } from '../src/features/Prefs';
import { CoconutGrowth } from '../src/features/CoconutGrowth';
import { WaterSurfaceSimulation } from '../src/water/WaterSurfaceSimulation';
import { CONFIG, randZ, zClamp } from '../src/config';
import { TerrainSystem } from '../src/world/TerrainSystem';

describe('V3 world depth', () => {
  it('the world is deeper along z, front cut unchanged', () => {
    expect(CONFIG.world.zFront).toBe(6);
    const depth = CONFIG.world.zFront - CONFIG.world.zBack;
    expect(depth / 12).toBeGreaterThanOrEqual(1.5);
    expect(depth / 12).toBeLessThanOrEqual(1.8);
    for (let i = 0; i < 200; i++) {
      const z = randZ(1, 1.4);
      expect(z).toBeGreaterThanOrEqual(CONFIG.world.zBack + 1 - 1e-9);
      expect(z).toBeLessThanOrEqual(CONFIG.world.zFront - 1 + 1e-9);
    }
    expect(zClamp(-99, 0.5)).toBe(CONFIG.world.zBack + 0.5);
  });

  it('old v2 sand grids are resampled by world coordinates (no shifting)', () => {
    // v2 grid: 361 × 61 over x [-30, 30], z [-6, 6]; a sand bump at (x = 3, z = 2)
    const onx = 361,
      onz = 61;
    const old = new Float32Array(onx * onz * 2);
    for (let j = 0; j < onz; j++)
      for (let i = 0; i < onx; i++) {
        const x = -30 + (i / (onx - 1)) * 60,
          z = -6 + (j / (onz - 1)) * 12;
        old[j * onx + i] = Math.max(0, 1 - Math.hypot(x - 3, z - 2) / 1.5);
      }
    const t = new TerrainSystem();
    const out = migrateGrid(old, onx, onz, [-30, 30, -6, 6], t.nx, t.nz);
    t.restore(out);
    expect(t.sedimentAt(3, 2)).toBeCloseTo(1, 1);
    expect(t.sedimentAt(3, 3.6)).toBeLessThan(0.05);
    // the new deep region has no sand from the old save
    expect(t.sedimentAt(3, -10)).toBe(0);
    // identity when the grid already matches
    const same = new Float32Array(t.nx * t.nz * 2);
    const W = CONFIG.world;
    expect(migrateGrid(same, t.nx, t.nz, [W.xMin, W.xMax, W.zBack, W.zFront], t.nx, t.nz)).toBe(same);
  });
});

describe('Ocean Mail messages', () => {
  it('has enough bilingual entries with stable unique ids', () => {
    const count = (c: string) => MESSAGES.filter((m) => m.cat === c).length;
    expect(count('fact')).toBeGreaterThanOrEqual(20);
    expect(count('fortune')).toBeGreaterThanOrEqual(30);
    expect(count('thought')).toBeGreaterThanOrEqual(20);
    const ids = new Set(MESSAGES.map((m) => m.id));
    expect(ids.size).toBe(MESSAGES.length);
    for (const m of MESSAGES) {
      expect(m.zh.length).toBeGreaterThan(4);
      expect(m.en.length).toBeGreaterThan(8);
      expect(/[一-鿿]/.test(m.zh)).toBe(true);
      expect(messageById(m.id)).toBe(m);
    }
  });

  it('never repeats a recently shown message', () => {
    const recent: string[] = [];
    for (let i = 0; i < 60; i++) {
      const m = pickMessage(recent);
      expect(recent.slice(-40)).not.toContain(m.id);
      recent.push(m.id);
    }
  });
});

describe('Coconut growth timer', () => {
  afterEach(() => vi.useRealTimers());

  function setup(now: number) {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const prefs = new Prefs();
    prefs.data.coconut = { on: true, intervalMin: 60, max: 4, trees: [{ ripe: 0, since: now }, { ripe: 3, since: now }] };
    const palms = [0, 1].map(() => ({ crown: new THREE.Group(), origin: new THREE.Vector3(), trunk: new THREE.Mesh(), fronds: [], spine: [] }));
    const app = { island: { palms, shakePalm() {} }, ui: null } as any;
    return { prefs, coco: new CoconutGrowth(app, prefs) };
  }

  it('ripens on the interval from timestamps, capped per tree', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const { prefs, coco } = setup(t0);
    expect(coco.nextIn(t0)).toBe(60 * 60_000);
    vi.setSystemTime(t0 + 2.5 * 3600_000); // 2.5 h later (e.g. wallpaper was closed)
    coco.update(0.016, 0);
    expect(prefs.data.coconut.trees[0].ripe).toBe(2);
    expect(prefs.data.coconut.trees[1].ripe).toBe(4); // capped at max
    // partial progress is kept: next coconut on tree 0 in 30 min
    expect(Math.round(coco.nextIn()! / 60_000)).toBe(30);
    vi.setSystemTime(t0 + 48 * 3600_000); // two days offline: never beyond the limit
    coco.update(0.016, 0);
    expect(prefs.data.coconut.trees.map((t) => t.ripe)).toEqual([4, 4]);
    expect(coco.nextIn()).toBeNull();
  });

  it('pausing growth stops the clock', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const { prefs, coco } = setup(t0);
    coco.setEnabled(false);
    vi.setSystemTime(t0 + 5 * 3600_000);
    coco.update(0.016, 0);
    expect(prefs.data.coconut.trees[0].ripe).toBe(0);
    coco.setEnabled(true);
    expect(coco.nextIn()).toBe(60 * 60_000);
  });
});

describe('Prefs validation', () => {
  it('rejects malformed imported values', () => {
    const p = new Prefs();
    p.merge({ lang: 'fr', mail: { on: false, freq: 'sometimes', nextIn: -5, recent: [1, 'fact-01'] }, coconut: { intervalMin: 7, max: 99, trees: [{ ripe: 50, since: 1 }] } } as any);
    expect(p.data.lang === 'zh' || p.data.lang === 'en').toBe(true);
    expect(p.data.mail.on).toBe(false);
    expect(p.data.mail.freq).toBe('normal');
    expect(p.data.mail.nextIn).toBeGreaterThanOrEqual(60);
    expect(p.data.mail.recent).toEqual(['fact-01']);
    expect(p.data.coconut.intervalMin).toBe(180);
    expect(p.data.coconut.max).toBe(5);
    expect(p.data.coconut.trees[0].ripe).toBe(5);
  });
});

describe('Water solver stability', () => {
  it('stays stable with slow frames and maximum wind', () => {
    const sim = new WaterSurfaceSimulation();
    sim.updateMask(() => -6);
    for (let i = 0; i < 15 * 30; i++) sim.step(1 / 15, 1);
    let mx = 0;
    for (const v of sim.h) mx = Math.max(mx, Math.abs(v));
    expect(mx).toBeLessThan(0.6);
  });
});
