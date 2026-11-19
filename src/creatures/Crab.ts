import * as THREE from 'three';
import { zClamp } from '../config';
import { clamp, rand } from '../util/math';
import { fbm3 } from '../util/noise';
import { patchMaterial } from '../util/shaders';
import { FoodState } from './FoodSystem';
import type { WorldContext } from './types';
import { buildClaw, buildEyeStalk, buildLeg, type Claw, type Leg } from './crabParts';
import { dryness, findWet, gateStep } from './shoreline';

type CrabState = 'idle' | 'walk' | 'forage' | 'eat' | 'flee' | 'alert' | 'dig' | 'shore' | 'buried';

/**
 * Seabed crab: faces the viewer and scuttles sideways. Toothed carapace with spots, jointed
 * 3-segment legs with an alternating gait, toothed chelae (one larger), stalked eyes and
 * antennae. States: idle (picking with claws), walk, forage sunken food, eat, dig in the sand,
 * go to the shore at low tide (intertidal zone), alert (claws raised) and flee.
 */
export class Crab {
  readonly group = new THREE.Group();
  readonly pos: THREE.Vector3;
  private body = new THREE.Group();
  private legs: Leg[] = [];
  private claws: Claw[] = [];
  state: CrabState = 'idle';
  private timer = rand(1, 3);
  private targetX = 0;
  private targetZ: number | null = null;
  private dir = 1;
  private gait = 0;
  private speed = 0;
  private food = -1;
  private digT = 0;
  private wet = { x: 0, z: 0 };
  private rescuing = false;
  active = true;
  readonly radius = 0.4;

  /** V2: where this crab forages at low tide (x0, x1, z0, z1); v1 crabs use the main island shore. */
  shore: [number, number, number, number] = [-13, -4, -3, 5];
  /** How far east a stranded crab may walk to reach water (v1: 18). */
  rescueMaxX = 18;

  constructor(private ctx: WorldContext, start: THREE.Vector3, private range: [number, number], private zRange: [number, number], hue = 0.03) {
    this.pos = start.clone();
    this.build(hue);
    this.group.add(this.body);
    this.group.scale.setScalar(1.15);
  }

  get label() {
    return (
      {
        idle: 'Picking at the sand',
        walk: 'Scuttling',
        forage: 'Heading for food',
        eat: 'Eating',
        flee: 'Fleeing',
        alert: 'Claws up!',
        dig: 'Digging',
        shore: 'Exploring the tide line',
        buried: 'Buried in the sand',
      } as Record<CrabState, string>
    )[this.state];
  }

  private build(hue: number) {
    const shell = new THREE.Color().setHSL(hue, 0.85, 0.48);
    const dark = new THREE.Color().setHSL(hue - 0.02, 0.75, 0.24);
    const pale = new THREE.Color().setHSL(hue + 0.06, 0.55, 0.78);
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }), { caustics: true, bump: { scale: 40, strength: 0.25 }, key: 'crab2' });
    const limbMat = patchMaterial(new THREE.MeshStandardMaterial({ color: shell.clone().offsetHSL(0, -0.05, 0.05), roughness: 0.45 }), { caustics: true, bump: { scale: 60, strength: 0.2 }, key: 'crablimb2' });
    const jointMat = new THREE.MeshStandardMaterial({ color: pale, roughness: 0.5 });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0x24160f, roughness: 0.3 });
    // carapace: wide oval, front edge with anterolateral teeth, spotted dome
    const cg = new THREE.SphereGeometry(1, 40, 20);
    const p = cg.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i),
        y = p.getY(i);
      const z = p.getZ(i);
      const ang = Math.atan2(z, x);
      const rim = 1 - Math.min(1, Math.abs(y) * 2.2);
      const front = Math.max(0, Math.sin(ang));
      const teeth = 0.07 * Math.pow(Math.max(0, Math.sin(ang * 9)), 3) * rim * front * (Math.abs(Math.cos(ang)) > 0.25 ? 1 : 0);
      const under = y < 0;
      y = under ? y * 0.45 : y * (0.9 + 0.1 * Math.cos(x * 1.5));
      x *= 1 + 0.15 * front;
      const bump = 0.035 * fbm3(x * 4, y * 4, z * 4, 2);
      const k = 1 + teeth + bump;
      p.setXYZ(i, x * 0.3 * k, y * 0.12, z * 0.22 * k);
      let c: THREE.Color;
      if (under) c = pale.clone();
      else {
        c = shell.clone();
        const spots = fbm3(x * 7, z * 7, 3.3, 2);
        if (spots > 0.15) c.lerp(dark, Math.min(1, (spots - 0.15) * 4));
        c.lerp(pale, rim * 0.25);
        c.multiplyScalar(0.92 + 0.15 * fbm3(x * 14, z * 14, 1, 1));
      }
      colors.set([c.r, c.g, c.b], i * 3);
    }
    cg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    cg.computeVertexNormals();
    const carapace = new THREE.Mesh(cg, mat);
    carapace.castShadow = true;
    carapace.position.y = 0.17;
    this.body.add(carapace);
    for (const s of [-1, 1]) {
      const e = buildEyeStalk(limbMat, 0.085);
      e.position.set(s * 0.06, 0.24, 0.17);
      e.rotation.z = -s * 0.22;
      this.body.add(e);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.004, 0.14, 4).translate(0, 0.07, 0), tipMat);
      ant.position.set(s * 0.025, 0.2, 0.2);
      ant.rotation.set(0.6, 0, -s * 0.5);
      this.body.add(ant);
    }
    for (const side of [-1, 1])
      for (let i = 0; i < 4; i++) {
        const leg = buildLeg(limbMat, jointMat, tipMat, 1.05);
        leg.pivot.position.set(side * 0.25, 0.15, 0.1 - i * 0.075);
        leg.pivot.rotation.order = 'YZX';
        leg.pivot.rotation.y = side > 0 ? (i - 1.5) * 0.45 : Math.PI - (i - 1.5) * 0.45;
        this.body.add(leg.pivot);
        this.legs.push({ ...leg, side, index: i });
      }
    for (const side of [-1, 1]) {
      const c = buildClaw(limbMat, jointMat, tipMat, side > 0 ? 1.3 : 1.0, side);
      c.arm.position.set(side * 0.17, 0.14, 0.16);
      this.body.add(c.arm);
      this.claws.push(c);
    }
  }

  reset(p: THREE.Vector3) {
    this.pos.copy(p);
    this.state = 'idle';
    this.timer = rand(1, 3);
    this.food = -1;
    this.targetZ = null;
    this.rescuing = false;
  }

  /** X range this crab patrols. */
  get homeRange(): [number, number] {
    return this.range;
  }
  /** Ocean Surprises: walk to (x, z) as if on an errand. */
  goTo(x: number, z: number, timer = 25) {
    this.state = 'walk';
    this.targetX = clamp(x, this.range[0], this.range[1]);
    this.targetZ = z;
    this.timer = timer;
    this.food = -1;
    this.rescuing = false;
  }
  get walking() {
    return this.state === 'walk' || this.state === 'flee';
  }

  private sink = 0;

  /** The pointer rests on it: claws up in a threat display, without running off. */
  display(_from: THREE.Vector3) {
    if (this.state !== 'idle' && this.state !== 'walk' && this.state !== 'forage' && this.state !== 'eat') return;
    this.state = 'alert';
    this.timer = 1.6;
    this.targetX = this.pos.x;
    this.targetZ = null;
  }

  /** Poked by the user: raise claws, then scuttle away — or, under water, dig in and wait. */
  poke(from: THREE.Vector3) {
    if (this.state !== 'buried' && this.ctx.water.level - this.pos.y > 0.15 && Math.random() < 0.4) {
      this.state = 'buried';
      this.timer = rand(5, 8);
      this.ctx.fx?.dust(this.pos.x, this.pos.y + 0.05, this.pos.z, 6);
      return;
    }
    this.state = 'alert';
    this.timer = 0.9;
    this.dir = from.x < this.pos.x ? 1 : -1;
    this.targetX = clamp(this.pos.x + this.dir * rand(1.5, 3), this.range[0], this.range[1]);
    this.targetZ = null;
    this.rescuing = false;
  }

  /** Something landed / moved nearby. */
  disturb(x: number, z: number, strength: number) {
    const d = Math.hypot(x - this.pos.x, (z - this.pos.z) * 0.6);
    if (d > 2.6 * strength || this.state === 'flee') return;
    this.state = d < 1.3 ? 'flee' : 'alert';
    this.dir = x < this.pos.x ? 1 : -1;
    this.targetX = clamp(this.pos.x + this.dir * rand(2, 3.5), this.range[0], this.range[1]);
    this.targetZ = null;
    this.timer = this.state === 'alert' ? rand(0.8, 1.5) : 3;
    this.rescuing = false;
  }

  /** Low tide: find a spot just below the waterline around the island (never on dry sand). */
  private pickShoreSpot(): boolean {
    for (let i = 0; i < 30; i++) {
      const x = rand(this.shore[0], this.shore[1]),
        z = rand(this.shore[2], this.shore[3]);
      const d = dryness(this.ctx, x, z);
      if (d < -0.05 && d > -0.5) {
        this.targetX = x;
        this.targetZ = z;
        return true;
      }
    }
    return false;
  }

  /** Walk back into water deep enough to stay submerged. */
  private headForWater() {
    if (!findWet(this.ctx, this.pos.x, this.pos.z, this.wet)) return;
    this.state = 'walk';
    this.targetX = this.wet.x;
    this.targetZ = this.wet.z;
    this.food = -1;
    this.timer = 25;
    this.rescuing = true;
  }

  update(dt: number, time: number) {
    const ctx = this.ctx;
    this.timer -= dt;
    const ox = this.pos.x,
      oz = this.pos.z;
    // stranded (tide went out, sand piled up, an island was stamped here): go back to the water
    if (dryness(ctx, ox, oz) > 0) {
      if (!(this.rescuing && this.state === 'walk') && this.state !== 'alert') this.headForWater();
    } else if (this.rescuing && this.state !== 'walk') this.rescuing = false;
    let walking = false;
    let speedTarget = 0;
    let clawLift = 0;
    let pick = 0;
    let crouch = 0;
    const level = ctx.water.level;
    switch (this.state) {
      case 'idle': {
        pick = 0.5 + 0.5 * Math.sin(time * 4.5);
        if (this.timer <= 0) {
          const r = Math.random();
          if (level < -0.35 && r < 0.45 && this.pickShoreSpot()) {
            this.state = 'shore';
            this.timer = 30;
          } else if (r < 0.62) {
            this.state = 'dig';
            this.timer = rand(2.5, 4);
          } else {
            this.state = 'walk';
            this.targetX = rand(this.range[0], this.range[1]);
            this.targetZ = rand(this.zRange[0], this.zRange[1]);
            this.timer = 14;
          }
        }
        this.lookForFood();
        break;
      }
      case 'dig': {
        pick = 0.5 + 0.5 * Math.sin(time * 11);
        crouch = 1;
        this.digT -= dt;
        if (this.digT <= 0) {
          this.digT = 0.35;
          ctx.fx?.dust(this.pos.x + rand(-0.15, 0.15), this.pos.y + 0.05, this.pos.z + 0.25, 2);
        }
        if (this.timer <= 0) {
          this.state = 'idle';
          this.timer = rand(2, 5);
        }
        break;
      }
      case 'buried': {
        // only the eyes stay above the sand
        crouch = 1;
        if (this.timer <= 0) {
          this.state = 'idle';
          this.timer = rand(2, 4);
        }
        break;
      }
      case 'alert': {
        clawLift = 1;
        if (this.timer <= 0) {
          this.state = 'walk';
          this.timer = 6;
        }
        break;
      }
      case 'walk':
      case 'flee':
      case 'forage':
      case 'shore': {
        if (this.state === 'forage') {
          if (this.food < 0 || ctx.food.state[this.food] !== FoodState.Settled) {
            this.state = 'idle';
            this.timer = rand(1, 2);
            break;
          }
          this.targetX = ctx.food.pos[this.food * 3];
          this.targetZ = ctx.food.pos[this.food * 3 + 2];
        }
        const dx = this.targetX - this.pos.x;
        this.dir = Math.sign(dx) || 1;
        const dz = this.targetZ !== null ? this.targetZ - this.pos.z : 0;
        walking = Math.abs(dx) > 0.08 || Math.abs(dz) > 0.12;
        speedTarget = this.state === 'flee' ? 1.6 : this.state === 'forage' ? 0.75 : 0.5;
        clawLift = this.state === 'flee' ? 0.7 : 0;
        if (this.targetZ !== null) this.pos.z += clamp(dz, -1, 1) * dt * 0.7;
        const ahead = this.pos.x + this.dir * 0.45;
        for (const o of ctx.obstacles()) {
          if (o.center.y - o.radius > this.pos.y + 0.4) continue;
          if (Math.hypot(ahead - o.center.x, this.pos.z - o.center.z) < o.radius * 0.85 + 0.15) {
            if (this.state === 'walk' || this.state === 'flee') {
              this.targetX = clamp(this.pos.x - this.dir * rand(1, 2.5), this.range[0], this.range[1]);
              this.dir = -this.dir;
            } else this.pos.z += (this.pos.z > o.center.z ? 1 : -1) * dt * 0.8;
            break;
          }
        }
        if (!walking) {
          if (this.state === 'forage') {
            this.state = 'eat';
            this.ctx.sight?.('crabForage', this.pos);
            this.timer = 2.2;
          } else {
            this.state = this.state === 'shore' ? 'dig' : 'idle';
            this.timer = this.state === 'dig' ? rand(2.5, 4) : rand(2, 6);
          }
        } else if (this.state === 'walk') this.lookForFood();
        if (this.timer <= 0 && this.state !== 'forage') {
          this.state = 'idle';
          this.timer = rand(2, 5);
        }
        break;
      }
      case 'eat': {
        pick = 0.5 + 0.5 * Math.sin(time * 9);
        if (this.timer <= 0) {
          if (this.food >= 0 && ctx.food.state[this.food] === FoodState.Settled) ctx.food.consume(this.food);
          this.food = -1;
          this.state = 'idle';
          this.timer = rand(2, 4);
        }
        break;
      }
    }
    // the tide came back in: wander home from the shore
    if (this.pos.x < this.range[0] - 0.5 && this.state === 'idle' && level > -0.25) {
      this.state = 'walk';
      this.targetX = rand(this.range[0], this.range[1]);
      this.targetZ = rand(this.zRange[0], this.zRange[1]);
      this.timer = 25;
    }
    this.speed += (speedTarget - this.speed) * Math.min(1, dt * 5);
    if (walking) {
      this.pos.x += this.dir * Math.min(Math.abs(this.targetX - this.pos.x) / Math.max(dt, 1e-3), this.speed) * dt;
      this.gait += dt * Math.max(this.speed, 0.3) * 22;
    }
    // (v1 crabs: shore box x -13 … -4 gives the original -14 / 18 limits)
    const xmin = this.state === 'shore' || this.rescuing || this.pos.x < this.range[0] ? Math.min(this.shore[0] - 1, this.range[0]) : this.range[0];
    const xmax = this.rescuing ? this.rescueMaxX : Math.max(this.range[1], ox);
    this.pos.x = clamp(this.pos.x, xmin, xmax);
    this.pos.z = zClamp(this.pos.z, 0.8);
    // never step out of the water
    if (gateStep(ctx, this.pos, ox, oz)) {
      walking = false;
      if (this.state === 'walk' || this.state === 'flee' || this.state === 'shore' || this.state === 'forage') {
        this.state = 'idle';
        this.food = -1;
        this.timer = rand(0.8, 2);
      }
    }
    if (this.rescuing && this.state === 'walk' && !walking) this.rescuing = false;
    this.pos.y = ctx.terrain.heightAt(this.pos.x, this.pos.z);

    // ---- pose
    this.sink += ((this.state === 'buried' ? 1 : 0) - this.sink) * Math.min(1, dt * (this.state === 'buried' ? 3 : 1.2));
    this.group.position.copy(this.pos);
    this.group.position.y -= this.sink * 0.12;
    const n = ctx.terrain.normalAt(this.pos.x, this.pos.z);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    this.body.position.y = 0.02 * Math.abs(Math.sin(this.gait * 0.5)) * (walking ? 1 : 0) - crouch * 0.04;
    this.body.rotation.x = crouch * 0.18;
    this.body.rotation.z = walking ? Math.sin(this.gait * 0.5) * 0.04 : 0;
    for (const L of this.legs) {
      const phase = this.gait + L.index * Math.PI * 0.5 + (L.side > 0 ? Math.PI : 0);
      const lift = walking ? Math.max(0, Math.sin(phase)) * 0.35 : 0;
      L.pivot.rotation.z = 0.5 + lift;
      L.pivot.rotation.x = walking ? Math.cos(phase) * 0.15 : 0;
      L.knee.rotation.z = -1.0 - lift * 0.4;
      L.ankle.rotation.z = -0.55 + lift * 0.2;
    }
    for (const c of this.claws) {
      const raise = clawLift * 0.9 + (c.side > 0 ? pick : 1 - pick) * (0.35 + crouch * 0.25);
      c.arm.rotation.x = -raise * 0.9 + 0.25 + crouch * 0.35;
      c.finger.rotation.x = clawLift > 0.5 ? 0.3 + 0.25 * Math.sin(time * 10) : 0.15 * pick;
    }
  }

  private lookForFood() {
    const idx = this.ctx.food.nearest(this.pos.x, this.pos.y, this.pos.z, 4.5, true, true);
    if (idx >= 0 && dryness(this.ctx, this.ctx.food.pos[idx * 3], this.ctx.food.pos[idx * 3 + 2]) < 0) {
      this.food = idx;
      this.state = 'forage';
      this.timer = 20;
    }
  }
}
