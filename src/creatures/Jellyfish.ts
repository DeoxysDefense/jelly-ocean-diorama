import * as THREE from 'three';
import { CONFIG, zClamp } from '../config';
import { rand } from '../util/math';
import { lathe } from '../util/geometry';
import { shared } from '../util/shaders';
import type { WorldContext } from './types';

const TENTACLES = 22;
const SEG = 12;

/**
 * Moon-jelly style medusa: translucent pulsing bell, glowing gonads, frilly oral arms and
 * thin trailing tentacles that lag behind the bell. Moves only by pulse thrust + drift, never
 * chases food, and keeps clear of terrain and the surface.
 */
export class Jellyfish {
  readonly group = new THREE.Group();
  readonly pos: THREE.Vector3;
  private vel = new THREE.Vector3();
  private axis = new THREE.Vector3(0, 1, 0);
  private desiredAxis = new THREE.Vector3(0, 1, 0);
  private bell: THREE.Mesh;
  private bellMat!: THREE.MeshPhysicalMaterial;
  private baseEmissive = new THREE.Color();
  private glow = 0;
  /** 0..1 night factor: soft bioluminescence. */
  nightGlow = 0;
  active = true;
  private fv = new THREE.Vector3();
  private inner: THREE.Group;
  private arms: THREE.Mesh[] = [];
  private tentacles: THREE.LineSegments;
  private tentPts: THREE.Vector3[][] = [];
  private pulseT: number;
  private period: number;
  private wanderT = 0;
  readonly radius = 0.45;
  private size: number;

  constructor(private ctx: WorldContext, private id: number, start: THREE.Vector3, hue: number) {
    this.pos = start.clone();
    this.size = rand(0.85, 1.15);
    this.period = rand(1.6, 2.4);
    this.pulseT = rand(0, this.period);
    const tint = new THREE.Color().setHSL(hue, 0.55, 0.78);
    const bellGeo = lathe(
      [
        [0.001, 0.34],
        [0.12, 0.33],
        [0.22, 0.28],
        [0.3, 0.19],
        [0.34, 0.08],
        [0.345, 0.0],
        [0.32, -0.025],
        [0.25, 0.02],
        [0.12, 0.07],
        [0.001, 0.08],
      ],
      40,
      (a, t) => 1 + (t > 0.5 && t < 0.75 ? 0.035 * Math.sin(a * 16) : 0),
    );
    const bellMat = new THREE.MeshPhysicalMaterial({
      color: tint,
      transparent: true,
      opacity: 0.42,
      roughness: 0.15,
      metalness: 0,
      emissive: tint.clone().multiplyScalar(0.25),
      side: THREE.DoubleSide,
      depthWrite: false,
      sheen: 1,
      sheenColor: new THREE.Color(1, 1, 1),
    });
    this.bellMat = bellMat;
    this.baseEmissive = bellMat.emissive.clone();
    this.bell = new THREE.Mesh(bellGeo, bellMat);
    this.bell.renderOrder = 6;
    this.group.add(this.bell);

    this.inner = new THREE.Group();
    const gonMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL((hue + 0.92) % 1, 0.7, 0.62),
      emissive: new THREE.Color().setHSL((hue + 0.92) % 1, 0.8, 0.3),
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.TorusGeometry(0.075, 0.018, 6, 16, Math.PI * 1.4);
      const m = new THREE.Mesh(g, gonMat);
      m.rotation.x = Math.PI / 2;
      m.rotation.z = (i / 4) * Math.PI * 2;
      m.position.set(Math.cos((i / 4) * Math.PI * 2) * 0.09, 0.15, Math.sin((i / 4) * Math.PI * 2) * 0.09);
      m.renderOrder = 5;
      this.inner.add(m);
    }
    this.group.add(this.inner);

    // frilly oral arms
    const armMat = new THREE.MeshStandardMaterial({
      color: tint.clone().offsetHSL(0, 0.1, -0.05),
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.3,
    });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.PlaneGeometry(0.07, 0.62, 2, 14);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k);
        const t = (0.31 - y) / 0.62;
        p.setX(k, p.getX(k) * (1 - t * 0.5) + Math.sin(y * 30) * 0.015 * t);
        p.setZ(k, Math.sin(y * 22 + i) * 0.02 * (0.3 + t));
      }
      g.translate(0, -0.31 + 0.04, 0);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, armMat);
      m.rotation.y = (i / 4) * Math.PI + 0.3;
      m.renderOrder = 5;
      this.arms.push(m);
      this.group.add(m);
    }

    // tentacles: polylines updated on the CPU with trailing lag
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TENTACLES * SEG * 2 * 3), 3));
    const lineMat = new THREE.LineBasicMaterial({ color: tint.clone().offsetHSL(0, 0, 0.08), transparent: true, opacity: 0.55, depthWrite: false });
    this.tentacles = new THREE.LineSegments(lineGeo, lineMat);
    this.tentacles.frustumCulled = false;
    this.tentacles.renderOrder = 4;
    for (let t = 0; t < TENTACLES; t++) {
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s < SEG; s++) pts.push(this.pos.clone().add(new THREE.Vector3(0, -s * 0.06, 0)));
      this.tentPts.push(pts);
    }
    this.group.scale.setScalar(this.size);
  }

  /** Pointer hovers nearby: brief soft glow. */
  glowUp(amount = 0.5) {
    this.glow = Math.min(1, Math.max(this.glow, amount));
  }

  /** Poked: glow, pulse right away and drift away from the poke. */
  poke(from: THREE.Vector3) {
    this.glowUp(1);
    this.pulseT = this.period * 0.98;
    this.vel.add(this.pos.clone().sub(from).setY(0.3).normalize().multiplyScalar(0.35));
  }

  /** World-space tentacle object (not scaled by the group). */
  get tentacleObject() {
    return this.tentacles;
  }

  reset(p: THREE.Vector3) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    for (const pts of this.tentPts) pts.forEach((q, s) => q.copy(p).add(new THREE.Vector3(0, -s * 0.06, 0)));
  }

  update(dt: number, time: number) {
    const ctx = this.ctx;
    // ---- pulse cycle: fast contraction, slow relaxation
    this.pulseT += dt;
    if (this.pulseT > this.period) {
      this.pulseT -= this.period;
      this.period = rand(1.5, 2.5);
    }
    const ph = this.pulseT / this.period;
    const contract = ph < 0.22 ? Math.sin((ph / 0.22) * Math.PI * 0.5) : Math.cos(((ph - 0.22) / 0.78) * Math.PI * 0.5);
    const c = Math.max(0, contract);
    this.bell.scale.set(1 - 0.17 * c, 1 + 0.12 * c, 1 - 0.17 * c);
    this.inner.scale.set(1 - 0.1 * c, 1 + 0.06 * c, 1 - 0.1 * c);
    if (ph < 0.22) this.vel.addScaledVector(this.axis, dt * 1.35 * this.size);

    // ---- steering: tilt the bell axis toward a desired direction
    this.wanderT -= dt;
    const ground = ctx.terrain.heightAt(this.pos.x, this.pos.z);
    const surf = ctx.water.heightAt(this.pos.x, this.pos.z);
    if (this.wanderT <= 0) {
      this.wanderT = rand(3, 7);
      this.desiredAxis.set(rand(-0.5, 0.5), 1, rand(-0.3, 0.3)).normalize();
    }
    const want = this.desiredAxis.clone();
    if (this.pos.y < ground + 1.8) want.set(want.x * 0.3, 1, want.z * 0.3);
    if (this.pos.y > surf - 1.0) want.set(want.x * 2, -0.3, want.z).normalize();
    if (Math.abs(this.pos.x) > 18) want.x -= Math.sign(this.pos.x) * 0.8;
    if (this.pos.z > CONFIG.world.zFront - 1.8) want.z -= 0.5;
    if (this.pos.z < CONFIG.world.zBack + 1.8) want.z += 0.5;
    // land (main island or a freshly stamped islet): steer down the terrain slope toward deep water
    const depth = surf - ground;
    const ahead = ctx.terrain.heightAt(this.pos.x + this.vel.x, this.pos.z + this.vel.z);
    if (depth < 2.6 || ahead > this.pos.y - 1.0) {
      let gx = 0,
        gz = 0,
        gl = 0;
      // fine slope first; on a flat islet top widen the probe until it reaches the shore
      for (const e of [0.6, 2.0, 4.0]) {
        gx = ctx.terrain.heightAt(this.pos.x + e, this.pos.z) - ctx.terrain.heightAt(this.pos.x - e, this.pos.z);
        gz = ctx.terrain.heightAt(this.pos.x, this.pos.z + e) - ctx.terrain.heightAt(this.pos.x, this.pos.z - e);
        gl = Math.hypot(gx, gz);
        if (gl > 1e-3) break;
      }
      if (gl <= 1e-3) {
        gx = Math.sin(this.id * 2.4);
        gz = Math.cos(this.id * 2.4);
        gl = 1;
      }
      {
        want.x -= (gx / gl) * 0.9;
        want.z -= (gz / gl) * 0.5;
        // stranded in the shallows (e.g. an island rose underneath): drift out bodily, not only by steering
        if (depth < 1.6) {
          const push = (1.6 - Math.max(0, depth)) * 1.8 * dt;
          this.vel.x -= (gx / gl) * push;
          this.vel.z -= (gz / gl) * push;
        }
      }
    }
    want.normalize();
    this.axis.lerp(want, Math.min(1, dt * 0.4)).normalize();

    // ---- physics: drag, slight negative buoyancy, gentle current drift
    const wind = shared.uWind.value;
    this.vel.y -= 0.035 * dt;
    this.vel.x += (Math.sin(time * 0.11 + this.id * 2.1) * 0.05 + wind * 0.03 * (0.6 + 0.4 * Math.sin(this.id))) * dt;
    for (const o of ctx.obstacles()) {
      const d = this.pos.distanceTo(o.center);
      if (d < o.radius + 0.6) this.vel.add(this.pos.clone().sub(o.center).normalize().multiplyScalar(dt * 0.8));
    }
    if (ctx.flow.active) this.vel.addScaledVector(ctx.flow.velocityAt(this.pos.x, this.pos.y, this.pos.z, this.fv), dt * 0.8);
    this.vel.multiplyScalar(Math.exp(-1.6 * dt));
    this.pos.addScaledVector(this.vel, dt);
    this.pos.z = zClamp(this.pos.z, 1.4);
    // stay submerged: the surface limit wins over the floor limit when the water is shallow
    const g2 = ctx.terrain.heightAt(this.pos.x, this.pos.z);
    const s2 = ctx.water.heightAt(this.pos.x, this.pos.z);
    this.pos.y = Math.min(Math.max(this.pos.y, g2 + 0.9), s2 - 0.45);
    // bioluminescent response (hover / poke)
    this.glow = Math.max(0, this.glow - dt * 0.6);
    this.bellMat.emissive.copy(this.baseEmissive).multiplyScalar(1 + this.glow * 5 + this.nightGlow * 3.5);
    this.bellMat.opacity = 0.42 + this.nightGlow * 0.15;

    // ---- transform
    this.group.position.copy(this.pos);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.axis);
    this.arms.forEach((a, i) => {
      a.rotation.x = Math.sin(time * 0.9 + i * 1.3) * 0.12;
      a.rotation.z = Math.sin(time * 0.7 + i) * 0.1;
    });

    // ---- tentacles: rim anchors, verlet-like follow with sway
    const posAttr = this.tentacles.geometry.attributes.position as THREE.BufferAttribute;
    const rimR = 0.31 * this.size * (1 - 0.17 * c);
    const q = this.group.quaternion;
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
    let w = 0;
    for (let t = 0; t < TENTACLES; t++) {
      const a = (t / TENTACLES) * Math.PI * 2;
      const anchor = new THREE.Vector3(Math.cos(a) * rimR, -0.01, Math.sin(a) * rimR).applyQuaternion(q).add(this.pos);
      const pts = this.tentPts[t];
      pts[0].copy(anchor);
      const segLen = 0.065 * this.size * (0.8 + 0.4 * ((t * 7) % 5) / 5);
      for (let s = 1; s < SEG; s++) {
        const p = pts[s];
        // gravity-ish trailing + sway
        p.addScaledVector(down, dt * 0.25);
        p.x += Math.sin(time * 1.3 + s * 0.6 + t) * 0.002;
        p.z += Math.cos(time * 1.1 + s * 0.5 + t * 1.3) * 0.002;
        const prev = pts[s - 1];
        const dir = p.clone().sub(prev);
        const l = dir.length() || 1;
        p.copy(prev).addScaledVector(dir, segLen / l);
        posAttr.setXYZ(w++, prev.x, prev.y, prev.z);
        posAttr.setXYZ(w++, p.x, p.y, p.z);
      }
    }
    posAttr.needsUpdate = true;
  }
}
