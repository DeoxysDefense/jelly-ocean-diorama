import * as THREE from 'three';
import { zClamp } from '../config';
import { clamp, rand } from '../util/math';
import { patchMaterial } from '../util/shaders';
import { Reef, type Selectable } from '../world/Reef';
import { buildClaw, buildEyeStalk, buildLeg, type Claw, type Leg } from './crabParts';
import type { WorldContext } from './types';
import { dryness, findWet, gateStep } from './shoreline';

type HermitState = 'wander' | 'pause' | 'hide' | 'approach' | 'inspect' | 'switch';

/**
 * Hermit crab carrying a spiral shell. It ambles over the seabed, retreats into its shell when
 * disturbed, and now and then goes house-hunting: it walks to an empty shell (the ones on the
 * reef or any the user places), inspects it, then swaps — leaving its old shell behind as a
 * new empty shell. Rare by design, so it feels like a small discovery.
 */
export class HermitCrab {
  readonly group = new THREE.Group();
  readonly pos: THREE.Vector3;
  private shellHolder = new THREE.Group();
  private pitch = new THREE.Group();
  private front = new THREE.Group();
  private shellMesh: THREE.Mesh;
  private legs: Leg[] = [];
  private claws: Claw[] = [];
  state: HermitState = 'wander';
  private timer = rand(3, 6);
  private yaw = rand(0, Math.PI * 2);
  private yawT = this.yaw;
  private target = new THREE.Vector3();
  private gait = 0;
  private houseHunt = rand(25, 50);
  private shellSeed: number;
  private targetShell: Selectable | null = null;
  private tuck = 0;
  private wet = { x: 0, z: 0 };
  private rescuing = false;
  active = true;
  readonly radius = 0.3;

  constructor(private ctx: WorldContext, start: THREE.Vector3, seed: number) {
    this.pos = start.clone();
    this.shellSeed = seed;
    const reef = ctx.reef;
    this.shellMesh = new THREE.Mesh(Reef.shellGeometry(seed).geo, reef.shellMaterial);
    this.shellMesh.castShadow = true;
    this.shellMesh.scale.setScalar(1.55);
    this.shellHolder.add(this.shellMesh);
    this.pitch.add(this.shellHolder);
    this.group.add(this.pitch);
    this.orientShell();

    const limb = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xc8463a, roughness: 0.45 }), { caustics: true, bump: { scale: 60, strength: 0.2 }, key: 'hermit' });
    const joint = new THREE.MeshStandardMaterial({ color: 0xf0d0a0, roughness: 0.5 });
    const tip = new THREE.MeshStandardMaterial({ color: 0x2a1610, roughness: 0.3 });
    // front cluster pokes out of the aperture (facing local +x)
    this.front.position.set(0.24, 0.12, 0.02);
    for (const s of [-1, 1]) {
      const e = buildEyeStalk(limb, 0.07);
      e.position.set(0.05, 0.05, s * 0.03);
      e.rotation.z = -0.4;
      e.rotation.x = s * 0.25;
      this.front.add(e);
    }
    for (const side of [-1, 1]) {
      const c = buildClaw(limb, joint, tip, side > 0 ? 0.95 : 0.65, side);
      c.arm.position.set(0.03, 0.0, side * 0.05);
      c.arm.rotation.y = Math.PI / 2 - side * 0.25;
      this.front.add(c.arm);
      this.claws.push(c);
    }
    for (const side of [-1, 1])
      for (let i = 0; i < 2; i++) {
        const leg = buildLeg(limb, joint, tip, 0.7);
        leg.pivot.position.set(-0.02 - i * 0.05, -0.02, side * 0.06);
        leg.pivot.rotation.order = 'YZX';
        leg.pivot.rotation.y = side > 0 ? -1.2 + i * 0.5 : Math.PI + 1.2 - i * 0.5;
        this.front.add(leg.pivot);
        this.legs.push({ ...leg, side, index: i });
      }
    this.group.add(this.front);
    this.front.position.y = this.apertureAt.y;
    this.group.scale.setScalar(1.1);
    this.pickWander();
  }

  /** Where the shell opening sits in the crab's local space (the front cluster pokes out here). */
  private apertureAt = new THREE.Vector3(0.12, 0.12, 0);

  /**
   * Carry the shell the way real hermit crabs do: opening facing forward and a little down,
   * spire up and back, resting on the sand. Uses the aperture frame the shell builder records,
   * so it works for every shell shape it may swap into.
   */
  private orientShell() {
    const geo = this.shellMesh.geometry;
    const ap = geo.userData.aperture as { c: THREE.Vector3; n: THREE.Vector3; axis: THREE.Vector3 } | undefined;
    const S = this.shellMesh.scale.x;
    const q = new THREE.Quaternion();
    if (ap) {
      const n = ap.n.clone();
      const a = ap.axis.clone().addScaledVector(n, -ap.axis.dot(n)).normalize();
      const from = new THREE.Matrix4().makeBasis(n, a, new THREE.Vector3().crossVectors(n, a));
      const D = new THREE.Vector3(1, -0.3, 0).normalize();
      const U = new THREE.Vector3(-0.7, 1, 0);
      U.addScaledVector(D, -U.dot(D)).normalize();
      const to = new THREE.Matrix4().makeBasis(D, U, new THREE.Vector3().crossVectors(D, U));
      q.setFromRotationMatrix(to.multiply(from.transpose()));
    }
    this.shellHolder.quaternion.copy(q);
    // rest the lowest point of the shell on the sand, with the opening just behind the front cluster
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    let minY = Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).multiplyScalar(S).applyQuaternion(q);
      minY = Math.min(minY, v.y);
    }
    const c = (ap ? ap.c.clone() : new THREE.Vector3()).multiplyScalar(S).applyQuaternion(q);
    // box corners overestimate the depth a little; let the shell settle slightly into the sand
    const lift = -minY * 0.8;
    this.shellHolder.position.set(0.1 - c.x, lift, -c.z);
    this.pitch.position.set(0, 0, 0);
    this.pitch.rotation.set(0, 0, 0);
    this.apertureAt.set(0.1, lift + c.y, 0);
    this.front.position.y = this.apertureAt.y;
  }

  get label() {
    return (
      {
        wander: 'Ambling about',
        pause: 'Taking a rest',
        hide: 'Hiding in its shell',
        approach: 'House-hunting',
        inspect: 'Inspecting a shell',
        switch: 'Moving into a new shell!',
      } as Record<HermitState, string>
    )[this.state];
  }

  private pickWander() {
    for (let i = 0; i < 8; i++) {
      this.target.set(clamp(this.pos.x + rand(-3, 3), -2, 10), 0, clamp(this.pos.z + rand(-2, 2), 0.5, 5));
      if (dryness(this.ctx, this.target.x, this.target.z) < 0) break;
    }
    this.timer = rand(6, 12);
  }

  reset(p: THREE.Vector3) {
    this.pos.copy(p);
    this.state = 'wander';
    this.targetShell = null;
    this.rescuing = false;
    this.houseHunt = rand(25, 50);
    this.pickWander();
  }

  disturb(x: number, z: number, strength: number) {
    if (Math.hypot(x - this.pos.x, z - this.pos.z) > 2.2 * strength) return;
    this.state = 'hide';
    this.timer = rand(4, 8);
  }

  poke() {
    this.state = 'hide';
    this.timer = rand(4, 7);
  }

  private findShell(): Selectable | null {
    const shells = this.ctx.reef.emptyShells();
    let best: Selectable | null = null,
      bd = 9;
    for (const s of shells) {
      if (dryness(this.ctx, s.object.position.x, s.object.position.z) > 0) continue; // shells on dry sand are out of reach
      const d = s.object.position.distanceTo(this.pos) - (s.user ? 3 : 0); // freshly placed shells are tempting
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** The swap: drop the old shell as a new empty shell, take the target's shape. */
  private swapShell() {
    const t = this.targetShell;
    const reef = this.ctx.reef;
    if (!t || !reef.selectables.includes(t)) return;
    const oldSeed = this.shellSeed;
    const newSeed = t.seed ?? Math.floor(Math.random() * 1e6);
    const at = this.pos.clone().add(new THREE.Vector3(-Math.cos(this.yaw) * 0.45, 0, Math.sin(this.yaw) * 0.45));
    reef.detach(t);
    // the empty shell it moved out of is gone for good (no undo entry): free its GPU buffers
    t.object.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
    reef.createObject('shell', at.x, at.z, oldSeed);
    this.shellSeed = newSeed;
    const oldGeo = this.shellMesh.geometry;
    this.shellMesh.geometry = Reef.shellGeometry(newSeed).geo;
    oldGeo.dispose();
    this.orientShell();
    this.ctx.fx?.dust(this.pos.x, this.pos.y + 0.05, this.pos.z, 6);
    this.ctx.fx?.bubbles(this.pos.x, this.pos.y + 0.2, this.pos.z, 4);
  }

  update(dt: number, time: number) {
    const ctx = this.ctx;
    this.timer -= dt;
    this.houseHunt -= dt;
    let walking = false;
    let speed = 0.16;
    let tuckT = 0;
    const ox = this.pos.x,
      oz = this.pos.z;
    // stranded by the tide / sand / a stamped island: walk back into the water
    if (dryness(ctx, ox, oz) > 0) {
      if (!(this.rescuing && this.state === 'wander') && this.state !== 'hide' && findWet(ctx, ox, oz, this.wet, 10)) {
        this.rescuing = true;
        this.targetShell = null;
        this.state = 'wander';
        this.target.set(this.wet.x, 0, this.wet.z);
        this.timer = 40;
      }
    } else if (this.rescuing && this.state !== 'wander') this.rescuing = false;
    switch (this.state) {
      case 'wander': {
        const to = this.target.clone().sub(this.pos).setY(0);
        if (to.length() < 0.2 || this.timer <= 0) {
          this.state = 'pause';
          this.timer = rand(2, 6);
        } else {
          walking = true;
          this.yawT = Math.atan2(-to.z, to.x);
        }
        const recent = ctx.reef.recentPlacement(20);
        if (this.houseHunt <= 0 || (recent && recent.habitat === 'shell' && recent.object.position.distanceTo(this.pos) < 9)) {
          this.houseHunt = rand(60, 120);
          const s = this.findShell();
          if (s && (s.user || Math.random() < 0.6)) {
            this.targetShell = s;
            this.state = 'approach';
            this.timer = 40;
          }
        }
        break;
      }
      case 'pause':
        if (this.timer <= 0) {
          this.state = 'wander';
          this.pickWander();
        }
        break;
      case 'hide':
        tuckT = 1;
        if (this.timer <= 0) {
          this.state = 'wander';
          this.pickWander();
        }
        break;
      case 'approach': {
        const t = this.targetShell;
        if (!t || !ctx.reef.selectables.includes(t) || this.timer <= 0) {
          this.state = 'wander';
          this.targetShell = null;
          this.pickWander();
          break;
        }
        const to = t.object.position.clone().sub(this.pos).setY(0);
        if (to.length() < 0.5) {
          this.state = 'inspect';
          this.timer = rand(2.5, 4);
        } else {
          walking = true;
          speed = 0.22;
          this.yawT = Math.atan2(-to.z, to.x);
        }
        break;
      }
      case 'inspect':
        // turn back and forth, feel the shell with the claws
        this.yawT += Math.sin(time * 3) * 0.02;
        if (this.timer <= 0) {
          if (Math.random() < 0.8) {
            this.state = 'switch';
            this.timer = 1.4;
          } else {
            this.state = 'wander';
            this.targetShell = null;
            this.pickWander();
          }
        }
        break;
      case 'switch':
        tuckT = this.timer > 0.7 ? 1 : 0;
        if (this.timer <= 0.7 && this.targetShell) {
          this.swapShell();
          this.targetShell = null;
        }
        if (this.timer <= 0) {
          this.state = 'pause';
          this.timer = rand(3, 5);
        }
        break;
    }
    this.tuck += (tuckT - this.tuck) * Math.min(1, dt * 6);
    let dy = this.yawT - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 2.5);
    if (walking && this.tuck < 0.3) {
      this.pos.x += Math.cos(this.yaw) * speed * dt;
      this.pos.z -= Math.sin(this.yaw) * speed * dt;
      this.gait += dt * 14;
      for (const o of ctx.obstacles()) {
        if (this.targetShell && o.center.distanceTo(this.targetShell.object.position) < 0.5) continue;
        const dx = this.pos.x - o.center.x,
          dz = this.pos.z - o.center.z;
        const d = Math.hypot(dx, dz);
        const r = o.radius * 0.8 + 0.2;
        if (d < r && d > 1e-3) {
          this.pos.x += (dx / d) * (r - d);
          this.pos.z += (dz / d) * (r - d);
        }
      }
    }
    this.pos.x = clamp(this.pos.x, -14, 18);
    this.pos.z = zClamp(this.pos.z, 0.8);
    // never step out of the water
    if (gateStep(ctx, this.pos, ox, oz)) {
      walking = false;
      if (this.state === 'approach') this.targetShell = null;
      if (this.state === 'wander' || this.state === 'approach') {
        this.state = 'pause';
        this.timer = rand(1, 2.5);
      }
    }
    this.pos.y = ctx.terrain.heightAt(this.pos.x, this.pos.z);

    this.group.position.copy(this.pos);
    const n = ctx.terrain.normalAt(this.pos.x, this.pos.z);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw));
    this.pitch.rotation.z = walking ? Math.sin(this.gait * 0.5) * 0.05 : 0; // shell rocks as it walks
    const out = 1 - this.tuck * 0.85;
    this.front.scale.setScalar(Math.max(0.05, out));
    this.front.position.x = this.apertureAt.x + 0.02 + 0.12 * out;
    for (const L of this.legs) {
      const ph = this.gait + L.index * Math.PI + (L.side > 0 ? Math.PI / 2 : 0);
      const lift = walking ? Math.max(0, Math.sin(ph)) * 0.4 : 0;
      L.pivot.rotation.z = 0.15 + lift;
      L.knee.rotation.z = -1.25 - lift * 0.3;
      L.ankle.rotation.z = -0.5;
    }
    for (const c of this.claws) {
      const feel = this.state === 'inspect' ? 0.5 + 0.5 * Math.sin(time * 6 + c.side) : 0;
      c.arm.rotation.x = -0.2 - feel * 0.5;
      c.finger.rotation.x = 0.15 + feel * 0.3;
    }
  }
}
