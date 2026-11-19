import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CONFIG, focusPose, zCentre } from '../src/config';
import { TerrainSystem } from '../src/world/TerrainSystem';
import { archipelagoHeight, ARCHI } from '../src/world/Archipelago';
import { cropGrid, decodeGrid, migrateGrid, SAVE_VERSION, uncropGrid, type SavedWorld } from '../src/platform/WorldStore';
import { CameraManager } from '../src/core/CameraManager';
import { WaterSurfaceSimulation } from '../src/water/WaterSurfaceSimulation';

const W = CONFIG.world;
const V1 = CONFIG.v1;

/** Screen-space vertical coordinate (world units) of a point for a camera. */
function screenY(cam: THREE.Camera, x: number, y: number, z: number) {
  const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  return new THREE.Vector3(x, y, z).sub(cam.position).dot(up);
}

describe('V2 world size', () => {
  it('is 1.7x wider and 1.5x deeper than v1, front cut unchanged', () => {
    expect((W.xMax - W.xMin) / (V1.xMax - V1.xMin)).toBeCloseTo(1.7, 2);
    expect((W.zFront - W.zBack) / (6 - V1.zBack)).toBeCloseTo(1.5, 1);
    expect(W.zFront).toBe(6);
  });

  it('keeps the v1 base terrain inside the v1 core region (old saves land on the same ground)', () => {
    for (let i = 0; i < 400; i++) {
      const x = -22.9 + Math.random() * 45.8,
        z = -13 + Math.random() * 19;
      const y = -5 + Math.random() * 3;
      expect(archipelagoHeight(x, z, y)).toBe(y);
    }
  });

  it('has the archipelago: a sand cay with a tidal flat, low islands, a deep east', () => {
    const h = (x: number, z: number) => TerrainSystem.baseHeight(x, z);
    const C = ARCHI.cay;
    // dry land at mid tide, but low (no cliffs): the cay and the granite island's beach
    expect(h(C.x, C.z)).toBeGreaterThan(0.3);
    expect(h(C.x, C.z)).toBeLessThan(0.8);
    expect(h(ARCHI.granite.x, ARCHI.granite.z)).toBeGreaterThan(0.2);
    expect(h(ARCHI.granite.x, ARCHI.granite.z)).toBeLessThan(0.8);
    // a tidal flat around the cay: under water at mid tide, dry at low tide (auto tide -1.1 … +0.7)
    const flat = h(C.x, C.z + C.rz + 1.2);
    expect(flat).toBeLessThan(-0.05);
    expect(flat).toBeGreaterThan(-1.0);
    // the boulder reef flat sits right beside the cay, just under the surface
    expect(Math.hypot(ARCHI.rocks.x - C.x, ARCHI.rocks.z - C.z)).toBeLessThan(9);
    expect(h(ARCHI.rocks.x, ARCHI.rocks.z)).toBeGreaterThan(-1.0);
    // no steep peaks anywhere on the tray (max natural slope stays moderate outside the core)
    let maxSlope = 0;
    for (let x = W.xMin + 1; x < -23; x += 0.5)
      for (let z = W.zBack + 1; z < W.zFront - 1; z += 0.5) maxSlope = Math.max(maxSlope, Math.abs(h(x + 0.25, z) - h(x - 0.25, z)) / 0.5, Math.abs(h(x, z + 0.25) - h(x, z - 0.25)) / 0.5);
    expect(maxSlope).toBeLessThan(1.2);
    // the east is deep, open water (no land, no holes)
    for (let x = ARCHI.deep.xFull + 2; x < W.xMax - 1; x += 1.5)
      for (let z = W.zBack + 1; z < W.zFront - 1; z += 1.5) {
        expect(h(x, z)).toBeLessThan(-9);
        expect(h(x, z)).toBeGreaterThan(-11.5);
      }
  });
});

describe('Save schema v4', () => {
  it('v3 saves migrate onto the bigger grid without moving or blurring sand', () => {
    // v3 grid: 361 x 96 over x [-30, 30], z [-13, 6]; one-cell sand column at (x = 4, z = 1)
    const onx = 361,
      onz = 96;
    const old = new Float32Array(onx * onz * 2);
    const i = Math.round((4 + 30) * 6),
      j = Math.round((1 + 13) / 0.2);
    old[j * onx + i] = 0.8;
    old[onx * onz + j * onx + i] = 0.5;
    const t = new TerrainSystem();
    const out = migrateGrid(old, onx, onz, [-30, 30, -13, 6], t.nx, t.nz);
    // v1 rows / columns line up with the V2 grid exactly
    const ni = Math.round((4 - W.xMin) * 6),
      nj = Math.round((1 - W.zBack) / t.dz);
    expect(t.x0 + ni * t.dx).toBeCloseTo(4, 6);
    expect(t.z0 + nj * t.dz).toBeCloseTo(1, 6);
    expect(out[nj * t.nx + ni]).toBeCloseTo(0.8, 5);
    expect(out[t.nx * t.nz + nj * t.nx + ni]).toBeCloseTo(0.5, 5);
    let total = 0;
    for (let k = 0; k < t.nx * t.nz; k++) total += out[k];
    expect(total).toBeCloseTo(0.8, 4);
  });

  it('stores only the box of cells that hold sand, and decodes every version', () => {
    const t = new TerrainSystem();
    t.stampIsland(-30, 2, 2.5);
    const full = t.snapshot();
    const crop = cropGrid(full, t.nx, t.nz)!;
    expect(crop.data.length).toBeLessThan(full.length / 10);
    const back = uncropGrid(crop.data, crop.box, t.nx, t.nz);
    expect(back).toEqual(full);
    expect(cropGrid(new Float32Array(t.nx * t.nz * 2), t.nx, t.nz)).toBeNull();

    const b64 = (a: Float32Array) => {
      let s = '';
      for (const c of new Uint8Array(a.buffer, a.byteOffset, a.byteLength)) s += String.fromCharCode(c);
      return btoa(s);
    };
    const v4: SavedWorld = {
      version: SAVE_VERSION as 4,
      savedAt: '',
      grid: [t.nx, t.nz],
      bounds: [W.xMin, W.xMax, W.zBack, W.zFront],
      box: crop.box,
      sediment: b64(crop.data),
      objects: [],
      env: { preset: 'tropical', customColor: '#22b8c8', wind: 25 },
    };
    const d = decodeGrid(v4)!;
    expect(d.raw).toEqual(full);
    // empty world
    expect(decodeGrid({ ...v4, box: [0, -1, 0, -1], sediment: '' })!.raw.every((v) => v === 0)).toBe(true);
    // v3 (full grid, own bounds) and v2 (no bounds) still decode
    const v3: SavedWorld = { ...v4, version: 3, box: undefined, grid: [4, 3], bounds: [-30, 30, -13, 6], sediment: b64(new Float32Array(24)) };
    expect(decodeGrid(v3)!.bounds).toEqual([-30, 30, -13, 6]);
    expect(decodeGrid({ ...v3, version: 2, bounds: undefined })!.bounds).toEqual([-30, 30, -6, 6]);
    // a corrupt box is rejected
    expect(decodeGrid({ ...v4, box: [0, t.nx + 5, 0, 1] })).toBeNull();
  });
});

describe('Three camera views', () => {
  function v1Camera() {
    const ref = new THREE.OrthographicCamera(-16, 16, 9, -9, 1, 160);
    const t0 = (V1.tiltDeg * Math.PI) / 180;
    const target = new THREE.Vector3(0, V1.centerY, 0);
    ref.position.copy(target).addScaledVector(new THREE.Vector3(0, Math.sin(t0), Math.cos(t0)), 60);
    ref.up.set(0, Math.cos(t0), -Math.sin(t0));
    ref.lookAt(target);
    ref.updateMatrixWorld();
    return ref;
  }
  /** Screen y relative to the frame centre. */
  const rel = (c: THREE.Camera, y: number, z: number, cx = 0) => {
    const dir = new THREE.Vector3();
    c.getWorldDirection(dir);
    // the frame centre is the camera position projected along the view direction
    return screenY(c, cx, y, z) - screenY(c, c.position.x, c.position.y, c.position.z);
  };

  it('Focus View keeps the v1 front waterline and horizon exactly where they were', () => {
    const cam = new CameraManager();
    cam.resize(1600, 900);
    const c = cam.camera;
    const ref = v1Camera();
    expect(rel(c, 0, W.zFront)).toBeCloseTo(rel(ref, 0, W.zFront), 3);
    expect(rel(c, 0, W.zBack)).toBeCloseTo(rel(ref, 0, V1.zBack), 3);
    // seabed at the front cut (y −6) moves by less than 0.05 units (cos difference only)
    expect(Math.abs(rel(c, -6, W.zFront) - rel(ref, -6, W.zFront))).toBeLessThan(0.05);
    expect(focusPose().tilt).toBeLessThan((V1.tiltDeg * Math.PI) / 180);
    expect(cam.viewH).toBe(18);
  });

  it('Focus pans along x but never shows past the tray ends', () => {
    const cam = new CameraManager();
    cam.resize(1600, 900);
    cam.panBy(999, 0);
    cam.update(0);
    expect(cam.visibleX().max).toBeLessThanOrEqual(W.xMax);
    expect(cam.focusX + cam.focusHalfW()).toBeLessThanOrEqual(W.xMax);
    cam.panBy(-9999, 0);
    cam.update(0);
    expect(cam.focusX - cam.focusHalfW()).toBeGreaterThanOrEqual(W.xMin);
    // ultrawide keeps the rule too
    cam.resize(2560, 1080);
    expect(cam.focusX - cam.focusHalfW()).toBeGreaterThanOrEqual(W.xMin);
  });

  it('transitions between all three views and lands on each pose', () => {
    const cam = new CameraManager();
    cam.resize(1600, 900);
    const seq: ('full' | 'top' | 'focus')[] = ['full', 'top', 'focus', 'top', 'full', 'focus'];
    for (const v of seq) {
      cam.setView(v);
      for (let i = 0; i < 120; i++) cam.update(1 / 60);
      expect(cam.transitioning).toBe(false);
      if (v === 'top') expect(cam.blend).toBeCloseTo(1, 5);
      if (v === 'focus') expect(cam.blend).toBeCloseTo(0, 5);
      if (v === 'full') {
        expect(cam.fullness).toBeGreaterThan(0.9);
        // the whole tray is in frame
        expect(cam.viewW).toBeGreaterThanOrEqual(W.xMax - W.xMin);
      }
    }
  });

  it('Top View zoom and pan stay on the tray', () => {
    const cam = new CameraManager();
    cam.resize(1600, 900);
    cam.setView('top', true);
    cam.zoomAt(0, 0, 0.01);
    cam.update(0);
    // zoomed out as far as allowed: the depth fits, no empty band above / below
    expect(cam.viewH).toBeLessThanOrEqual(W.zFront - W.zBack + 3 + 1e-6);
    cam.zoomAt(0.5, 0.5, 100);
    cam.update(0);
    expect(cam.topZoom).toBeCloseTo(CONFIG.camera.topZoomMax, 5);
    cam.panBy(-500, 500);
    cam.update(0);
    expect(cam.pose.tx - cam.viewW / 2).toBeGreaterThanOrEqual(W.xMin - 1.3);
    expect(cam.pose.tz + cam.viewH / 2).toBeLessThanOrEqual(W.zFront + 1.3);
    // default framing is v1's Top View (zoom 1, centred on the depth)
    const c2 = new CameraManager();
    c2.resize(1600, 900);
    c2.setView('top', true);
    expect(c2.viewH).toBeCloseTo(CONFIG.camera.topDepth, 5);
    expect(c2.pose.tz).toBeCloseTo(zCentre(), 5);
  });

  it('restores a persisted camera and accepts the v1 "front" alias', () => {
    const cam = new CameraManager();
    cam.resize(1600, 900);
    cam.restore({ view: 'front', focusX: 12.5 });
    expect(cam.view).toBe('focus');
    expect(cam.focusX).toBe(12.5);
    cam.restore({ view: 'full', focusX: 9999 });
    expect(cam.view).toBe('full');
    expect(cam.focusX).toBe(cam.focusRange().max);
  });
});

describe('Water tiles sleep without changing the result', () => {
  it('matches the always-awake solver and sleeps once calm', () => {
    const a = new WaterSurfaceSimulation();
    const b = new WaterSurfaceSimulation();
    b.sleep = false;
    const ground = (x: number, z: number) => TerrainSystem.baseHeight(x, z);
    a.updateMask(ground);
    b.updateMask(ground);
    expect(a.awakeTiles()).toBeGreaterThan(0); // the mask wakes tiles once
    for (let f = 0; f < 200; f++) {
      a.step(1 / 60, 0);
      b.step(1 / 60, 0);
    }
    a.disturb(5, 1, -3, 0.6);
    b.disturb(5, 1, -3, 0.6);
    let maxDiff = 0;
    for (let f = 0; f < 240; f++) {
      a.step(1 / 60, 0);
      b.step(1 / 60, 0);
      if (f % 20 === 0) for (let k = 0; k < a.h.length; k += 7) maxDiff = Math.max(maxDiff, Math.abs(a.h[k] - b.h[k]));
    }
    expect(maxDiff).toBeLessThan(2e-3);
    // a disturbance only wakes part of the tray
    expect(a.awakeTiles()).toBeLessThan(a.tilesX * a.tilesZ * 0.8);
    for (let f = 0; f < 60 * 40; f++) a.step(1 / 60, 0);
    expect(a.awakeTiles()).toBe(0);
  });
});

describe('V2 life', () => {
  it('coconut prefs keep every palm (older prefs grow to the new palm count)', async () => {
    const { Prefs } = await import('../src/features/Prefs');
    const p = new Prefs();
    const now = Date.now();
    p.merge({ coconut: { on: true, intervalMin: 180, max: 4, trees: Array.from({ length: 7 }, (_, i) => ({ ripe: i % 3, since: now })) } } as never);
    expect(p.data.coconut.trees.length).toBe(7);
    expect(p.data.coconut.trees[5].ripe).toBe(2);
    const { CoconutGrowth } = await import('../src/features/CoconutGrowth');
    const palms = Array.from({ length: 5 }, () => ({ crown: new THREE.Group(), origin: new THREE.Vector3(), trunk: new THREE.Mesh(), fronds: [], spine: [] }));
    const old = new Prefs();
    old.data.coconut.trees = [{ ripe: 2, since: now }, { ripe: 1, since: now }];
    new CoconutGrowth({ island: { palms: palms.slice(0, 2), allPalms: palms, shakePalm() {} }, ui: null } as never, old);
    expect(old.data.coconut.trees.length).toBe(5);
    expect(old.data.coconut.trees[0].ripe).toBe(2); // the v1 palms keep their state
    expect(old.data.coconut.trees[4].ripe).toBe(1); // new palms start with one ripe coconut
  });

  it('extra species have Life sliders with sane defaults', async () => {
    const { POP_LIMITS, POP_DEFAULTS } = await import('../src/creatures/CreatureManager');
    for (const k of ['sergeant', 'parrot', 'wrasse', 'snapper', 'barracuda', 'grouper', 'lagoonCrab', 'shrimp', 'urchin', 'cucumber', 'gardenEel']) {
      expect(POP_LIMITS[k]).toBeDefined();
      expect(POP_DEFAULTS[k]).toBeGreaterThan(0);
      expect(POP_DEFAULTS[k]).toBeLessThanOrEqual(POP_LIMITS[k][1]);
    }
    // the v1 residents keep their v1 defaults
    expect(POP_DEFAULTS.silverside).toBe(CONFIG.creatures.schoolCount);
    expect(POP_DEFAULTS.crab).toBe(CONFIG.creatures.crabCount);
  });

  it('every habitat has places to go, at the right depths', async () => {
    const { Reef } = await import('../src/world/Reef');
    const { Habitat } = await import('../src/world/Habitat');
    const t = new TerrainSystem();
    const h = new Habitat(t, new Reef(t));
    const kinds = ['mainReef', 'lagoonReef', 'seagrass', 'lagoon', 'slope', 'deep', 'open'] as const;
    for (const k of kinds) expect(h.count(k)).toBeGreaterThan(5);
    for (let i = 0; i < 50; i++) {
      const p = h.sample('deep', [0, 0.2])!;
      expect(p.x).toBeGreaterThan(ARCHI.deep.xFull - 3);
      expect(p.y).toBeLessThan(-5); // near the deep floor
      const q = h.sample('lagoonReef', [0.2, 0.6])!;
      expect(q.x).toBeLessThan(-22);
      expect(q.y).toBeLessThan(W.waterLevel);
      expect(q.y).toBeGreaterThan(t.heightAt(q.x, q.z));
    }
  });
});
