import * as THREE from 'three';
import { zClamp } from '../config';
import { makeSoftDot } from '../util/textures';
import { pointScale } from '../world/Particles';
import type { WaterSurfaceSimulation } from '../water/WaterSurfaceSimulation';
import type { TerrainSystem } from '../world/TerrainSystem';
import type { FlowField } from '../world/FlowField';

/** A small object riding the shared water surface (bottle, coconut, leaf, stone remains). */
export interface FloatBody {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** How deep it sits below the surface. */
  draft: number;
  yaw: number;
  spin: number;
  /** 0..1: how strongly it follows the wave slope (light objects tilt more). */
  tilt: number;
}

const tmpN = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const fv = new THREE.Vector3();

/**
 * Same buoyancy model as the ambient floaters: bob on W(x, z, t), slide down wave faces, drift
 * with wind and painted currents, and get pushed back from beaches and islands (never through
 * land). Returns true when it touched shallow ground this step.
 */
export function floatStep(b: FloatBody, water: WaterSurfaceSimulation, terrain: TerrainSystem, flow: FlowField, dt: number, wind: number, obj?: THREE.Object3D, drift = 0.22) {
  const p = b.pos;
  const e = 0.18;
  const hx = (water.heightAt(p.x + e, p.z) - water.heightAt(p.x - e, p.z)) / (2 * e);
  const hz = (water.heightAt(p.x, p.z + e) - water.heightAt(p.x, p.z - e)) / (2 * e);
  b.vel.x += (-hx * 1.6 + wind * drift) * dt;
  b.vel.z += -hz * 1.6 * dt;
  if (flow.active) {
    const fl = flow.velocityAt(p.x, water.level - 0.2, p.z, fv);
    b.vel.x += (fl.x - b.vel.x) * Math.min(1, dt * 1.5);
    b.vel.z += (fl.z - b.vel.z) * Math.min(1, dt * 1.5);
  }
  b.vel.multiplyScalar(Math.exp(-dt * 0.6));
  let beached = false;
  const ahead = terrain.heightAt(p.x + b.vel.x * 0.4, p.z + b.vel.z * 0.4);
  if (ahead > water.heightAt(p.x, p.z) - 0.2) {
    beached = true;
    const gx = terrain.heightAt(p.x + 0.3, p.z) - terrain.heightAt(p.x - 0.3, p.z);
    const gz = terrain.heightAt(p.x, p.z + 0.3) - terrain.heightAt(p.x, p.z - 0.3);
    const gl = Math.hypot(gx, gz) || 1;
    // remove the shoreward velocity, then nudge off the slope
    const into = (b.vel.x * gx + b.vel.z * gz) / gl;
    if (into > 0) {
      b.vel.x -= (gx / gl) * into;
      b.vel.z -= (gz / gl) * into;
    }
    b.vel.x -= (gx / gl) * 0.6 * dt;
    b.vel.z -= (gz / gl) * 0.6 * dt;
  }
  const ox = p.x,
    oz = p.z;
  p.x += b.vel.x * dt;
  p.z = zClamp(p.z + b.vel.z * dt, 0.4);
  // hard rule: never drift up onto land (a step that climbs onto a beach is undone)
  const gNew = terrain.heightAt(p.x, p.z);
  if (gNew > water.level - 0.12 && gNew > terrain.heightAt(ox, oz)) {
    p.x = ox;
    p.z = oz;
    b.vel.multiplyScalar(0.3);
    beached = true;
  }
  const h = water.heightAt(p.x, p.z);
  p.y += (h - b.draft - p.y) * Math.min(1, dt * 10);
  b.yaw += b.spin * dt;
  if (obj) {
    obj.position.copy(p);
    tmpN.set(-hx * b.tilt, 1, -hz * b.tilt).normalize();
    tmpQ.setFromUnitVectors(UP, tmpN);
    obj.quaternion.copy(tmpQ).multiply(tmpQ2.setFromAxisAngle(UP, b.yaw));
  }
  return beached;
}

/**
 * Water spray droplets for splashes (stone skips, coconuts, bottles). A fixed pool — old
 * droplets are recycled — so long sessions never allocate more.
 */
export class Spray {
  readonly points: THREE.Points;
  private n = 320;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private cursor = 0;
  private alive = 0;

  constructor() {
    const n = this.n;
    this.pos = new Float32Array(n * 3).fill(-999);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.size = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: makeSoftDot() }, uScale: pointScale },
      vertexShader: /* glsl */ `
        attribute float aLife; attribute float aSize; uniform float uScale; varying float vA;
        void main(){
          vA = clamp(aLife * 2.0, 0.0, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.0, aSize * uScale) * step(0.001, aLife);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; varying float vA;
        void main(){
          float a = texture2D(uTex, gl_PointCoord).a * vA * 0.85;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.93, 0.98, 1.0), a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** Burst of droplets at (x, y, z); `power` 0..1 scales count and height. */
  burst(x: number, y: number, z: number, power: number, dirX = 0, dirZ = 0) {
    const count = Math.round(6 + power * 26);
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.12;
      this.pos[i * 3] = x + Math.cos(a) * r;
      this.pos[i * 3 + 1] = y + 0.02;
      this.pos[i * 3 + 2] = z + Math.sin(a) * r;
      const out = (0.4 + Math.random() * 1.2) * (0.5 + power);
      this.vel[i * 3] = Math.cos(a) * out * 0.6 + dirX * 0.8;
      this.vel[i * 3 + 1] = (1.4 + Math.random() * 2.2) * (0.45 + power);
      this.vel[i * 3 + 2] = Math.sin(a) * out * 0.6 + dirZ * 0.8;
      this.life[i] = 0.6 + Math.random() * 0.5;
      this.size[i] = 0.025 + Math.random() * 0.04;
    }
    this.alive = this.n;
  }

  update(dt: number) {
    if (this.alive <= 0) {
      this.points.visible = false;
      return;
    }
    this.points.visible = true;
    let any = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 9.8 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.life[i] <= 0) this.life[i] = 0;
      else any++;
    }
    this.alive = any;
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Dispose a temporary object's geometries / materials (not shared ones flagged `keep`). */
export function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || m.userData.keep) return;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mt of mats) if (mt && !mt.userData?.keep) mt.dispose();
  });
}
