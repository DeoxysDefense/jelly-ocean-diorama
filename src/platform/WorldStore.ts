import type { App } from '../core/App';
import { CONFIG } from '../config';
import type { WaterPresetId } from '../config';
import type { PlaceType } from '../world/Reef';
import type { TideMode, TimeMode } from '../core/EnvironmentController';

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
 */
interface SavedWorld {
  version: 2 | 3;
  savedAt: string;
  grid: [number, number];
  /** [xMin, xMax, zBack, zFront] of the sediment grid (v3+). */
  bounds?: [number, number, number, number];
  extras?: Record<string, unknown>;
  sediment: string; // base64 Float32Array
  objects: { id: string; x: number; y: number; z: number; rotY: number }[];
  /** User-placed habitat / decor objects (rebuilt from type + seed). */
  placed?: { id: string; type: PlaceType; seed: number; x: number; z: number; rotY: number }[];
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

export const WorldStore = {
  serialize(app: App): SavedWorld {
    return {
      version: 3,
      savedAt: new Date().toISOString(),
      grid: [app.terrain.nx, app.terrain.nz],
      bounds: [CONFIG.world.xMin, CONFIG.world.xMax, CONFIG.world.zBack, CONFIG.world.zFront],
      extras: app.serializeExtras(),
      sediment: toB64(app.terrain.snapshot()),
      placed: app.reef.selectables
        .filter((s) => s.user && s.type)
        .map((s) => ({ id: s.id, type: s.type!, seed: s.seed ?? 1, x: s.object.position.x, z: s.object.position.z, rotY: s.object.rotation.y })),
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
    if (w.version !== 2 && w.version !== 3) return false;
    const raw = fromB64(w.sediment);
    const [onx, onz] = w.grid;
    if (raw.length !== onx * onz && raw.length !== onx * onz * 2) return false;
    const bounds = w.bounds ?? [-30, 30, -6, 6]; // v2 grids always covered z [-6, 6]
    app.terrain.restore(migrateGrid(raw, onx, onz, bounds, app.terrain.nx, app.terrain.nz));
    app.reef.resetPositions(); // drops user objects, restores the original set
    for (const p of w.placed ?? []) {
      const sel = app.reef.createObject(p.type, p.x, p.z, p.seed, p.rotY, p.id);
      sel.placedAt = 0;
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
