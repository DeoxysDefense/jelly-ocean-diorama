import * as THREE from 'three';
import { rand } from '../util/math';
import type { WaterSurfaceSimulation } from '../water/WaterSurfaceSimulation';
import type { FlowField } from './FlowField';
import type { TerrainSystem } from './TerrainSystem';

const N = 240; // streak pool
const K = 10; // trail samples per streak
const STEP = 0.035; // seconds between trail samples

/**
 * Visible painted currents: soft white ribbons that are advected by the FlowField, so a brush
 * stroke reads as moving water (direction, speed and swirl) rather than an invisible force.
 * Streaks are spawned along the stroke and, while the current lives, inside its strongest jets.
 */
export class CurrentStreaks {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(N * 3);
  private hist = new Float32Array(N * K * 3);
  private life = new Float32Array(N);
  private maxLife = new Float32Array(N);
  private age = new Float32Array(N);
  private width = new Float32Array(N);
  private vPos: Float32Array;
  private vA: Float32Array;
  private next = 0;
  private sampleT = 0;
  private spawnAcc = 0;
  private live = 0;
  private fv = new THREE.Vector3();
  private view = new THREE.Vector3();
  private t = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(private terrain: TerrainSystem, private water: WaterSurfaceSimulation, private flow: FlowField) {
    const nv = N * K * 2;
    this.vPos = new Float32Array(nv * 3);
    this.vA = new Float32Array(nv);
    const across = new Float32Array(nv);
    for (let i = 0; i < nv; i++) across[i] = i % 2 ? 1 : -1;
    const idx: number[] = [];
    for (let i = 0; i < N; i++)
      for (let j = 0; j < K - 1; j++) {
        const a = (i * K + j) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.vPos, 3));
    g.setAttribute('aA', new THREE.BufferAttribute(this.vA, 1));
    g.setAttribute('aV', new THREE.BufferAttribute(across, 1));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0.8 } },
      vertexShader: /* glsl */ `
        attribute float aA; attribute float aV; varying float vA; varying float vV;
        void main(){ vA = aA; vV = aV; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; varying float vA; varying float vV;
        void main(){
          float a = vA * smoothstep(1.0, 0.15, abs(vV)) * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(0.88, 0.99, 1.0, a);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
  }

  /** Release `count` streaks within `radius` of p (clamped into the water column). */
  spawn(p: THREE.Vector3, radius: number, count: number) {
    for (let c = 0; c < count; c++) {
      const i = this.next;
      this.next = (this.next + 1) % N;
      const k = i * 3;
      const x = p.x + rand(-radius, radius);
      const z = p.z + rand(-radius, radius) * 0.6;
      const g = this.terrain.heightAt(x, z);
      const surf = this.water.heightAt(x, z);
      if (surf - g < 0.3) continue;
      const y = Math.min(surf - 0.12, Math.max(g + 0.1, p.y + rand(-radius, radius) * 0.5));
      this.pos[k] = x;
      this.pos[k + 1] = y;
      this.pos[k + 2] = z;
      for (let j = 0; j < K; j++) this.hist.set([x, y, z], (i * K + j) * 3);
      this.maxLife[i] = this.life[i] = rand(1.3, 2.4);
      this.age[i] = 0;
      this.width[i] = rand(0.035, 0.06);
    }
  }

  clear() {
    this.life.fill(0);
  }

  update(dt: number, camera: THREE.Camera) {
    const flowOn = this.flow.active;
    // keep the live current visibly streaming, not only at the cursor
    if (flowOn) {
      this.spawnAcc += dt * 30;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        const e = this.flow.randomJet();
        if (e) this.spawn(e.p, e.r * 0.75, 1);
      }
    } else this.spawnAcc = 0;
    if (!flowOn && this.live === 0) return;

    let tick = false;
    this.sampleT += dt;
    if (this.sampleT >= STEP) {
      this.sampleT = Math.min(this.sampleT - STEP, STEP);
      tick = true;
    }
    camera.getWorldDirection(this.view);
    const H = this.hist,
      P = this.vPos,
      A = this.vA;
    let live = 0;
    for (let i = 0; i < N; i++) {
      const vb = i * K * 2;
      if (this.life[i] <= 0) {
        if (A[vb] !== 0 || A[vb + 1] !== 0) A.fill(0, vb, vb + K * 2);
        continue;
      }
      live++;
      const k = i * 3;
      let sp = 0;
      if (flowOn) {
        const f = this.flow.velocityAt(this.pos[k], this.pos[k + 1], this.pos[k + 2], this.fv);
        sp = f.length();
        this.pos[k] += f.x * dt;
        this.pos[k + 1] += f.y * dt;
        this.pos[k + 2] += f.z * dt;
      }
      // calm water: the streak dissolves quickly
      this.life[i] -= dt * (sp < 0.25 ? 2.5 : 1);
      this.age[i] += dt;
      const g = this.terrain.heightAt(this.pos[k], this.pos[k + 2]);
      const surf = this.water.heightAt(this.pos[k], this.pos[k + 2]);
      this.pos[k + 1] = Math.min(surf - 0.1, Math.max(g + 0.08, this.pos[k + 1]));
      const hb = i * K * 3;
      if (tick) H.copyWithin(hb + 3, hb, hb + (K - 1) * 3);
      H[hb] = this.pos[k];
      H[hb + 1] = this.pos[k + 1];
      H[hb + 2] = this.pos[k + 2];
      // trail length decides visibility (a resting streak is invisible)
      let len = 0;
      for (let j = 1; j < K; j++) {
        const a = hb + j * 3,
          b = a - 3;
        len += Math.hypot(H[a] - H[b], H[a + 1] - H[b + 1], H[a + 2] - H[b + 2]);
      }
      const alpha =
        Math.min(1, this.age[i] * 5) * Math.min(1, this.life[i] / 0.6) * Math.min(1, len / 0.35) * (this.life[i] > 0 ? 1 : 0);
      for (let j = 0; j < K; j++) {
        const a = hb + j * 3;
        const prev = j > 0 ? a - 3 : a;
        const nxt = j < K - 1 ? a + 3 : a;
        this.t.set(H[prev] - H[nxt], H[prev + 1] - H[nxt + 1], H[prev + 2] - H[nxt + 2]);
        this.s.crossVectors(this.t, this.view);
        const sl = this.s.length();
        const u = j / (K - 1);
        const w = this.width[i] * (1 - u * 0.75);
        if (sl > 1e-6) this.s.multiplyScalar(w / sl);
        else this.s.set(0, w, 0);
        const v = vb + j * 2;
        P[v * 3] = H[a] - this.s.x;
        P[v * 3 + 1] = H[a + 1] - this.s.y;
        P[v * 3 + 2] = H[a + 2] - this.s.z;
        P[v * 3 + 3] = H[a] + this.s.x;
        P[v * 3 + 4] = H[a + 1] + this.s.y;
        P[v * 3 + 5] = H[a + 2] + this.s.z;
        const fa = alpha * Math.pow(1 - u, 1.3);
        A[v] = fa;
        A[v + 1] = fa;
      }
    }
    this.live = live;
    const geo = this.mesh.geometry;
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aA as THREE.BufferAttribute).needsUpdate = true;
  }
}
