
import { creationName, regionOf, type BirthMeta, type RegionId } from '../content/journal';
import type { Lang } from './Prefs';
import type { TerrainSystem } from '../world/TerrainSystem';
import type { Reef, Selectable } from '../world/Reef';

/**
 * V2 (P2) "My Ocean" — what the user made here.
 *
 * Not an event log: the list is derived from the *current* world every time it is shown.
 * Islands and sand dunes are small records (where, when, under what sky); a record only counts
 * while its sand is still there, so Undo / Redo / Erase / Reset / Load are always consistent
 * without any bookkeeping. Placed objects carry their own birth data on the Selectable.
 */
export interface LandRecord {
  id: string;
  kind: 'island' | 'dune';
  x: number;
  z: number;
  r: number;
  bornAt: number;
  birth: BirthMeta;
}

export interface CreationItem {
  id: string;
  kind: string;
  bornAt: number;
  name: string;
  custom: boolean;
  region: RegionId;
  /** Rename handler. */
  rename(name: string): void;
}

export interface SavedCreations {
  land: LandRecord[];
}

export class Creations {
  land: LandRecord[] = [];
  private seq = 1;
  /** Supplies the conditions right now (time of day, rain, wind, night). */
  conditions: () => BirthMeta = () => ({ h: 12, rain: 0, wind: 0, night: 0 });
  now: () => number = () => Date.now();

  /** User-given names by creation id (kept in the journal's own storage, so a rename sticks). */
  names: Record<string, string> = {};
  onRename: () => void = () => {};

  constructor(private terrain: TerrainSystem, private reef: Reef) {}

  private renamer(id: string) {
    return (n: string) => {
      const c = clean(n);
      if (c) this.names[id] = c;
      else delete this.names[id];
      this.onRename();
    };
  }

  /** Is the land of this record still there? */
  alive(r: LandRecord) {
    const s = this.terrain.sedimentAt(r.x, r.z);
    return r.kind === 'island' ? s > 0.3 : s > 0.06;
  }

  /**
   * Call *before* stamping: records here whose land is gone (undone / erased) are forgotten, so
   * the coming island is a new one rather than an old one "growing back".
   */
  pruneAt(x: number, z: number, radius: number) {
    for (let i = this.land.length - 1; i >= 0; i--) {
      const r = this.land[i];
      if (Math.hypot(r.x - x, r.z - z) < Math.max(r.r, radius) && !this.alive(r)) this.land.splice(i, 1);
    }
  }

  /** A sand island was stamped. Overlapping a living island = it grew; otherwise a new one. */
  addIsland(x: number, z: number, radius: number) {
    for (const r of this.land) {
      if (r.kind !== 'island' || Math.hypot(r.x - x, r.z - z) > Math.max(r.r, radius) * 0.9 || !this.alive(r)) continue;
      // the same island grew: keep its birthday, nudge its centre
      r.x = (r.x + x) / 2;
      r.z = (r.z + z) / 2;
      r.r = Math.max(r.r, radius);
      return r;
    }
    return this.push('island', x, z, radius);
  }

  /** An Add-sand stroke ended around (x, z). Piles near an existing dune / island just grow it. */
  addDune(x: number, z: number, extent: number) {
    if (this.terrain.sedimentAt(x, z) < 0.06) return null;
    for (const r of this.land) if (this.alive(r) && Math.hypot(r.x - x, r.z - z) < Math.max(r.r, 2.2)) return r;
    for (const r of this.land) if (!this.alive(r) && Math.hypot(r.x - x, r.z - z) < 2.2) this.land.splice(this.land.indexOf(r), 1);
    return this.push('dune', x, z, Math.max(1, extent));
  }

  private push(kind: LandRecord['kind'], x: number, z: number, r: number) {
    const rec: LandRecord = { id: `${kind}-${this.now().toString(36)}-${this.seq++}`, kind, x, z, r, bornAt: this.now(), birth: this.conditions() };
    this.land.push(rec);
    return rec;
  }

  /** Birth data for a newly placed object. */
  stamp(sel: Selectable) {
    sel.bornAt = this.now();
    sel.birth = this.conditions();
  }

  /** Everything the user made that still exists, newest first. */
  list(lang: Lang): CreationItem[] {
    const out: CreationItem[] = [];
    for (const r of this.land) {
      if (!this.alive(r)) continue;
      out.push({
        id: r.id,
        kind: r.kind,
        bornAt: r.bornAt,
        name: this.names[r.id] ?? creationName(r.kind, r.birth, lang),
        custom: !!this.names[r.id],
        region: regionOf(r.x, r.z),
        rename: this.renamer(r.id),
      });
    }
    for (const s of this.reef.selectables) {
      if (!s.user || !s.type || s.natural) continue;
      const birth = s.birth ?? { h: 12, rain: 0, wind: 0, night: 0, old: true };
      out.push({
        id: s.id,
        kind: s.type,
        bornAt: s.bornAt ?? 0,
        name: this.names[s.id] ?? creationName(s.type, birth, lang),
        custom: !!this.names[s.id],
        region: regionOf(s.object.position.x, s.object.position.z),
        rename: this.renamer(s.id),
      });
    }
    return out.sort((a, b) => b.bornAt - a.bornAt);
  }

  clear() {
    this.land.length = 0;
  }

  serialize(): SavedCreations {
    return { land: this.land.filter((r) => this.alive(r)).map((r) => ({ ...r, birth: { ...r.birth } })) };
  }

  apply(s: SavedCreations | undefined) {
    this.land.length = 0;
    if (!s || !Array.isArray(s.land)) return;
    for (const r of s.land) {
      if (!r || (r.kind !== 'island' && r.kind !== 'dune') || !Number.isFinite(r.x) || !Number.isFinite(r.z)) continue;
      this.land.push({
        id: String(r.id ?? `${r.kind}-${this.seq++}`),
        kind: r.kind,
        x: r.x,
        z: r.z,
        r: Number.isFinite(r.r) ? r.r : 2,
        bornAt: Number.isFinite(r.bornAt) ? r.bornAt : 0,
        birth: sanitizeBirth(r.birth),
      });
    }
  }

  /**
   * Older saves (before the journal) have stamped islands only as compacted sand. Find them in
   * the firm sand layer so they appear in My Ocean too (named "from before").
   */
  recoverIslands(bornAt: number) {
    const t = this.terrain;
    const step = 4;
    const seen = new Uint8Array(t.nx * t.nz);
    const firmAt = (i: number, j: number) => t.firm[j * t.nx + i];
    for (let j = 0; j < t.nz; j += step)
      for (let i = 0; i < t.nx; i += step) {
        if (seen[j * t.nx + i] || firmAt(i, j) < 0.4) continue;
        // flood fill on the coarse grid
        let sx = 0,
          sz = 0,
          n = 0,
          maxD = 0;
        const stack = [[i, j]];
        seen[j * t.nx + i] = 1;
        const cells: [number, number][] = [];
        while (stack.length) {
          const [ci, cj] = stack.pop()!;
          cells.push([ci, cj]);
          sx += t.x0 + ci * t.dx;
          sz += t.z0 + cj * t.dz;
          n++;
          for (const [di, dj] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
            const ni = ci + di,
              nj = cj + dj;
            if (ni < 0 || nj < 0 || ni >= t.nx || nj >= t.nz || seen[nj * t.nx + ni] || firmAt(ni, nj) < 0.4) continue;
            seen[nj * t.nx + ni] = 1;
            stack.push([ni, nj]);
          }
        }
        if (n < 3) continue;
        const cx = sx / n,
          cz = sz / n;
        for (const [ci, cj] of cells) maxD = Math.max(maxD, Math.hypot(t.x0 + ci * t.dx - cx, t.z0 + cj * t.dz - cz));
        if (this.land.some((r) => Math.hypot(r.x - cx, r.z - cz) < 1.5)) continue;
        this.land.push({ id: `island-old-${this.seq++}`, kind: 'island', x: cx, z: cz, r: Math.max(1.5, maxD), bornAt, birth: { h: 12, rain: 0, wind: 0, night: 0, old: true } });
      }
  }
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 40);

export function sanitizeBirth(b: unknown): BirthMeta {
  const o = (b && typeof b === 'object' ? b : {}) as Partial<BirthMeta>;
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return { h: n(o.h, 12), rain: n(o.rain, 0), wind: n(o.wind, 0), night: n(o.night, 0), ...(o.old ? { old: true } : {}) };
}


