import * as THREE from 'three';
import { CONFIG } from '../config';
import { rand } from '../util/math';
import type { App } from '../core/App';
import { makeVisitor, type Visitor, type VisitorId } from '../creatures/Visitors';
import { pumpTextures } from '../creatures/visitorModels';
import { ARCHI } from '../world/Archipelago';

export type VisitorMode = 'off' | 'few' | 'normal';

/**
 * V2 (P3) rare visitors — scheduling, "you were away" memories and traces.
 *
 * Time counts only while the ocean is actually running (hidden page / paused wallpaper don't
 * count), like Ocean Mail. Each visitor has a mean interval and preferred conditions, so visits
 * are predictable rather than random ("turtles like the late afternoon"). At most one visitor at
 * a time and at least 20 minutes between visits. "Few" halves every rate.
 */
export interface VisitorDef {
  id: VisitorId;
  /** Mean interval in minutes of active time. */
  mean: number;
  /** Stay [min, max] in minutes. */
  stay: [number, number];
  /** Multiplier for the current conditions (0 = not now). */
  when: (c: Conditions) => number;
  /** Trace left behind when nobody saw the visit. */
  trace?: TraceKind;
}

export interface Conditions {
  hour: number;
  night: number;
  wind: number;
  /** Strong wind within the last half hour of active time. */
  afterWind: boolean;
  /** 0 new moon … 1 full moon (from the real date). */
  moon: number;
}

export type TraceKind = 'turtleTracks' | 'cuttlebone';
export interface Trace {
  k: TraceKind;
  x: number;
  z: number;
  rot: number;
  /** Real time (ms) when it has faded completely. */
  until: number;
}

export const VISITORS: VisitorDef[] = [
  { id: 'turtle', mean: 75, stay: [5, 8], when: (c) => (c.hour >= 16 && c.hour < 19 ? 2 : 1), trace: 'turtleTracks' },
  { id: 'manta', mean: 150, stay: [4, 6], when: (c) => (c.night > 0.5 ? 1 + 0.8 * c.moon : 0) },
  { id: 'dolphin', mean: 180, stay: [2, 3], when: (c) => (c.night < 0.3 ? (c.afterWind ? 2.5 : 0.5) : 0) },
  { id: 'whaleShark', mean: 420, stay: [3, 3.5], when: () => 1 },
  { id: 'seahorse', mean: 120, stay: [20, 40], when: (c) => (c.night < 0.3 ? 1 : 0) },
  { id: 'cuttlefish', mean: 120, stay: [4, 6], when: (c) => (c.hour >= 17 && c.hour < 20 ? 2.5 : 0.3), trace: 'cuttlebone' },
  { id: 'moray', mean: 120, stay: [8, 12], when: () => 1 },
  { id: 'flyingFish', mean: 90, stay: [1, 1.3], when: (c) => (c.wind > 0.5 ? 1.5 : 0) },
];
/** Minimum active time between two visits (seconds). */
export const VISIT_GAP = 20 * 60;
/** Traces fade over a few real hours. */
const TRACE_LIFE = 3.5 * 3600_000;

/** Moon fullness from the real date (0 new … 1 full), synodic month from a known new moon. */
export function moonFullness(ms: number) {
  const synodic = 29.530588853;
  const days = (ms - Date.UTC(2000, 0, 6, 18, 14)) / 86_400_000;
  const phase = (((days / synodic) % 1) + 1) % 1;
  return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
}

/** Probability per second of a visit starting under the given conditions. */
export function visitRate(c: Conditions, mode: VisitorMode) {
  if (mode === 'off') return [] as { def: VisitorDef; rate: number }[];
  const k = mode === 'few' ? 0.5 : 1;
  return VISITORS.map((def) => ({ def, rate: (def.when(c) * k) / (def.mean * 60) }));
}

export class RareVisitors {
  readonly group = new THREE.Group();
  private pool = new Map<VisitorId, Visitor>();
  current: Visitor | null = null;
  private def: VisitorDef | null = null;
  private stayLeft = 0;
  private startHour = 0;
  private seen = false;
  private windT = 1e9;
  private traceGroup = new THREE.Group();
  private traceMeshes: { tr: Trace; obj: THREE.Object3D; mats: THREE.Material[] }[] = [];
  private traceT = 0;

  constructor(private app: App) {
    this.group.add(this.traceGroup);
    // rebuild traces that are still fading from an earlier session
    for (const tr of this.traces) this.buildTrace(tr);
  }

  private get prefs() {
    return this.app.prefs.data.visitors;
  }
  private get traces(): Trace[] {
    return this.app.memory.data.traces;
  }

  conditions(): Conditions {
    const env = this.app.env;
    return { hour: env.timeOfDay, night: env.atm.night, wind: env.wind, afterWind: this.windT < 1800, moon: moonFullness(Date.now()) };
  }

  setMode(m: VisitorMode) {
    this.prefs.mode = m;
    if (m === 'off') this.stop();
    this.app.prefs.changed();
  }

  /** Starts a visitor now (debugging / tests): `__jelly.visitors.trigger('turtle')`. */
  trigger(id: VisitorId) {
    this.stop();
    const def = VISITORS.find((d) => d.id === id);
    return def ? this.start(def) : false;
  }

  /** Ends the current visit silently (Reset World / visitors switched off). */
  stop() {
    if (this.current) {
      this.current.group.visible = false;
      this.group.remove(this.current.group);
    }
    this.current = null;
    this.def = null;
  }

  private visitorFor(id: VisitorId) {
    let v = this.pool.get(id);
    if (!v) {
      v = makeVisitor(id, this.app);
      this.pool.set(id, v);
    }
    return v;
  }

  private start(def: VisitorDef) {
    const v = this.visitorFor(def.id);
    if (!v.begin()) return false;
    this.current = v;
    this.def = def;
    this.stayLeft = rand(def.stay[0], def.stay[1]) * 60;
    this.startHour = this.app.env.timeOfDay;
    this.seen = false;
    this.group.add(v.group);
    v.group.visible = false; // shown by its first update (once its textures are painted)
    return true;
  }

  /** Someone watched the current visitor (hover ≈ 1 s or a click). */
  noticed(key: string) {
    if (this.current && this.current.id === key) this.seen = true;
  }

  /** Raycast for hover / click (current visitor, then a passing fusilier school). */
  pick(rc: THREE.Raycaster): { key: string; label: string; point: THREE.Vector3; poke: () => void; notice?: () => void } | null {
    const v = this.current;
    if (v) {
      const p = v.pick(rc);
      if (p) return { key: v.id, label: v.label, point: p, poke: () => v.poke(p), notice: () => v.notice(p) };
    }
    const s = this.app.events.pickSchool(rc);
    if (s) return { key: 'fusilier', label: 'Fusiliers · a visiting school', point: s, poke: () => {} };
    return null;
  }

  /** Spheres the residents keep away from. */
  obstacles() {
    const v = this.current;
    return v && v.group.visible ? [{ center: v.pos, radius: v.radius }] : [];
  }

  update(dt: number, time: number) {
    const app = this.app;
    this.windT = app.env.wind > 0.6 ? 0 : this.windT + dt;
    this.updateTraces(dt);
    if (this.current) {
      // a visitor's textures are painted over a few frames first; it waits out of sight
      if (!pumpTextures(3)) {
        this.current.group.visible = false;
        return;
      }
      this.stayLeft -= dt;
      if (this.stayLeft <= 0 && !this.current.leaving) this.current.leave();
      if (!this.current.update(dt, time)) this.finish();
      return;
    }
    const P = this.prefs;
    if (P.mode === 'off') return;
    if (P.wait > 0) {
      P.wait -= dt;
      this.saveSoon(dt);
      return;
    }
    if (app.busy) return;
    // Poisson arrivals, weighted by each visitor's liking for the moment
    const rates = visitRate(this.conditions(), P.mode);
    const total = rates.reduce((a, r) => a + r.rate, 0);
    if (Math.random() >= total * dt) return;
    let r = Math.random() * total;
    for (const { def, rate } of rates) {
      if ((r -= rate) > 0) continue;
      if (this.start(def)) P.wait = VISIT_GAP;
      break;
    }
  }

  private saveT = 0;
  private saveSoon(dt: number) {
    this.saveT -= dt;
    if (this.saveT <= 0) {
      this.saveT = 30;
      this.app.prefs.changed(false);
    }
  }

  private finish() {
    const v = this.current!;
    const def = this.def!;
    this.group.remove(v.group);
    this.current = null;
    this.def = null;
    this.prefs.wait = VISIT_GAP;
    this.app.prefs.changed(false);
    // the sea remembers every visit; one nobody saw leaves a little trace behind
    let trace: TraceKind | undefined;
    if (!this.seen && def.trace) trace = this.addTrace(def.trace) ? def.trace : undefined;
    this.app.memory.log('visitor', { id: def.id, seen: this.seen, ...(trace ? { trace } : {}) }, { hour: this.startHour });
  }

  // ---------------------------------------------------------------- traces
  /** A beach point near the waterline (sand cay, else the main island). */
  private beachPoint() {
    const T = this.app.terrain;
    const level = this.app.sim.level;
    const centres = [
      [ARCHI.cay.x, ARCHI.cay.z],
      [CONFIG.island.x, CONFIG.island.z],
    ];
    for (let k = 0; k < 12; k++) {
      const [cx, cz] = centres[k < 8 ? 0 : 1];
      const a = rand(-Math.PI * 0.9, -Math.PI * 0.1) + (Math.random() < 0.5 ? 0 : Math.PI); // front or back shore
      let r = 0.5;
      while (r < 9 && T.heightAt(cx + Math.cos(a) * r, cz + Math.sin(a) * r) > level + 0.12) r += 0.15;
      if (r >= 9 || r < 1) continue;
      return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, inward: a + Math.PI, cx, cz };
    }
    return null;
  }

  private addTrace(k: TraceKind) {
    const b = this.beachPoint();
    if (!b) return false;
    const tr: Trace = { k, x: b.x, z: b.z, rot: b.inward, until: Date.now() + TRACE_LIFE };
    this.traces.push(tr);
    this.app.memory.changed();
    this.buildTrace(tr);
    return true;
  }

  private buildTrace(tr: Trace) {
    const T = this.app.terrain;
    const mats: THREE.Material[] = [];
    let obj: THREE.Object3D;
    if (tr.k === 'turtleTracks') {
      // two rows of flipper scoops with a shallow drag line, from the waterline up the beach
      const g = new THREE.Group();
      const mark = new THREE.CircleGeometry(0.07, 10).rotateX(-Math.PI / 2).scale(1.6, 1, 0.7);
      const m = new THREE.MeshStandardMaterial({ color: 0x9a8058, roughness: 1, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      mats.push(m);
      const dir = new THREE.Vector2(Math.cos(tr.rot), Math.sin(tr.rot));
      for (let i = 0; i < 9; i++) {
        const d = i * 0.2;
        for (const s of [1, -1]) {
          const x = tr.x + dir.x * d - dir.y * s * 0.22,
            z = tr.z + dir.y * d + dir.x * s * 0.22;
          const p = new THREE.Mesh(mark, m);
          p.position.set(x, T.heightAt(x, z) + 0.012, z);
          p.rotation.y = -tr.rot + s * 0.5;
          g.add(p);
        }
      }
      obj = g;
    } else {
      const geo = new THREE.SphereGeometry(0.12, 14, 8).scale(1.6, 0.18, 0.75);
      const m = new THREE.MeshStandardMaterial({ color: 0xf2eee2, roughness: 0.6, transparent: true, opacity: 1 });
      mats.push(m);
      const mesh = new THREE.Mesh(geo, m);
      const x = tr.x + Math.cos(tr.rot) * 0.4,
        z = tr.z + Math.sin(tr.rot) * 0.4;
      mesh.position.set(x, T.heightAt(x, z) + 0.01, z);
      mesh.rotation.y = tr.rot + 0.7;
      mesh.castShadow = true;
      obj = mesh;
    }
    this.traceGroup.add(obj);
    this.traceMeshes.push({ tr, obj, mats });
  }

  private updateTraces(dt: number) {
    this.traceT -= dt;
    if (this.traceT > 0) return;
    this.traceT = 5;
    const now = Date.now();
    for (let i = this.traceMeshes.length - 1; i >= 0; i--) {
      const t = this.traceMeshes[i];
      const left = t.tr.until - now;
      const k = Math.max(0, Math.min(1, left / (40 * 60_000)));
      for (const m of t.mats) (m as THREE.MeshStandardMaterial).opacity = (t.tr.k === 'turtleTracks' ? 0.75 : 1) * k;
      if (left <= 0) {
        this.traceGroup.remove(t.obj);
        t.obj.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
        for (const m of t.mats) m.dispose();
        this.traceMeshes.splice(i, 1);
        const idx = this.traces.indexOf(t.tr);
        if (idx >= 0) this.traces.splice(idx, 1);
        this.app.memory.changed();
      }
    }
  }

  /** Reset World: the beach is swept clean. */
  clearTraces() {
    for (const t of this.traceMeshes) {
      this.traceGroup.remove(t.obj);
      for (const m of t.mats) m.dispose();
    }
    this.traceMeshes.length = 0;
    this.traces.length = 0;
    this.app.memory.changed();
  }
}
