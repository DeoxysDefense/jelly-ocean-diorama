import type { App } from '../core/App';
import { CONFIG } from '../config';
import type { WaterPresetId } from '../config';
import type { PlaceType } from '../world/Reef';
import type { TideMode, TimeMode } from '../core/EnvironmentController';
import { sanitizeBirth, type SavedCreations } from '../features/Creations';
import type { BirthMeta } from '../content/journal';

/**
 * Save / Load World: the user's edits (added sand / islands, object placement) plus the
 * environment. Creatures are re-initialised on load — individual animation frames are not
 * stored. Kept in localStorage so the wallpaper restores the world after a restart.
 */
const KEY = 'jelly-ocean-world-v2';

/**
 * Save schema history:
 *  v2 — sediment grid over x [-30, 30], z [-6, 6] (361 × 61).
 *  v3 — the world is deeper (z [-13, 6]); the grid records its own bounds (`bounds`) and the
 *       sediment is resampled by world coordinates on load, so sand piles, islands and objects
 *       from older saves stay exactly where they were. Adds `extras` (island life, preferences).
 *  v4 — V2 micro-archipelago: x [-51, 51], z [-22.6, 6]. The sand grid keeps v1 spacing (the
 *       x columns and z rows of v1 grids line up exactly), and only the bounding box of cells
 *       that hold sand is stored (`box`), so the bigger world doesn't bloat the save.
 *  v5 — V2 Ocean Journal: `creations` (islands / dunes the user made: where, when, under what
 *       sky) and birth data on placed objects. Older saves get their stamped islands recovered
 *       from the compacted sand layer, named "from before".
 */
export const SAVE_VERSION = 5;

interface SavedWorld {
  version: 2 | 3 | 4 | 5;
  /** v5: My Ocean records. */
  creations?: SavedCreations;
  savedAt: string;
  grid: [number, number];
  /** [xMin, xMax, zBack, zFront] of the sediment grid (v3+). */
  bounds?: [number, number, number, number];
  /** v4: [i0, i1, j0, j1] — `sediment` only holds this inclusive box of the grid (both layers). */
  box?: [number, number, number, number];
  extras?: Record<string, unknown>;
  sediment: string; // base64 Float32Array
  objects: { id: string; x: number; y: number; z: number; rotY: number }[];
  /** User-placed habitat / decor objects (rebuilt from type + seed). */
  placed?: { id: string; type: PlaceType; seed: number; x: number; z: number; rotY: number; bornAt?: number; birth?: BirthMeta; natural?: boolean }[];
  population?: Record<string, number>;
  env: {
    preset: WaterPresetId;
    customColor: string;
    wind: number;
    time?: number;
    timeMode?: TimeMode;
    rain?: number;
    seaLevel?: number;
    tideMode?: TideMode;
  };
}

/** Decodes the sand grid of any supported save version into a full [sed, firm] grid + bounds. */
export function decodeGrid(w: SavedWorld): { raw: Float32Array; onx: number; onz: number; bounds: number[] } | null {
  if (w.version !== 2 && w.version !== 3 && w.version !== 4 && w.version !== 5) return null;
  const [onx, onz] = w.grid;
  if (!(onx > 1 && onz > 1)) return null;
  let raw: Float32Array;
  if (w.version >= 4 && w.box) {
    const [i0, i1, j0, j1] = w.box;
    if (i1 < i0 || j1 < j0) raw = new Float32Array(onx * onz * 2);
    else {
      if (i0 < 0 || j0 < 0 || i1 >= onx || j1 >= onz) return null;
      const data = fromB64(w.sediment);
      if (data.length !== (i1 - i0 + 1) * (j1 - j0 + 1) * 2) return null;
      raw = uncropGrid(data, w.box, onx, onz);
    }
  } else {
    raw = fromB64(w.sediment);
    if (raw.length !== onx * onz && raw.length !== onx * onz * 2) return null;
  }
  const bounds = w.bounds ?? [-30, 30, -6, 6]; // v2 grids always covered z [-6, 6]
  return { raw, onx, onz, bounds };
}

export type { SavedWorld };

function toB64(arr: Float32Array) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64: string) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/**
 * Resamples a saved [sed, firm] grid onto the current terrain grid by world coordinates.
 * Cells outside the old grid get no sand. Identity when the grids match.
 */
export function migrateGrid(raw: Float32Array, onx: number, onz: number, b: number[], nx: number, nz: number): Float32Array {
  const W = CONFIG.world;
  const layers = raw.length >= onx * onz * 2 ? 2 : 1;
  if (onx === nx && onz === nz && b[0] === W.xMin && b[1] === W.xMax && b[2] === W.zBack && b[3] === W.zFront) return raw;
  const out = new Float32Array(nx * nz * 2);
  const odx = (b[1] - b[0]) / (onx - 1),
    odz = (b[3] - b[2]) / (onz - 1);
  for (let L = 0; L < layers; L++) {
    const src = raw.subarray(L * onx * onz, (L + 1) * onx * onz);
    for (let j = 0; j < nz; j++) {
      const z = W.zBack + (j / (nz - 1)) * (W.zFront - W.zBack);
      const fz = (z - b[2]) / odz;
      if (fz < -1e-4 || fz > onz - 1 + 1e-4) continue;
      const j0 = Math.min(onz - 2, Math.max(0, Math.floor(fz))),
        tz = Math.min(1, Math.max(0, fz - j0));
      for (let i = 0; i < nx; i++) {
        const x = W.xMin + (i / (nx - 1)) * (W.xMax - W.xMin);
        const fx = (x - b[0]) / odx;
        if (fx < -1e-4 || fx > onx - 1 + 1e-4) continue;
        const i0 = Math.min(onx - 2, Math.max(0, Math.floor(fx))),
          tx = Math.min(1, Math.max(0, fx - i0));
        const k = j0 * onx + i0;
        const v = (src[k] * (1 - tx) + src[k + 1] * tx) * (1 - tz) + (src[k + onx] * (1 - tx) + src[k + onx + 1] * tx) * tz;
        out[L * nx * nz + j * nx + i] = v;
      }
    }
  }
  return out;
}

/** Crops a [sed, firm] grid to the box of non-zero cells. Returns null when there is no sand. */
export function cropGrid(full: Float32Array, nx: number, nz: number): { box: [number, number, number, number]; data: Float32Array } | null {
  const n = nx * nz;
  let i0 = nx,
    i1 = -1,
    j0 = nz,
    j1 = -1;
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (full[k] !== 0 || full[n + k] !== 0) {
        if (i < i0) i0 = i;
        if (i > i1) i1 = i;
        if (j < j0) j0 = j;
        if (j > j1) j1 = j;
      }
    }
  if (i1 < 0) return null;
  const w = i1 - i0 + 1,
    h = j1 - j0 + 1;
  const data = new Float32Array(w * h * 2);
  for (let L = 0; L < 2; L++)
    for (let j = 0; j < h; j++) data.set(full.subarray(L * n + (j0 + j) * nx + i0, L * n + (j0 + j) * nx + i0 + w), L * w * h + j * w);
  return { box: [i0, i1, j0, j1], data };
}

/** Inverse of cropGrid. */
export function uncropGrid(data: Float32Array, box: number[], nx: number, nz: number): Float32Array {
  const [i0, i1, j0, j1] = box;
  const w = i1 - i0 + 1,
    h = j1 - j0 + 1;
  const n = nx * nz;
  const out = new Float32Array(n * 2);
  for (let L = 0; L < 2; L++)
    for (let j = 0; j < h; j++) out.set(data.subarray(L * w * h + j * w, L * w * h + (j + 1) * w), L * n + (j0 + j) * nx + i0);
  return out;
}

export const WorldStore = {
  serialize(app: App): SavedWorld {
    const nx = app.terrain.nx,
      nz = app.terrain.nz;
    const crop = cropGrid(app.terrain.snapshot(), nx, nz);
    return {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      grid: [nx, nz],
      bounds: [CONFIG.world.xMin, CONFIG.world.xMax, CONFIG.world.zBack, CONFIG.world.zFront],
      extras: app.serializeExtras(),
      creations: app.creations.serialize(),
      box: crop ? crop.box : [0, -1, 0, -1],
      sediment: crop ? toB64(crop.data) : '',
      placed: app.reef.selectables
        .filter((s) => s.user && s.type)
        .map((s) => ({ id: s.id, type: s.type!, seed: s.seed ?? 1, x: s.object.position.x, z: s.object.position.z, rotY: s.object.rotation.y, ...(s.bornAt ? { bornAt: s.bornAt } : {}), ...(s.birth ? { birth: s.birth } : {}), ...(s.natural ? { natural: true } : {}) })),
      population: { ...app.creatures.population },
      objects: app.reef.selectables.filter((s) => !s.user).map((s) => ({
        id: s.id,
        x: s.object.position.x,
        y: s.object.position.y,
        z: s.object.position.z,
        rotY: s.object.rotation.y,
      })),
      env: {
        preset: app.env.preset,
        customColor: app.env.customColor,
        wind: app.env.windTarget,
        time: app.env.timeOfDay,
        timeMode: app.env.timeMode,
        rain: app.env.rainTarget,
        seaLevel: app.env.seaLevelTarget,
        tideMode: app.env.tideMode,
      },
    };
  },

  apply(app: App, w: SavedWorld): boolean {
    const grid = decodeGrid(w);
    if (!grid) return false;
    app.terrain.restore(migrateGrid(grid.raw, grid.onx, grid.onz, grid.bounds, app.terrain.nx, app.terrain.nz));
    app.reef.resetPositions(); // drops user objects, restores the original set
    const savedAt = Date.parse(w.savedAt) || 0;
    for (const p of w.placed ?? []) {
      const sel = app.reef.createObject(p.type, p.x, p.z, p.seed, p.rotY, p.id);
      sel.placedAt = 0;
      sel.bornAt = Number.isFinite(p.bornAt) ? p.bornAt : savedAt;
      sel.birth = p.birth ? sanitizeBirth(p.birth) : { h: 12, rain: 0, wind: 0, night: 0, old: true };
      // v1–v4 saves don't know who left a shell; a shell without birth data from an old save is
      // most likely a hermit crab's, so it is treated as natural
      if (p.natural || (p.type === 'shell' && !p.birth)) sel.natural = true;
    }
    // My Ocean records (older saves: recover the stamped islands from the compacted sand)
    if (w.version >= 5) app.creations.apply(w.creations);
    else {
      app.creations.clear();
      app.creations.recoverIslands(savedAt);
    }
    if (w.population) for (const [k, v] of Object.entries(w.population)) app.creatures.setPopulation(k, v);
    const e = w.env;
    if (typeof e.time === 'number') app.env.setTime(e.time);
    if (e.timeMode) app.env.setTimeMode(e.timeMode);
    if (typeof e.rain === 'number') app.env.setRain(e.rain);
    if (typeof e.seaLevel === 'number') app.env.setSeaLevel(e.seaLevel);
    if (e.tideMode) app.env.setTideMode(e.tideMode);
    for (const o of w.objects) {
      const s = app.reef.selectables.find((q) => q.id === o.id);
      if (s) {
        s.object.position.set(o.x, o.y, o.z);
        s.object.rotation.y = o.rotY;
      }
    }
    app.env.customColor = w.env.customColor;
    app.env.setPreset(w.env.preset);
    app.env.setWind(w.env.wind);
    if (w.extras) app.applyExtras(w.extras);
    return true;
  },

  save(app: App): boolean {
    try {
      localStorage.setItem(KEY, JSON.stringify(WorldStore.serialize(app)));
      return true;
    } catch {
      return false;
    }
  },

  load(app: App): boolean {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      return WorldStore.apply(app, JSON.parse(raw) as SavedWorld);
    } catch {
      return false;
    }
  },

  savedAt(): string | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as SavedWorld).savedAt : null;
    } catch {
      return null;
    }
  },

  /** Downloads the world as a JSON file (portable between machines). */
  exportFile(app: App) {
    const blob = new Blob([JSON.stringify(WorldStore.serialize(app))], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jelly-ocean-world-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },

  async importFile(app: App, file: File): Promise<boolean> {
    try {
      return WorldStore.apply(app, JSON.parse(await file.text()) as SavedWorld);
    } catch {
      return false;
    }
  },
};
