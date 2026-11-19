import * as THREE from 'three';
import { CONFIG, outsideView, viewWindow, zClamp } from '../config';
import { clamp, rand } from '../util/math';
import { merge, paint, taperedTube } from '../util/geometry';
import { fbm3 } from '../util/noise';
import { patchMaterial } from '../util/shaders';
import { buildMoray, buildSeahorse, buildTurtle, type SeahorseModel } from './visitorModels';
import { depthAt, towardDeep } from './shallows';
import type { App } from '../core/App';
import type { Selectable } from '../world/Reef';

/**
 * V2 (P3) rare visitors. Each comes, stays a while doing its own thing, and leaves. They are
 * quiet: no sound, no pop-up; residents simply give them a little room.
 *
 * Shared API: `begin()` picks where the visit happens (false = no suitable place right now),
 * `update()` returns false once the visitor has gone, `leave()` asks it to go, `pick()` is used
 * for hover / click observation.
 */
export type VisitorId = 'turtle' | 'manta' | 'dolphin' | 'whaleShark' | 'seahorse' | 'cuttlefish' | 'moray' | 'flyingFish';

export abstract class Visitor {
  abstract readonly id: VisitorId;
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  radius = 0.8;
  leaving = false;
  protected vel = new THREE.Vector3();
  protected yaw = 0;
  protected pitch = 0;
  protected t = 0;
  protected pickables: THREE.Object3D[] = [];
  private esc = { x: 0, z: 0, dist: 0 };
  constructor(protected app: App) {
    this.group.visible = false;
  }
  abstract begin(): boolean;
  abstract step(dt: number, time: number): boolean;
  abstract get label(): string;
  update(dt: number, time: number) {
    this.t += dt;
    const alive = this.step(dt, time);
    this.group.visible = alive;
    return alive;
  }
  leave() {
    this.leaving = true;
  }
  /** The pointer rests on it for a moment (gentle reaction; most visitors carry on). */
  notice(_p: THREE.Vector3) {}
  poke(_from: THREE.Vector3) {
    // visitors are calm: a poke makes them turn away a little
    this.vel.multiplyScalar(0.5);
  }
  pick(rc: THREE.Raycaster): THREE.Vector3 | null {
    if (!this.group.visible) return null;
    const h = rc.intersectObjects(this.pickables.length ? this.pickables : [this.group], true)[0];
    return h ? h.point.clone() : null;
  }
  /** A note in the Field Notebook when someone is watching. */
  protected behaviour(kind: string) {
    this.app.notebook?.behaviour(kind, this.pos);
  }

  // ---------------------------------------------------------------- helpers
  protected get level() {
    return this.app.sim.level;
  }
  protected ground(x: number, z: number) {
    return this.app.terrain.heightAt(x, z);
  }
  /** Smooth steering toward a point with a speed limit; returns the remaining distance. */
  protected steer(target: THREE.Vector3, speed: number, dt: number, accel = 0.8) {
    const d = tmpA.copy(target).sub(this.pos);
    const dist = d.length();
    const want = d.multiplyScalar(Math.min(speed, dist * 0.6) / Math.max(dist, 1e-4));
    this.vel.lerp(want, 1 - Math.exp(-dt * accel));
    this.pos.addScaledVector(this.vel, dt);
    return dist;
  }
  /** Keep between the seabed and the surface. */
  protected keepInWater(minAbove = 0.4, below = 0.3) {
    // too shallow here now (sea level / tide dropped): move off toward deeper water
    const need = minAbove + below + 0.15;
    const ctx = this.app.ctx;
    if (depthAt(ctx, this.pos.x, this.pos.z) < need && towardDeep(ctx, this.pos.x, this.pos.z, need + 0.4, this.esc)) {
      const step = depthAt(ctx, this.pos.x, this.pos.z) < 0.1 ? this.esc.dist : Math.min(this.esc.dist, 0.05);
      this.pos.x += this.esc.x * step;
      this.pos.z += this.esc.z * step;
    }
    const g = this.ground(this.pos.x, this.pos.z) + minAbove;
    const s = this.level - below;
    this.pos.y = clamp(this.pos.y, g, Math.max(g, s));
    this.pos.z = zClamp(this.pos.z, 0.8);
  }
  /** Face the direction of motion (local +x forward). */
  protected orient(dt: number, rate = 2) {
    const h = Math.hypot(this.vel.x, this.vel.z);
    if (h > 0.02) {
      const want = Math.atan2(-this.vel.z, this.vel.x);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * rate);
    }
    const wantPitch = Math.atan2(this.vel.y, Math.max(0.05, h)) * 0.8;
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * rate);
    this.group.position.copy(this.pos);
    this.group.rotation.set(0, this.yaw, this.pitch, 'YZX');
  }
  /** A start point just outside the view on the side nearest to `toward`. */
  protected entryPoint(toward: THREE.Vector3, y: number) {
    const W = CONFIG.world;
    const side = toward.x < viewWindow.cx ? -1 : 1;
    const x = clamp(viewWindow.cx + side * (viewWindow.halfW + 2), W.xMin + 2, W.xMax - 2);
    return new THREE.Vector3(x, y, zClamp(toward.z + rand(-3, 3), 1.5));
  }
  protected exitPoint() {
    const W = CONFIG.world;
    const side = this.pos.x < viewWindow.cx ? -1 : 1;
    return new THREE.Vector3(clamp(viewWindow.cx + side * (viewWindow.halfW + 4), W.xMin + 1.5, W.xMax - 1.5), this.pos.y, this.pos.z);
  }
  /** Seagrass meadows deep enough to swim over, preferring the front half (where people look). */
  protected seagrassSpots() {
    const all = this.app.reef.selectables.filter((s) => s.kind === 'seagrass' && this.level - s.object.position.y > 1.4);
    const front = all.filter((s) => s.object.position.z > -10);
    return front.length >= 3 && Math.random() < 0.85 ? front : all;
  }
}

const tmpA = new THREE.Vector3();
const C = (hex: number) => new THREE.Color(hex);
const mat = (key: string, rough = 0.6, extra: THREE.MeshStandardMaterialParameters = {}) =>
  patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, ...extra }), { caustics: true, key: `visitor-${key}` });

// ============================================================================ green turtle

export class Turtle extends Visitor {
  readonly id = 'turtle' as const;
  private state: 'arrive' | 'graze' | 'roam' | 'breathe' | 'leave' = 'arrive';
  private target = new THREE.Vector3();
  private timer = 0;
  private flippers: THREE.Object3D[] = [];
  private head: THREE.Object3D;
  private breathed = false;
  private lookT = 0;
  private lookAt = new THREE.Vector3();
  private headYaw = 0;

  notice(p: THREE.Vector3) {
    this.lookT = 2.5;
    this.lookAt.copy(p);
  }

  constructor(app: App) {
    super(app);
    this.radius = 0.8;
    // scute-patterned carapace, scaled head with a beak, swept front flippers (see visitorModels)
    const m = buildTurtle();
    this.group.add(m.root);
    this.head = m.head;
    this.flippers = m.flippers;
    this.pickables = [m.shell, m.headMesh];
  }

  get label() {
    return `Green sea turtle · ${this.state === 'graze' ? 'nibbling seagrass' : this.state === 'breathe' ? 'up for a breath' : this.state === 'leave' ? 'swimming away' : 'cruising slowly'}`;
  }

  private pickMeadow() {
    const spots = this.seagrassSpots();
    if (!spots.length) return false;
    const s = spots[Math.floor(Math.random() * spots.length)];
    this.target.copy(s.object.position).add(new THREE.Vector3(rand(-0.6, 0.6), 0.55, rand(-0.5, 0.5)));
    return true;
  }

  begin() {
    if (!this.pickMeadow()) return false;
    this.pos.copy(this.entryPoint(this.target, this.level - 1.6));
    this.keepInWater(0.6, 0.6);
    this.vel.set(0, 0, 0);
    this.state = 'arrive';
    this.breathed = false;
    this.leaving = false;
    this.t = 0;
    return true;
  }

  step(dt: number, time: number) {
    this.timer -= dt;
    let speed = 0.5;
    if (this.leaving && this.state !== 'leave' && this.state !== 'breathe') {
      this.state = 'leave';
      this.target.copy(this.exitPoint());
    }
    switch (this.state) {
      case 'arrive':
      case 'roam':
        if (this.steer(this.target, speed, dt) < 0.4) {
          this.state = 'graze';
          this.timer = rand(25, 45);
        }
        break;
      case 'graze':
        speed = 0.08;
        this.steer(this.target, speed, dt, 0.5);
        if (this.timer <= 0) {
          if (!this.breathed || Math.random() < 0.3) {
            this.state = 'breathe';
            this.target.set(this.pos.x + rand(-1, 1), this.level - 0.12, this.pos.z + rand(-0.5, 0.5));
            this.timer = 20;
          } else {
            this.state = 'roam';
            this.pickMeadow();
          }
        }
        break;
      case 'breathe': {
        const d = this.steer(this.target, 0.4, dt, 0.6);
        if (d < 0.25 && this.timer > 6) {
          this.timer = 6;
          this.app.sim.addRipple(this.pos.x + 0.6, this.pos.z, 0.05);
          this.app.spray.burst(this.pos.x + 0.6, this.level, this.pos.z, 0.25);
          this.behaviour('turtleBreath');
        }
        if (this.timer <= 0) {
          this.breathed = true;
          this.state = this.leaving ? 'leave' : 'roam';
          if (this.state === 'roam') this.pickMeadow();
          else this.target.copy(this.exitPoint());
        }
        break;
      }
      case 'leave':
        this.steer(this.target, 0.65, dt);
        if (Math.abs(this.pos.x - this.target.x) < 1 || (outsideView(this.pos.x) && this.t > 5)) return false;
        break;
    }
    if (this.state !== 'breathe') this.keepInWater(0.35, 0.5);
    else this.pos.y = Math.min(this.pos.y, this.level - 0.1);
    this.orient(dt, 1.2);
    // flippers: slow powerful strokes, gentle paddling while grazing
    const k = this.state === 'graze' ? 0.3 : 1;
    const ph = time * (this.state === 'graze' ? 1.2 : 1.7);
    this.flippers.forEach((f, i) => {
      const s = i % 2 ? -1 : 1;
      const front = i < 2;
      f.rotation.x = s * Math.sin(ph + (front ? 0 : 1.4)) * (front ? 0.55 : 0.25) * k;
      f.rotation.z = Math.sin(ph + 0.6) * (front ? 0.2 : 0.1) * k;
    });
    this.head.rotation.z = this.state === 'graze' ? -0.35 + Math.sin(time * 2.2) * 0.1 : 0;
    // turns its head toward whoever is looking at it
    this.lookT -= dt;
    let want = 0;
    if (this.lookT > 0) {
      const d = Math.atan2(-(this.lookAt.z - this.pos.z), this.lookAt.x - this.pos.x) - this.yaw;
      want = clamp(Math.atan2(Math.sin(d), Math.cos(d)), -0.7, 0.7);
    }
    this.headYaw += (want - this.headYaw) * Math.min(1, dt * 2.5);
    this.head.rotation.y = this.headYaw;
    return true;
  }
}

// ============================================================================ manta ray

export class Manta extends Visitor {
  readonly id = 'manta' as const;
  private mesh: THREE.Mesh;
  private base: Float32Array;
  private target = new THREE.Vector3();
  private roll = 0;
  private rolling = 0;
  private rollT = rand(15, 30);

  constructor(app: App) {
    super(app);
    this.radius = 1.5;
    // planform: swept wings, pointed tips; top and bottom surfaces
    const NS = 26,
      NC = 9;
    const pos: number[] = [],
      idx: number[] = [],
      col: number[] = [];
    const span = 1.7;
    for (const side of [1, -1]) {
      const off = pos.length / 3;
      for (let i = 0; i <= NS; i++) {
        const s = (i / NS) * 2 - 1;
        const a = Math.abs(s);
        const le = 0.62 - 0.85 * Math.pow(a, 1.1);
        const te = -0.62 + 0.4 * Math.pow(a, 1.6);
        for (let j = 0; j <= NC; j++) {
          const u = j / NC;
          const x = le + (te - le) * u;
          const thick = 0.13 * (1 - a * a) * Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.05));
          pos.push(x, side > 0 ? thick : -thick * 0.35, s * span);
          const c = side > 0 ? C(0x23262e).lerp(C(0x9aa0a8), a > 0.25 && a < 0.55 && u < 0.4 ? 0.35 : 0) : C(0xe8eaee).lerp(C(0x50545c), a > 0.85 ? 0.6 : 0);
          col.push(c.r, c.g, c.b);
        }
      }
      for (let i = 0; i < NS; i++)
        for (let j = 0; j < NC; j++) {
          const a0 = off + i * (NC + 1) + j,
            b0 = a0 + NC + 1;
          if (side > 0) idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0);
          else idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.base = new Float32Array(pos);
    this.mesh = new THREE.Mesh(g, mat('manta', 0.5, { side: THREE.DoubleSide }));
    this.mesh.castShadow = true;
    this.group.add(this.mesh);
    // cephalic fins and a whip-thin tail
    const finMat = mat('manta-fin', 0.55);
    for (const s of [1, -1]) {
      const fin = taperedTube(new THREE.CatmullRomCurve3([new THREE.Vector3(0.55, 0, s * 0.22), new THREE.Vector3(0.8, -0.02, s * 0.2), new THREE.Vector3(0.88, -0.08, s * 0.14)]), 6, 5, (t) => 0.035 * (1 - 0.5 * t), 1, true);
      paint(fin, (_p, _n, c) => c.set(0x2a2d34));
      this.group.add(new THREE.Mesh(fin, finMat));
    }
    const tail = taperedTube(new THREE.LineCurve3(new THREE.Vector3(-0.55, 0, 0), new THREE.Vector3(-1.5, 0, 0)), 8, 4, (t) => 0.025 * (1 - 0.8 * t), 1, true);
    paint(tail, (_p, _n, c) => c.set(0x2a2d34));
    this.group.add(new THREE.Mesh(tail, finMat));
    this.pickables = [this.mesh];
  }

  get label() {
    return `Manta ray · ${this.rolling > 0 ? 'somersaulting' : 'gliding'}`;
  }

  private pickTarget() {
    const p = this.app.ctx.habitat?.sample(Math.random() < 0.6 ? 'deep' : 'slope', [0.45, 0.85], new THREE.Vector3(), this.level);
    if (p) this.target.copy(p);
    return !!p;
  }

  begin() {
    if (!this.pickTarget()) return false;
    this.pos.copy(this.entryPoint(this.target, this.target.y));
    this.vel.set(0, 0, 0);
    this.leaving = false;
    this.t = 0;
    return true;
  }

  step(dt: number, time: number) {
    if (this.leaving) {
      this.steer(this.exitPoint(), 1.0, dt);
      if (outsideView(this.pos.x) && this.t > 5) return false;
    } else if (this.steer(this.target, 0.85, dt, 0.5) < 1.2) this.pickTarget();
    this.keepInWater(1.2, 1.0);
    // now and then a slow somersault (feeding loop)
    this.rollT -= dt;
    if (this.rollT <= 0 && this.rolling <= 0 && !this.leaving) {
      this.rolling = 3.2;
      this.rollT = rand(20, 40);
      this.behaviour('mantaRoll');
    }
    if (this.rolling > 0) {
      this.rolling -= dt;
      this.roll = (1 - Math.max(0, this.rolling) / 3.2) * Math.PI * 2;
    } else this.roll = 0;
    this.orient(dt, 0.8);
    this.group.rotation.z += this.roll;
    // wing beat: a slow wave travelling out to the tips
    const p = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = this.base[i * 3],
        z = this.base[i * 3 + 2];
      const a = Math.abs(z) / 1.7;
      p.setY(i, this.base[i * 3 + 1] + Math.sin(time * 1.3 - a * 1.6 + x * 0.6) * Math.pow(a, 1.5) * 0.42);
    }
    p.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    return true;
  }
}

// ============================================================================ dolphins

function dolphinGeometry() {
  const body = taperedTube(
    new THREE.CatmullRomCurve3([new THREE.Vector3(-0.85, 0.02, 0), new THREE.Vector3(-0.3, 0.06, 0), new THREE.Vector3(0.35, 0.04, 0), new THREE.Vector3(0.82, -0.02, 0)]),
    28,
    12,
    (t) => {
      // t: tail (0) → rostrum (1)
      if (t > 0.9) return 0.035 + (1 - t) * 0.35;
      return 0.04 + 0.16 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.8;
    },
    1,
    true,
  );
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.05, 0.2, -0.12, 0.26);
  shape.quadraticCurveTo(-0.08, 0.1, -0.2, 0);
  const dorsal = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false }).translate(0.05, 0.17, -0.01);
  const fluke = new THREE.Shape();
  fluke.moveTo(0, 0);
  fluke.quadraticCurveTo(-0.1, 0.18, -0.22, 0.22);
  fluke.quadraticCurveTo(-0.14, 0.06, -0.12, 0);
  fluke.quadraticCurveTo(-0.14, -0.06, -0.22, -0.22);
  fluke.quadraticCurveTo(-0.1, -0.18, 0, 0);
  const flukes = new THREE.ExtrudeGeometry(fluke, { depth: 0.015, bevelEnabled: false }).rotateX(Math.PI / 2).translate(-0.82, 0.03, 0);
  const pect = (s: number) => new THREE.SphereGeometry(1, 10, 6).scale(0.14, 0.015, 0.05).rotateY(s * 0.6).translate(0.35, -0.08, s * 0.14);
  const g = merge([body, dorsal, flukes, pect(1), pect(-1)]);
  paint(g, (p, n, c) => {
    const belly = n.y < -0.25 && p.x > -0.6 ? 1 : 0;
    c.set(0x58626e).lerp(C(0xd0d4d8), belly * 0.85).multiplyScalar(0.92 + 0.12 * Math.max(0, n.y));
  });
  return g;
}

export class Dolphins extends Visitor {
  readonly id = 'dolphin' as const;
  private pods: { m: THREE.Group; off: THREE.Vector3; leap: number; leapT: number; p: THREE.Vector3; v: number }[] = [];
  private dir = 1;
  private passes = 0;

  constructor(app: App) {
    super(app);
    this.radius = 1.2;
    const g = dolphinGeometry();
    const m = mat('dolphin', 0.3);
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      const holder = new THREE.Group();
      holder.add(mesh);
      this.group.add(holder);
      this.pods.push({ m: holder, off: new THREE.Vector3(-i * 1.3, 0, (i % 2 ? 1 : -1) * 0.7 * i), leap: 0, leapT: rand(2, 6), p: new THREE.Vector3(), v: 0 });
      this.pickables.push(mesh);
    }
  }

  get label() {
    return 'Dolphins · playing far out';
  }

  begin() {
    const W = CONFIG.world;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.pos.set(this.dir > 0 ? W.xMin + 2 : W.xMax - 2, this.level - 0.9, W.zBack + rand(2.2, 4.5));
    this.passes = 0;
    this.leaving = false;
    this.t = 0;
    this.group.position.set(0, 0, 0);
    this.pods.forEach((d) => {
      d.leap = 0;
      d.leapT = rand(1.5, 5);
      d.v = 0;
    });
    return true;
  }

  step(dt: number, time: number) {
    const W = CONFIG.world;
    this.pos.x += this.dir * 2.1 * dt;
    if ((this.dir > 0 && this.pos.x > W.xMax - 1.5) || (this.dir < 0 && this.pos.x < W.xMin + 1.5)) {
      this.passes++;
      if (this.leaving || this.passes >= 2) return false;
      this.dir *= -1;
      this.pos.z = W.zBack + rand(2.2, 4.5);
    }
    let leapt = false;
    for (const d of this.pods) {
      const x = this.pos.x - this.dir * Math.abs(d.off.x),
        z = this.pos.z + d.off.z;
      const swimY = this.level - 0.8 + Math.sin(time * 1.1 + d.off.x) * 0.15;
      d.leapT -= dt;
      if (d.leap <= 0 && d.leapT <= 0 && this.ground(x, z) < this.level - 2) {
        d.leap = 1.15;
        d.v = 5.4;
        d.p.set(x, swimY, z);
        this.app.spray.burst(x, this.level, z, 0.5);
      }
      let y = swimY,
        tilt = Math.sin(time * 2.4 + d.off.x) * 0.06;
      if (d.leap > 0) {
        d.leap -= dt;
        d.v -= 9.8 * dt;
        d.p.y += d.v * dt;
        y = Math.max(d.p.y, swimY);
        tilt = Math.atan2(d.v, 2.1) * 0.9;
        if (d.p.y > this.level + 0.2) leapt = true;
        if (d.leap <= 0 || (d.v < 0 && d.p.y < this.level - 0.3)) {
          d.leap = 0;
          d.leapT = rand(3, 8);
          this.app.spray.burst(x, this.level, z, 0.7);
          this.app.sim.disturb(x, zClamp(z, 0.5), -0.8, 0.5);
        }
      }
      d.m.position.set(x, y, z);
      d.m.rotation.set(0, this.dir > 0 ? 0 : Math.PI, this.dir > 0 ? tilt : tilt);
    }
    if (leapt) this.behaviour('dolphinLeap');
    return true;
  }
}

// ============================================================================ whale shark

export class WhaleShark extends Visitor {
  readonly id = 'whaleShark' as const;
  private mesh: THREE.Mesh;
  private base: Float32Array;
  private dir = 1;
  private waveT = 0;

  constructor(app: App) {
    super(app);
    this.radius = 2.5;
    const L = 6.2;
    const body = taperedTube(
      new THREE.CatmullRomCurve3([new THREE.Vector3(-L / 2, 0.1, 0), new THREE.Vector3(-L * 0.15, 0.05, 0), new THREE.Vector3(L * 0.25, 0, 0), new THREE.Vector3(L / 2, -0.05, 0)]),
      90,
      48,
      (t) => {
        // blunt, rounded head (no flared lip): the last bit closes like a quarter circle
        const r = 0.08 + 0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.04)), 0.7);
        return t > 0.93 ? r * Math.sqrt(Math.max(0.02, 1 - ((t - 0.93) / 0.07) ** 2)) : r;
      },
      1,
      true,
    ).scale(1, 0.72, 1.05);
    {
      // a broad, flat head: wider and lower toward the front
      const pa = body.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const k = Math.max(0, Math.min(1, pa.getX(i) / (L / 2)));
        pa.setY(i, pa.getY(i) * (1 - 0.22 * k));
        pa.setZ(i, pa.getZ(i) * (1 + 0.3 * k));
      }
      body.computeVertexNormals();
    }
    const tailShape = new THREE.Shape();
    tailShape.moveTo(0, 0);
    tailShape.quadraticCurveTo(-0.4, 0.9, -0.9, 1.5);
    tailShape.quadraticCurveTo(-0.6, 0.6, -0.55, 0);
    tailShape.quadraticCurveTo(-0.6, -0.4, -0.75, -0.8);
    tailShape.quadraticCurveTo(-0.3, -0.5, 0, 0);
    const tail = new THREE.ExtrudeGeometry(tailShape, { depth: 0.06, bevelEnabled: false }).translate(-L / 2 + 0.1, 0.1, -0.03);
    const dShape = new THREE.Shape();
    dShape.moveTo(0, 0);
    dShape.quadraticCurveTo(-0.2, 0.7, -0.6, 0.75);
    dShape.lineTo(-0.7, 0);
    const dorsal = new THREE.ExtrudeGeometry(dShape, { depth: 0.05, bevelEnabled: false }).translate(-0.2, 0.42, -0.025);
    const pect = (s: number) => new THREE.SphereGeometry(1, 12, 6).scale(0.75, 0.04, 0.22).rotateY(s * 0.5).translate(0.6, -0.3, s * 0.65);
    const g = merge([body, tail, dorsal, pect(1), pect(-1)]);
    paint(g, (p, n, c) => {
      // checker of pale spots and lines on a dark blue-grey back, pale belly
      const u = p.x * 2.3;
      const v = Math.atan2(p.y, p.z) * 1.7 + (Math.floor(u) % 2 ? 0.5 : 0);
      const du = u - Math.floor(u) - 0.5;
      const dv = v - Math.floor(v) - 0.5;
      // soft round spots (vertex colours blend, so fade them in rather than switching)
      const spot = Math.max(0, Math.min(1, (0.3 - Math.hypot(du, dv)) / 0.12));
      c.set(0x2e3c4a).lerp(C(0xc8d0d4), n.y < -0.3 ? 0.75 : 0);
      if (n.y > -0.2) c.lerp(C(0xdde4e8), spot * 0.75);
      if (p.x > L / 2 - 0.25 && Math.abs(p.y) < 0.06) c.set(0x10141a); // the wide mouth
    });
    this.base = new Float32Array((g.attributes.position as THREE.BufferAttribute).array);
    this.mesh = new THREE.Mesh(g, mat('whaleshark', 0.55));
    this.mesh.castShadow = true;
    this.group.add(this.mesh);
    this.pickables = [this.mesh];
  }

  get label() {
    return 'Whale shark · passing far behind';
  }

  /** Only the deep part of the far back (the western back is a shallow lagoon). */
  static readonly X0 = -20;

  begin() {
    const W = CONFIG.world;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    const z = W.zBack + 1.8;
    this.pos.set(this.dir > 0 ? WhaleShark.X0 : W.xMax - 3, 0, z);
    this.pos.y = Math.max(this.ground(this.pos.x, z) + 1.6, this.level - 4.5);
    this.leaving = false;
    this.t = 0;
    return true;
  }

  step(dt: number, time: number) {
    const W = CONFIG.world;
    this.pos.x += this.dir * 0.52 * dt;
    const wantY = Math.min(this.level - 2.2, Math.max(this.ground(this.pos.x, this.pos.z) + 1.7, this.level - 4.5));
    this.pos.y += (wantY - this.pos.y) * Math.min(1, dt * 0.3);
    if ((this.dir > 0 && this.pos.x > W.xMax - 2.5) || (this.dir < 0 && this.pos.x < WhaleShark.X0)) return false;
    this.group.position.copy(this.pos);
    this.group.rotation.set(0, this.dir > 0 ? 0 : Math.PI, 0);
    // slow body wave, strongest at the tail
    // (~20 fps is plenty for a wave this slow; the head half never moves)
    this.waveT -= dt;
    if (this.waveT > 0) return true;
    this.waveT = 0.05;
    const p = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    const base = this.base;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3];
      if (x >= 1.2) continue;
      const k = (1.2 - x) / 4.3;
      arr[i * 3 + 2] = base[i * 3 + 2] + Math.sin(time * 0.9 - x * 0.7) * k * k * 0.55;
    }
    p.needsUpdate = true;
    return true;
  }
}

// ============================================================================ seahorse

export class Seahorse extends Visitor {
  readonly id = 'seahorse' as const;
  private home: Selectable | null = null;
  private anchor = new THREE.Vector3();
  private moveT = rand(60, 150);
  private drift = new THREE.Vector3();
  private model: SeahorseModel;
  private lookT = 0;
  private turn = 0;
  private curl = 0;

  notice(_p: THREE.Vector3) {
    this.lookT = 3;
  }
  poke(_from: THREE.Vector3) {
    this.curl = 1;
  }

  constructor(app: App) {
    super(app);
    this.radius = 0.2;
    const hue = [0xd8a030, 0xc8642a, 0x8a6a3a][Math.floor(Math.random() * 3)];
    // ringed bony plates, curled square tail, horse-like head with coronet (see visitorModels)
    this.model = buildSeahorse(hue);
    this.group.add(this.model.root);
    this.group.scale.setScalar(1.3);
    this.pickables = [this.model.body];
  }

  get label() {
    return 'Seahorse · holding on to the seagrass';
  }

  private pickHome() {
    const spots = this.seagrassSpots();
    if (!spots.length) return false;
    this.home = spots[Math.floor(Math.random() * spots.length)];
    const p = this.home.object.position;
    this.anchor.set(p.x + rand(-0.25, 0.25), p.y + rand(0.35, 0.6), p.z + rand(-0.2, 0.2));
    return true;
  }

  begin() {
    if (!this.pickHome()) return false;
    this.pos.copy(this.anchor);
    this.leaving = false;
    this.t = 0;
    return true;
  }

  step(dt: number, time: number) {
    if (this.leaving) {
      // drifts quietly down into the meadow and is gone
      this.pos.y -= dt * 0.06;
      if (this.pos.y < this.ground(this.pos.x, this.pos.z) + 0.05) return false;
    } else {
      this.moveT -= dt;
      if (this.moveT <= 0) {
        this.moveT = rand(60, 150);
        const p = this.home!.object.position;
        this.drift.set(p.x + rand(-0.3, 0.3), p.y + rand(0.3, 0.6), p.z + rand(-0.25, 0.25));
      }
      if (this.drift.lengthSq() > 0) this.pos.lerp(this.drift, Math.min(1, dt * 0.05));
      else this.pos.lerp(this.anchor, Math.min(1, dt * 0.2));
    }
    this.group.position.copy(this.pos);
    // noticed: it turns to face you; poked: it curls up and draws in for a moment
    this.lookT -= dt;
    this.turn += ((this.lookT > 0 ? 1 : 0) - this.turn) * Math.min(1, dt * 1.5);
    this.curl = Math.max(0, this.curl - dt * 0.6);
    const c = Math.sin(Math.min(1, this.curl * 1.4) * Math.PI * 0.5);
    this.group.rotation.set(0, (0.6 + Math.sin(time * 0.3) * 0.2) * (1 - this.turn) - 0.9 * this.turn, Math.sin(time * 0.7) * 0.08 + c * 0.25);
    this.model.root.scale.set(1 - 0.06 * c, 1 - 0.12 * c, 1);
    // the dorsal fin ripples very fast (a wave running along its rays); pectorals flutter
    const f = this.model;
    const p = f.fin.geometry.attributes.position as THREE.BufferAttribute;
    const arr = p.array as Float32Array;
    for (let i = 0; i < p.count; i++) arr[i * 3 + 2] = f.finBase[i * 3 + 2] + Math.sin(time * 26 - f.finCol[i] * 9) * 0.0045 * f.finK[i];
    p.needsUpdate = true;
    f.pecs.forEach((m, i) => (m.rotation.x = Math.sin(time * 22 + i * 1.7) * 0.5));
    return true;
  }
}

// ============================================================================ cuttlefish

export class Cuttlefish extends Visitor {
  readonly id = 'cuttlefish' as const;
  private target = new THREE.Vector3();
  private skin: THREE.MeshStandardMaterial;
  private uniforms = { uWave: { value: 0 }, uShow: { value: 0 } };
  private skirt: THREE.Mesh;
  private skirtBase: Float32Array;
  private moveT = 0;
  private showT = rand(8, 16);

  constructor(app: App) {
    super(app);
    this.radius = 0.4;
    const mantle = new THREE.SphereGeometry(1, 24, 14).scale(0.36, 0.13, 0.16);
    const eyes = [1, -1].map((s) => new THREE.SphereGeometry(0.035, 10, 8).translate(0.24, 0.05, s * 0.11));
    const arms: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      arms.push(new THREE.ConeGeometry(0.018, 0.16, 5).rotateZ(-Math.PI / 2).translate(0.42, Math.sin(a) * 0.04, Math.cos(a) * 0.05));
    }
    const g = merge([mantle, ...eyes, ...arms]);
    paint(g, (p, _n, c) => {
      if (p.x > 0.2 && p.x < 0.28 && Math.abs(Math.abs(p.z) - 0.11) < 0.03 && p.y > 0.02) c.set(0x202018);
      else c.set(0xc8b8a0);
    });
    this.skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });
    // passing dark bands ("clouds") and a slow shift between sand and mottled brown
    this.skin.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocal;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLocal; uniform float uWave; uniform float uShow;')
        .replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          `vec4 diffuseColor = vec4( diffuse, opacity );
          float band = smoothstep(0.35, 0.9, sin(vLocal.x * 34.0 + uWave) * 0.5 + 0.5) * uShow;
          float mott = smoothstep(0.4, 0.6, fract(sin(dot(floor(vLocal.xz * 60.0), vec2(12.9898, 78.233))) * 43758.5453));
          vec3 shift = mix(vec3(1.0), vec3(0.62, 0.5, 0.42), 0.35 + 0.25 * mott);
          diffuseColor.rgb *= shift * (1.0 - band * 0.7);`,
        );
    };
    this.skin.customProgramCacheKey = () => 'cuttle-skin';
    const body = new THREE.Mesh(g, this.skin);
    body.castShadow = true;
    this.group.add(body);
    // the undulating fin skirt around the mantle
    const skirtGeo = new THREE.RingGeometry(1, 1.22, 48, 1).rotateX(-Math.PI / 2).scale(0.33, 1, 0.15);
    paint(skirtGeo, (_p, _n, c) => c.set(0xd8ccb8));
    this.skirtBase = new Float32Array((skirtGeo.attributes.position as THREE.BufferAttribute).array);
    this.skirt = new THREE.Mesh(skirtGeo, mat('cuttle-skirt', 0.5, { side: THREE.DoubleSide, transparent: true, opacity: 0.75 }));
    this.group.add(this.skirt);
    this.group.scale.setScalar(1.25);
    this.pickables = [body];
  }

  get label() {
    return `Cuttlefish · ${this.uniforms.uShow.value > 0.5 ? 'flashing waves of colour' : 'hovering'}`;
  }

  private pickTarget() {
    const kind = Math.random() < 0.55 ? 'lagoonReef' : 'mainReef';
    const p = this.app.ctx.habitat?.sample(kind, [0.15, 0.45], new THREE.Vector3(), this.level);
    if (p) this.target.copy(p);
    return !!p;
  }

  begin() {
    if (!this.pickTarget()) return false;
    this.pos.copy(this.entryPoint(this.target, this.target.y));
    this.leaving = false;
    this.t = 0;
    return true;
  }

  step(dt: number, time: number) {
    if (this.leaving) {
      this.steer(this.exitPoint(), 0.6, dt);
      if (outsideView(this.pos.x) && this.t > 5) return false;
    } else {
      const d = this.steer(this.target, 0.45, dt, 0.7);
      this.moveT -= dt;
      if (d < 0.3 && this.moveT <= 0) {
        this.moveT = rand(10, 25);
        // hover a while, then drift to a nearby spot
        this.target.add(new THREE.Vector3(rand(-1.5, 1.5), rand(-0.2, 0.2), rand(-1, 1)));
        this.target.z = zClamp(this.target.z, 1);
      }
    }
    this.keepInWater(0.35, 0.6);
    this.orient(dt, 1.5);
    // colour display
    this.showT -= dt;
    if (this.showT <= 0) {
      this.showT = rand(14, 26);
      this.behaviour('cuttleColor');
    }
    const showing = this.showT > 9 ? 0 : Math.sin(Math.PI * (this.showT / 9));
    this.uniforms.uShow.value += (showing - this.uniforms.uShow.value) * Math.min(1, dt * 2);
    this.uniforms.uWave.value = -time * 9;
    // fin skirt ripple
    const p = this.skirt.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = this.skirtBase[i * 3],
        z = this.skirtBase[i * 3 + 2];
      const a = Math.atan2(z, x);
      p.setY(i, this.skirtBase[i * 3 + 1] + Math.sin(a * 6 + time * 7) * 0.015 * (Math.hypot(x / 0.33, z / 0.15) > 1.1 ? 1 : 0.2));
    }
    p.needsUpdate = true;
    return true;
  }
}

// ============================================================================ moray eel

export class Moray extends Visitor {
  readonly id = 'moray' as const;
  private jaw: THREE.Object3D;
  private body: THREE.Group;
  private out = 0;
  private wantOut = 1;
  private peekT = 0;
  private snapT = 0;

  /** Watched: it slides back a little into its crevice. */
  notice(_p: THREE.Vector3) {
    if (this.leaving) return;
    this.wantOut = 0.35;
    this.peekT = rand(3, 5);
  }
  /** Poked: a wide gape, then it retreats and peeks out again later. */
  poke(_from: THREE.Vector3) {
    if (this.leaving) return;
    this.snapT = 0.5;
    this.wantOut = 0.15;
    this.peekT = rand(5, 8);
  }
  private dir = new THREE.Vector3(0, 0.3, 1).normalize();
  private hole = new THREE.Vector3();

  constructor(app: App) {
    super(app);
    this.radius = 0.4;
    // laterally flattened body with a fin fold, heavy head, hinged jaw with teeth (see visitorModels)
    const model = buildMoray(Math.random() < 0.5);
    this.jaw = model.jaw;
    const bodyMesh = model.body;
    this.body = new THREE.Group();
    this.body.add(model.root);
    this.group.add(this.body);
    this.group.scale.setScalar(1.3);
    this.pickables = [bodyMesh];
  }

  get label() {
    return `Moray eel · ${this.out > 0.6 ? 'breathing at its crevice' : 'peeking out'}`;
  }

  begin() {
    // a crevice: a reef rock or cave, preferring ones under enough water
    const reef = this.app.reef;
    const deep = reef.selectables.filter((s) => (s.kind === 'rock' || s.habitat === 'cave') && this.level - s.object.position.y > 2.2);
    // big enough to hide most of a moray
    const big = deep.filter((s) => s.radius > 0.9);
    const rocks = big.length >= 3 ? big : deep;
    if (!rocks.length) return false;
    const r = rocks[Math.floor(Math.random() * rocks.length)];
    const c = r.object.position;
    // out of the side of the rock, slightly toward the viewer, so its profile (and mouth) shows
    this.dir.set(Math.random() < 0.5 ? 1 : -1, 0.2, 0.45).normalize();
    // find the rock's actual surface on that side (boulders are flattened, so the bounding radius lies)
    const from = c.clone().add(new THREE.Vector3(0, 0.35, 0)).addScaledVector(this.dir, r.radius * 2 + 1);
    const ray = new THREE.Raycaster(from, this.dir.clone().negate(), 0, r.radius * 3 + 2);
    const hit = ray.intersectObject(r.object, true)[0];
    if (hit) this.hole.copy(hit.point).addScaledVector(this.dir, 0.04);
    else this.hole.copy(c).addScaledVector(this.dir, r.radius);
    this.hole.y = Math.max(this.hole.y, this.ground(this.hole.x, this.hole.z) + 0.15);
    this.pos.copy(this.hole);
    this.out = 0;
    this.wantOut = 1;
    this.peekT = rand(20, 40);
    this.leaving = false;
    this.t = 0;
    return true;
  }

  step(dt: number, time: number) {
    if (this.leaving) this.wantOut = 0;
    else {
      this.peekT -= dt;
      if (this.peekT <= 0) {
        // now and then it slides back in for a moment
        this.wantOut = this.wantOut > 0.5 ? 0.25 : 1;
        this.peekT = this.wantOut > 0.5 ? rand(25, 50) : rand(4, 8);
      }
    }
    this.out += (this.wantOut - this.out) * Math.min(1, dt * 0.8);
    if (this.leaving && this.out < 0.03) return false;
    const yaw = Math.atan2(-this.dir.z, this.dir.x);
    this.group.position.copy(this.hole).addScaledVector(this.dir, (this.out - 1) * 0.75);
    this.group.rotation.set(0, yaw + Math.sin(time * 0.6) * 0.25, 0.25 + Math.sin(time * 0.9) * 0.08, 'YZX');
    this.pos.copy(this.group.position);
    // breathing: the mouth slowly opens and closes
    this.snapT = Math.max(0, this.snapT - dt);
    this.jaw.rotation.z = this.snapT > 0 ? -0.6 : -(0.06 + (0.5 + 0.5 * Math.sin(time * 2.2)) * 0.3);
    return true;
  }
}

// ============================================================================ flying fish

export class FlyingFish extends Visitor {
  readonly id = 'flyingFish' as const;
  private fish: { g: THREE.Group; wings: THREE.Mesh[]; off: THREE.Vector3; glide: number; gT: number; y: number; vy: number }[] = [];
  private dir = 1;
  private z = 0;

  constructor(app: App) {
    super(app);
    this.radius = 1.2;
    const body = taperedTube(new THREE.LineCurve3(new THREE.Vector3(-0.2, 0, 0), new THREE.Vector3(0.2, 0, 0)), 10, 8, (t) => 0.012 + 0.035 * Math.sin(Math.PI * Math.min(1, t * 1.05)), 1, true);
    const tail = new THREE.ConeGeometry(0.05, 0.1, 3).rotateZ(Math.PI / 2).scale(1, 1, 0.15).translate(-0.24, 0, 0);
    const g = merge([body, tail]);
    paint(g, (_p, n, c) => c.set(0x2a4a8a).lerp(C(0xe0e8f0), n.y < 0 ? 0.8 : 0));
    const bodyMat = mat('flyfish', 0.3, { metalness: 0.3 });
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0.08, 0, 0, -0.12, 0, 0, -0.06, 0, 0.26], 3));
    wingGeo.setAttribute('color', new THREE.Float32BufferAttribute([0.6, 0.75, 0.95, 0.6, 0.75, 0.95, 0.75, 0.85, 1], 3));
    wingGeo.computeVertexNormals();
    const wingMat = mat('flyfish-wing', 0.3, { side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    for (let i = 0; i < 6; i++) {
      const holder = new THREE.Group();
      const m = new THREE.Mesh(g, bodyMat);
      holder.add(m);
      const wings = [1, -1].map((s) => {
        const w = new THREE.Mesh(wingGeo, wingMat);
        w.scale.z = s;
        holder.add(w);
        return w;
      });
      this.group.add(holder);
      this.fish.push({ g: holder, wings, off: new THREE.Vector3(-i * 0.7 + rand(-0.2, 0.2), 0, rand(-1.2, 1.2)), glide: 0, gT: rand(0.5, 6), y: 0, vy: 0 });
      this.pickables.push(m);
    }
    this.group.scale.setScalar(1.6);
  }

  get label() {
    return 'Flying fish · gliding over the waves';
  }

  begin() {
    // over open water that is in view if possible
    const W = CONFIG.world;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    for (let k = 0; k < 20; k++) {
      this.z = rand(W.zBack + 3, W.zFront - 2);
      const x = this.dir > 0 ? viewWindow.cx - viewWindow.halfW : viewWindow.cx + viewWindow.halfW;
      if (this.ground(x, this.z) < this.level - 2.5) {
        this.pos.set(clamp(x, W.xMin + 2, W.xMax - 2), this.level - 0.5, this.z);
        this.leaving = false;
        this.t = 0;
        this.group.position.set(0, 0, 0);
        this.group.scale.setScalar(1);
        return true;
      }
    }
    return false;
  }

  step(dt: number, time: number) {
    const W = CONFIG.world;
    this.pos.x += this.dir * 2.6 * dt;
    if (this.pos.x < W.xMin + 1.5 || this.pos.x > W.xMax - 1.5 || (this.leaving && outsideView(this.pos.x) && this.t > 4)) return false;
    let glided = false;
    for (const f of this.fish) {
      const x = this.pos.x - this.dir * Math.abs(f.off.x),
        z = zClamp(this.pos.z + f.off.z, 0.8);
      const surf = this.app.sim.heightAt(x, z);
      f.gT -= dt;
      if (f.glide <= 0 && f.gT <= 0 && !this.leaving) {
        f.glide = rand(1.4, 2.2);
        f.vy = 2.2;
        f.y = surf - 0.1;
        this.app.spray.burst(x, surf, z, 0.25);
      }
      let y = surf - 0.45 + Math.sin(time * 3 + f.off.x) * 0.05;
      let spread = 0.1;
      if (f.glide > 0) {
        f.glide -= dt;
        // pop out, then glide low and level over the surface
        f.vy += (f.y > surf + 0.45 ? -3 : -0.6) * dt;
        f.y += f.vy * dt;
        y = Math.max(f.y, surf + 0.15);
        spread = 1;
        glided = true;
        if (f.glide <= 0) {
          f.gT = rand(1.5, 4);
          this.app.sim.addRipple(x, z, 0.04);
        }
      }
      f.g.position.set(x, y, z);
      f.g.rotation.set(0, this.dir > 0 ? 0 : Math.PI, f.glide > 0 ? 0.05 : Math.sin(time * 9 + f.off.x) * 0.05);
      f.wings.forEach((w) => (w.rotation.x = (1 - spread) * (w.scale.z > 0 ? 1.2 : -1.2)));
    }
    if (glided) this.behaviour('flyingGlide');
    return true;
  }
}

export function makeVisitor(id: VisitorId, app: App): Visitor {
  switch (id) {
    case 'turtle':
      return new Turtle(app);
    case 'manta':
      return new Manta(app);
    case 'dolphin':
      return new Dolphins(app);
    case 'whaleShark':
      return new WhaleShark(app);
    case 'seahorse':
      return new Seahorse(app);
    case 'cuttlefish':
      return new Cuttlefish(app);
    case 'moray':
      return new Moray(app);
    case 'flyingFish':
      return new FlyingFish(app);
  }
}
