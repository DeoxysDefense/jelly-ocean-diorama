import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp, rand } from '../util/math';
import type { App } from '../core/App';
import * as F from '../world/coralFactory';
import { Reef } from '../world/Reef';
import { deadFrond } from '../world/Island';
import { buildFish, type FishSpec } from '../creatures/fishSpecies';
import { makeFishMaterial } from '../creatures/FishSystem';
import type { Crab } from '../creatures/Crab';
import { dryness } from '../creatures/shoreline';
import { EVENT_INTERVAL, Prefs } from './Prefs';
import { disposeTree, floatStep, type FloatBody } from './fx';

/**
 * One small, self-contained moment in the ocean. Every event owns its temporary objects and
 * must remove them in cleanup(); nothing it creates is permanent or saved.
 */
interface OceanEvent {
  readonly id: EventId;
  readonly weight: number;
  eligible(): boolean;
  start(): void;
  /** Returns false when the event has finished. */
  update(dt: number, time: number): boolean;
  cleanup(): void;
}

export type EventId = 'starfish' | 'school' | 'crabShell' | 'palmLeaf' | 'shellAshore';
export const EVENT_IDS: EventId[] = ['starfish', 'school', 'crabShell', 'palmLeaf', 'shellAshore'];

/**
 * Ocean Surprises: very occasionally something small happens on its own — a starfish surfaces
 * from the sand, a visiting school passes through, a crab carries a shell, a palm drops a dry
 * frond, a shell washes up near the island. No popups, no sounds, at most one at a time.
 * Driven by active simulation time (paused while hidden), postponed during mini games / edits.
 */
export class OceanEventManager {
  readonly group = new THREE.Group();
  private events: Record<EventId, OceanEvent>;
  private running: OceanEvent | null = null;

  /** P3: the visiting fusilier school can be observed (hover / click). */
  pickSchool(rc: THREE.Raycaster): THREE.Vector3 | null {
    const e = this.running as unknown as { id: string; pick?: (rc: THREE.Raycaster) => THREE.Vector3 | null } | null;
    return e && e.id === 'school' && e.pick ? e.pick(rc) : null;
  }
  private saveT = 0;

  constructor(private app: App, private prefs: Prefs) {
    app.reef.shellMaterial.userData.keep = true;
    this.events = {
      starfish: new StarfishEvent(app, this.group),
      school: new VisitingSchoolEvent(app, this.group),
      crabShell: new CrabShellEvent(app, this.group),
      palmLeaf: new PalmLeafEvent(app, this.group),
      shellAshore: new ShellAshoreEvent(app, this.group),
    };
  }

  get current(): EventId | null {
    return this.running?.id ?? null;
  }

  reschedule() {
    this.prefs.data.events.nextIn = Prefs.randIn(EVENT_INTERVAL[this.prefs.data.events.freq]);
    this.prefs.changed(false);
  }

  /** Starts a specific event now (testing / debugging). Returns false if not eligible. */
  trigger(id: EventId): boolean {
    const e = this.events[id];
    if (!e || !e.eligible()) return false;
    this.stop();
    this.begin(e);
    return true;
  }

  private begin(e: OceanEvent) {
    this.running = e;
    this.prefs.data.events.last = e.id;
    this.app.memory?.log('event', { id: e.id });
    e.start();
  }

  /** Weighted random pick among eligible events, never the same type twice in a row. */
  private choose(): OceanEvent | null {
    const last = this.prefs.data.events.last;
    const pool = EVENT_IDS.map((id) => this.events[id]).filter((e) => e.id !== last && e.eligible());
    const total = pool.reduce((a, e) => a + e.weight, 0);
    let r = Math.random() * total;
    for (const e of pool) {
      if (r < e.weight) return e;
      r -= e.weight;
    }
    return pool[0] ?? null;
  }

  update(dt: number, time: number, busy: boolean) {
    const ev = this.prefs.data.events;
    if (this.running) {
      if (!this.running.update(dt, time)) this.stop();
    } else if (ev.on && !busy) {
      ev.nextIn -= dt;
      if (ev.nextIn <= 0) {
        const e = this.choose();
        if (e) this.begin(e);
        this.reschedule();
      }
    }
    this.saveT -= dt;
    if (this.saveT <= 0) {
      this.saveT = 30;
      this.prefs.changed(false);
    }
  }

  stop() {
    if (!this.running) return;
    this.running.cleanup();
    this.running = null;
  }
}

// ======================================================================== helpers
function visibleFront(app: App, margin = 3) {
  const v = app.cam.visibleX(margin);
  return { xMin: Math.max(v.min, CONFIG.world.xMin + 3), xMax: Math.min(v.max, CONFIG.world.xMax - 3) };
}

/** A random wet, open seabed spot in view (away from obstacles). */
function openSeabedSpot(app: App, zMin: number, zMax: number, minDepth = 1.2): THREE.Vector3 | null {
  const { xMin, xMax } = visibleFront(app);
  for (let i = 0; i < 40; i++) {
    const x = rand(xMin, xMax),
      z = rand(zMin, zMax);
    const g = app.terrain.heightAt(x, z);
    if (app.sim.level - g < minDepth) continue;
    if (app.reef.obstacles().some((o) => Math.hypot(o.center.x - x, o.center.z - z) < o.radius + 0.5)) continue;
    return new THREE.Vector3(x, g, z);
  }
  return null;
}

// ======================================================================== A. starfish
class StarfishEvent implements OceanEvent {
  readonly id = 'starfish' as const;
  readonly weight = 1;
  private mesh: THREE.Mesh | null = null;
  private t = 0;
  private stay = 0;
  private spot = new THREE.Vector3();
  constructor(private app: App, private group: THREE.Group) {}
  eligible() {
    return openSeabedSpot(this.app, 0.5, 4.6) !== null;
  }
  start() {
    const p = openSeabedSpot(this.app, 0.5, 4.6)!;
    this.spot.copy(p);
    const hues = [0xe0602e, 0xd84a6a, 0xe89a3a, 0x9a4ad0];
    this.mesh = new THREE.Mesh(F.starfish(hues[Math.floor(Math.random() * hues.length)], rand(0.8, 1.05)), this.app.reef.shellMaterial);
    this.mesh.castShadow = true;
    this.mesh.scale.setScalar(1.55);
    this.mesh.rotation.y = rand(0, 6);
    this.mesh.position.set(p.x, p.y - 0.16, p.z);
    this.group.add(this.mesh);
    this.t = 0;
    this.stay = rand(70, 110);
  }
  update(dt: number, time: number) {
    const m = this.mesh!;
    this.t += dt;
    const app = this.app;
    const ground = app.terrain.heightAt(this.spot.x, this.spot.z);
    const rise = 6,
      total = rise * 2 + this.stay;
    // emerge, rest (barely moving, as starfish do), then dig back in
    const k = this.t < rise ? this.t / rise : this.t > total - rise ? Math.max(0, (total - this.t) / rise) : 1;
    m.position.y = ground - 0.16 + 0.15 * smooth(k);
    m.rotation.x = Math.sin(time * 0.3) * 0.02;
    m.rotation.y += dt * 0.008;
    if ((this.t < rise || this.t > total - rise) && Math.random() < dt * 3) app.sediment.emitDust(this.spot.x + rand(-0.2, 0.2), ground, this.spot.z + rand(-0.2, 0.2), 1, 0.25);
    return this.t < total;
  }
  cleanup() {
    if (!this.mesh) return;
    this.group.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
}
const smooth = (k: number) => k * k * (3 - 2 * k);

// ======================================================================== B. visiting school
const VISITOR: FishSpec = {
  id: 'fusilier',
  label: 'Fusilier',
  iris: '#e8e0c0',
  iridescence: 0.5,
  segments: [16, 10],
  size: 0.42,
  height: 0.12,
  width: 0.07,
  peakT: 0.38,
  peduncle: 0.28,
  sag: 0,
  tail: { shape: 'fork', len: 0.32, span: 0.15 },
  dorsal: { t0: 0.3, t1: 0.66, h: 0.05 },
  anal: { t0: 0.6, t1: 0.78, h: 0.04 },
  pectoral: { t: 0.24, len: 0.12 },
  roughness: 0.35,
  metalness: 0.35,
  finColor: 'rgba(250,215,90,1)',
  paint(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2a62b8');
    g.addColorStop(0.42, '#4f8fe0');
    g.addColorStop(0.5, '#ffd84a');
    g.addColorStop(0.58, '#a8c8f0');
    g.addColorStop(1, '#f2f6fa');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // yellow tail half
    const t = ctx.createLinearGradient(W * 0.55, 0, W, 0);
    t.addColorStop(0, 'rgba(255,214,70,0)');
    t.addColorStop(1, 'rgba(255,214,70,0.9)');
    ctx.fillStyle = t;
    ctx.fillRect(0, 0, W, H);
  },
};

class VisitingSchoolEvent implements OceanEvent {
  readonly id = 'school' as const;
  readonly weight = 1.2;
  pick(rc: THREE.Raycaster): THREE.Vector3 | null {
    if (!this.mesh) return null;
    const h = rc.intersectObject(this.mesh, false)[0];
    return h ? h.point.clone() : null;
  }
  private mesh: THREE.InstancedMesh | null = null;
  private eyes: THREE.InstancedMesh | null = null;
  private swim: THREE.InstancedBufferAttribute | null = null;
  private n = 16;
  private fish: { off: THREE.Vector3; pos: THREE.Vector3; vel: THREE.Vector3; phase: number }[] = [];
  private lead = new THREE.Vector3();
  private leadVel = new THREE.Vector3();
  private dir = 1;
  private t = 0;
  private linger = 0;
  private stage: 'in' | 'mill' | 'out' = 'in';
  private mill = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  constructor(private app: App, private group: THREE.Group) {}
  eligible() {
    return true;
  }
  start() {
    const { geometry, texture, normalMap, eyeGeometry, eyeTexture } = buildFish(VISITOR);
    const arr = new Float32Array(this.n * 4);
    this.swim = new THREE.InstancedBufferAttribute(arr, 4);
    this.swim.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aSwim', this.swim);
    eyeGeometry.setAttribute('aSwim', this.swim);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    this.mesh = new THREE.InstancedMesh(geometry, makeFishMaterial(texture, VISITOR, bb.max.x, bb.max.x - bb.min.x, normalMap), this.n);
    this.eyes = new THREE.InstancedMesh(eyeGeometry, makeFishMaterial(eyeTexture, VISITOR, bb.max.x, bb.max.x - bb.min.x, null, true), this.n);
    this.eyes.instanceMatrix = this.mesh.instanceMatrix;
    for (const m of [this.mesh, this.eyes]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.mesh.castShadow = true;
    this.group.add(this.mesh, this.eyes);
    const vis = this.app.cam.visibleX(0);
    this.dir = Math.random() < 0.5 ? 1 : -1;
    const z = rand(-8, 3);
    this.lead.set(this.dir > 0 ? vis.min - 3 : vis.max + 3, rand(-3.6, -2.2), z);
    this.leadVel.set(this.dir * 1.3, 0, 0);
    this.mill.set(rand(0, 12), rand(-3.6, -2.4), z + rand(-1.5, 1.5));
    this.fish = [];
    for (let i = 0; i < this.n; i++) {
      const off = new THREE.Vector3(rand(-1.4, 1.4), rand(-0.5, 0.5), rand(-0.9, 0.9));
      this.fish.push({ off, pos: this.lead.clone().add(off), vel: this.leadVel.clone(), phase: rand(0, 10) });
    }
    this.t = 0;
    this.linger = rand(35, 55);
    this.stage = 'in';
  }
  update(dt: number, time: number) {
    const app = this.app;
    this.t += dt;
    const vis = app.cam.visibleX(0);
    // leader path: swim in, circle a patch of reef for a while, swim out the far side
    let goal: THREE.Vector3;
    if (this.stage === 'in') {
      goal = this.mill;
      if (this.lead.distanceTo(this.mill) < 1.5) this.stage = 'mill';
    } else if (this.stage === 'mill') {
      const a = this.t * 0.35;
      goal = this.mill.clone().add(new THREE.Vector3(Math.cos(a) * 2.2, Math.sin(a * 0.7) * 0.3, Math.sin(a) * 1.4));
      this.linger -= dt;
      if (this.linger <= 0) this.stage = 'out';
    } else goal = new THREE.Vector3(this.dir > 0 ? vis.max + 6 : vis.min - 6, this.lead.y, this.lead.z);
    const want = goal.clone().sub(this.lead);
    const speed = this.stage === 'mill' ? 0.9 : 1.4;
    if (want.length() > 0.01) want.normalize().multiplyScalar(speed);
    this.leadVel.lerp(want, Math.min(1, dt * 0.8));
    this.lead.addScaledVector(this.leadVel, dt);
    // keep the school in open water: above the seabed, below the surface
    const g = app.terrain.heightAt(this.lead.x, this.lead.z);
    this.lead.y = clamp(this.lead.y, g + 1.0, app.sim.level - 0.9);
    const arr = this.swim!.array as Float32Array;
    const X = new THREE.Vector3(),
      Y = new THREE.Vector3(),
      Z = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      const f = this.fish[i];
      const target = this.lead.clone().add(f.off).add(new THREE.Vector3(Math.sin(time * 0.7 + i) * 0.3, Math.sin(time * 0.9 + i * 2) * 0.12, Math.cos(time * 0.6 + i) * 0.25));
      const acc = target.sub(f.pos).multiplyScalar(1.6).sub(f.vel.clone().sub(this.leadVel).multiplyScalar(1.2));
      f.vel.addScaledVector(acc, dt);
      f.pos.addScaledVector(f.vel, dt);
      const gi = app.terrain.heightAt(f.pos.x, f.pos.z);
      f.pos.y = clamp(f.pos.y, gi + 0.5, app.sim.heightAt(f.pos.x, f.pos.z) - 0.4);
      f.phase += dt * 11 * (0.5 + f.vel.length() * 0.5);
      X.copy(f.vel).normalize();
      if (X.lengthSq() < 0.5) X.set(this.dir, 0, 0);
      Z.crossVectors(X, new THREE.Vector3(0, 1, 0));
      if (Z.lengthSq() < 1e-5) Z.set(0, 0, 1);
      Z.normalize();
      Y.crossVectors(Z, X).normalize();
      this.m4.makeBasis(X, Y, Z).setPosition(f.pos);
      this.mesh!.setMatrixAt(i, this.m4);
      arr[i * 4] = f.phase;
      arr[i * 4 + 1] = 1;
      arr[i * 4 + 2] = 0;
    }
    this.mesh!.instanceMatrix.needsUpdate = true;
    this.swim!.needsUpdate = true;
    const gone = this.stage === 'out' && (this.dir > 0 ? this.lead.x > vis.max + 4 : this.lead.x < vis.min - 4);
    return !gone && this.t < 200;
  }
  cleanup() {
    for (const m of [this.mesh, this.eyes]) {
      if (!m) continue;
      this.group.remove(m);
      const mt = m.material as THREE.MeshPhysicalMaterial;
      mt.map?.dispose();
      mt.normalMap?.dispose();
      mt.dispose();
    }
    this.mesh?.geometry.dispose();
    this.eyes?.geometry.dispose();
    this.mesh = this.eyes = null;
  }
}

// ======================================================================== C. crab carries a shell
class CrabShellEvent implements OceanEvent {
  readonly id = 'crabShell' as const;
  readonly weight = 1;
  private crab: Crab | null = null;
  private shell: THREE.Mesh | null = null;
  private stage: 'carry' | 'down' = 'carry';
  private t = 0;
  private dest = new THREE.Vector3();
  constructor(private app: App, private group: THREE.Group) {}
  private candidates() {
    return this.app.creatures.crabs.filter((c) => c.active && !c.walking && dryness(this.app.creatures.ctx, c.pos.x, c.pos.z) < -0.3);
  }
  eligible() {
    return this.candidates().length > 0;
  }
  start() {
    const list = this.candidates();
    const crab = list[Math.floor(Math.random() * list.length)];
    this.crab = crab;
    const seed = Math.floor(rand(1000, 9999));
    const shell = new THREE.Mesh(Reef.shellGeometry(seed).geo, this.app.reef.shellMaterial);
    shell.castShadow = true;
    // held up between the claws, in front of the carapace
    shell.scale.setScalar(0.55);
    shell.position.set(0.02, 0.22, 0.34);
    shell.rotation.set(1.2, 0.3, 0.2);
    crab.group.add(shell);
    this.shell = shell;
    const [x0, x1] = crab.homeRange;
    const dx = rand(1.8, 3.2) * (Math.random() < 0.5 ? -1 : 1);
    this.dest.set(clamp(crab.pos.x + dx, x0, x1), 0, clamp(crab.pos.z + rand(-1, 1), CONFIG.world.zBack + 1, CONFIG.world.zFront - 1));
    crab.goTo(this.dest.x, this.dest.z, 30);
    this.stage = 'carry';
    this.t = 0;
  }
  update(dt: number) {
    const crab = this.crab!;
    this.t += dt;
    if (this.stage === 'carry') {
      // the shell bobs with the crab's sideways scuttle
      this.shell!.position.y = 0.22 + Math.abs(Math.sin(this.t * 9)) * 0.015;
      const arrived = Math.hypot(crab.pos.x - this.dest.x, crab.pos.z - this.dest.z) < 0.35;
      if (arrived || !crab.walking || this.t > 30 || !crab.active) {
        // put it down on the sand in front of the crab
        const s = this.shell!;
        s.updateWorldMatrix(true, false);
        const p = new THREE.Vector3().setFromMatrixPosition(s.matrixWorld);
        crab.group.remove(s);
        s.scale.setScalar(0.55 * 1.15);
        s.position.set(p.x, this.app.terrain.heightAt(p.x, p.z) + 0.02, p.z + 0.15);
        s.rotation.set(0, rand(0, 6), 0);
        this.group.add(s);
        this.app.sediment.emitDust(p.x, s.position.y, p.z, 4, 0.3);
        this.stage = 'down';
        this.t = 0;
      }
      return true;
    }
    // leave it on the seabed for a while, then let it sink into the sand
    if (this.t > 60) {
      const s = this.shell!;
      s.position.y -= dt * 0.03;
      if (this.t > 66) return false;
    }
    return true;
  }
  cleanup() {
    const s = this.shell;
    if (s) {
      s.parent?.remove(s);
      s.geometry.dispose();
    }
    this.shell = null;
    this.crab = null;
  }
}

// ======================================================================== D. falling palm leaf
class PalmLeafEvent implements OceanEvent {
  readonly id = 'palmLeaf' as const;
  readonly weight = 0.8;
  private leaf: THREE.Mesh | null = null;
  private body: FloatBody & { mode: 'air' | 'ground' | 'water' } = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), draft: 0.0, yaw: 0, spin: 0.05, tilt: 1, mode: 'air' };
  private t = 0;
  private landT = 0;
  private flutter = 0;
  constructor(private app: App, private group: THREE.Group) {}
  eligible() {
    return this.app.island.palms.length > 0;
  }
  start() {
    const palms = this.app.island.palms;
    const p = palms[Math.floor(Math.random() * palms.length)];
    const leaf = deadFrond(Math.floor(rand(1, 999)));
    leaf.castShadow = true;
    leaf.scale.setScalar(0.85);
    this.leaf = leaf;
    this.group.add(leaf);
    const a = rand(0, Math.PI * 2);
    this.body.pos.set(p.crown.position.x + Math.cos(a) * 0.5, p.crown.position.y - 0.15, p.crown.position.z + Math.sin(a) * 0.5);
    this.body.vel.set(Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4);
    this.body.yaw = a;
    this.body.mode = 'air';
    this.t = 0;
    this.flutter = rand(0, 6);
    leaf.position.copy(this.body.pos);
    leaf.rotation.set(0, -a, -1.1);
  }
  update(dt: number, time: number) {
    const app = this.app;
    const b = this.body;
    const leaf = this.leaf!;
    this.t += dt;
    const wind = app.env.wind;
    if (b.mode === 'air') {
      // light and draggy: sinks slowly, sways side to side, drifts with the wind
      this.flutter += dt;
      b.vel.y += (-0.75 - b.vel.y) * Math.min(1, dt * 2.5);
      b.vel.x += (wind * 1.1 + Math.sin(this.flutter * 2.1) * 0.9 - b.vel.x) * Math.min(1, dt * 1.5);
      b.vel.z += (Math.cos(this.flutter * 1.7) * 0.5 - b.vel.z) * Math.min(1, dt * 1.5);
      b.pos.addScaledVector(b.vel, dt);
      leaf.position.copy(b.pos);
      leaf.rotation.z += (-0.15 + Math.sin(this.flutter * 2.1) * 0.45 - leaf.rotation.z) * Math.min(1, dt * 2);
      leaf.rotation.x = Math.sin(this.flutter * 1.3) * 0.35;
      leaf.rotation.y += dt * 0.3;
      const ground = app.terrain.heightAt(b.pos.x, b.pos.z);
      const surf = app.sim.heightAt(b.pos.x, b.pos.z);
      if (ground > surf - 0.02 && b.pos.y <= ground + 0.03) {
        b.mode = 'ground';
        this.landT = 0;
        app.sediment.emitDust(b.pos.x, ground, b.pos.z, 3, 0.4);
      } else if (b.pos.y <= surf) {
        b.mode = 'water';
        this.landT = 0;
        b.vel.set(b.vel.x * 0.3, 0, b.vel.z * 0.3);
        app.sim.addRipple(b.pos.x, b.pos.z, 0.035);
        app.creatures.ripple(b.pos.x, b.pos.z, 0.2);
      }
      return this.t < 60;
    }
    this.landT += dt;
    if (b.mode === 'ground') {
      leaf.position.y += (app.terrain.heightAt(b.pos.x, b.pos.z) + 0.03 - leaf.position.y) * Math.min(1, dt * 4);
      leaf.rotation.z += (-0.05 - leaf.rotation.z) * Math.min(1, dt * 3);
      leaf.rotation.x *= Math.exp(-dt * 3);
      if (app.sim.heightAt(b.pos.x, b.pos.z) > leaf.position.y + 0.03) b.mode = 'water'; // the tide took it
    } else {
      floatStep(b, app.sim, app.terrain, app.flow, dt, wind, leaf, 0.3);
      leaf.rotation.z = -0.05;
    }
    // fade by sinking / settling into the sand
    if (this.landT > 70) {
      leaf.position.y -= dt * 0.05;
      leaf.scale.multiplyScalar(Math.exp(-dt * 0.5));
      if (this.landT > 78) return false;
    }
    void time;
    return true;
  }
  cleanup() {
    if (!this.leaf) return;
    this.group.remove(this.leaf);
    disposeTree(this.leaf);
    this.leaf = null;
  }
}

// ======================================================================== E. shell washed ashore
class ShellAshoreEvent implements OceanEvent {
  readonly id = 'shellAshore' as const;
  readonly weight = 0.9;
  private shell: THREE.Mesh | null = null;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private k = 0;
  private surge = 0;
  private t = 0;
  private rest = 0;
  constructor(private app: App, private group: THREE.Group) {}
  /** A point on the island's waterline (front-facing half), plus a start point out in the shallows. */
  private findShore(): boolean {
    const I = CONFIG.island;
    const level = this.app.sim.level;
    for (let i = 0; i < 24; i++) {
      const a = rand(0.2, Math.PI - 0.2) * (Math.random() < 0.8 ? 1 : -1); // mostly the side facing the viewer
      const dx = Math.cos(a),
        dz = Math.sin(a);
      let land: THREE.Vector3 | null = null;
      for (let r = 2; r < 9; r += 0.1) {
        const x = I.x + dx * r,
          z = I.z + dz * r;
        if (this.app.terrain.heightAt(x, z) < level - 0.08) {
          land = new THREE.Vector3(x, 0, z);
          break;
        }
      }
      if (!land) continue;
      const sx = land.x + dx * 2.2,
        sz = land.z + dz * 2.2;
      if (this.app.terrain.heightAt(sx, sz) > level - 0.6) continue;
      const vis = this.app.cam.visibleX(1);
      if (land.x < vis.min || land.x > vis.max) continue;
      this.to.copy(land);
      this.from.set(sx, 0, sz);
      return true;
    }
    return false;
  }
  eligible() {
    return this.findShore();
  }
  start() {
    this.findShore();
    const shell = new THREE.Mesh(Reef.shellGeometry(Math.floor(rand(1, 9999))).geo, this.app.reef.shellMaterial);
    shell.castShadow = true;
    shell.scale.setScalar(1.1);
    this.shell = shell;
    this.group.add(shell);
    this.k = 0;
    this.surge = 1.5;
    this.t = 0;
    this.rest = rand(80, 120);
    this.place(0);
  }
  private place(roll: number) {
    const s = this.shell!;
    const x = this.from.x + (this.to.x - this.from.x) * this.k,
      z = this.from.z + (this.to.z - this.from.z) * this.k;
    s.position.set(x, this.app.terrain.heightAt(x, z) + 0.03, z);
    s.rotation.set(roll * 0.6, Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z) + roll, roll * 0.3);
  }
  update(dt: number) {
    const app = this.app;
    this.t += dt;
    if (this.k < 1) {
      // little waves nudge it shoreward, one push at a time
      this.surge -= dt;
      if (this.surge <= 0) {
        this.surge = rand(2.2, 3.4);
        app.sim.addRipple(this.from.x + (this.to.x - this.from.x) * this.k, this.from.z + (this.to.z - this.from.z) * this.k, 0.03);
      }
      const push = Math.max(0, Math.sin((1 - this.surge / 3) * Math.PI)) * 0.11;
      this.k = Math.min(1, this.k + push * dt);
      this.place(this.k * 6);
      if (Math.random() < dt * 2) app.sediment.emitDust(this.shell!.position.x, this.shell!.position.y, this.shell!.position.z, 1, 0.2);
      return true;
    }
    this.rest -= dt;
    if (this.rest < 0) {
      this.shell!.position.y -= dt * 0.03;
      if (this.rest < -6) return false;
    }
    return true;
  }
  cleanup() {
    if (!this.shell) return;
    this.group.remove(this.shell);
    this.shell.geometry.dispose();
    this.shell = null;
  }
}
