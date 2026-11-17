import * as THREE from 'three';
import { randZ } from '../config';
import { CONFIG } from '../config';
import { rand } from '../util/math';
import { makeBubbleSprite, makeSoftDot } from '../util/textures';
import type { WaterSurfaceSimulation } from '../water/WaterSurfaceSimulation';
import type { TerrainSystem } from './TerrainSystem';

/** Shared uniform: pixels per world unit (orthographic point sizing). */
export const pointScale = { value: 40 };

function pointsMaterial(tex: THREE.Texture, additive: boolean, opacity: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uScale: pointScale, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute float aAlpha;
      uniform float uScale; varying float vAlpha;
      void main(){
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.0, aSize * uScale);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex; uniform float uOpacity; varying float vAlpha;
      void main(){
        vec4 t = texture2D(uTex, gl_PointCoord);
        gl_FragColor = vec4(t.rgb, t.a * vAlpha * uOpacity);
        if (gl_FragColor.a < 0.01) discard;
      }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

/** Rising bubbles that wobble and pop at the surface with a tiny ripple. */
export class Bubbles {
  readonly max = 260;
  readonly points: THREE.Points;
  private pos: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private seed: Float32Array;
  private ambientT = 0;
  flow: import('./FlowField').FlowField | null = null;
  private fv = new THREE.Vector3();

  constructor(private water: WaterSurfaceSimulation, private emitters: () => THREE.Vector3[]) {
    const n = this.max;
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n);
    this.life = new Float32Array(n);
    this.seed = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.points = new THREE.Points(g, pointsMaterial(makeBubbleSprite(), false, 0.85));
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
  }

  emit(x: number, y: number, z: number, count: number, spread = 0.1, sizeMul = 1) {
    let k = 0;
    for (let i = 0; i < this.max && k < count; i++) {
      if (this.life[i] > 0) continue;
      this.pos[i * 3] = x + rand(-spread, spread);
      this.pos[i * 3 + 1] = y + rand(-spread, spread);
      this.pos[i * 3 + 2] = z + rand(-spread, spread);
      this.size[i] = rand(0.035, 0.1) * sizeMul;
      this.vel[i] = 0.5 + this.size[i] * 6;
      this.life[i] = 1;
      this.seed[i] = rand(0, 100);
      k++;
    }
  }

  clear() {
    this.life.fill(0);
  }

  update(dt: number, time: number, ambient: boolean) {
    // occasional natural bubbles from reef / den
    this.ambientT -= dt;
    if (this.ambientT <= 0) {
      this.ambientT = rand(0.6, 2.2) * (ambient ? 1.6 : 1);
      const e = this.emitters();
      if (e.length) {
        const p = e[Math.floor(Math.random() * e.length)];
        this.emit(p.x, p.y, p.z, Math.floor(rand(1, 4)), 0.05, 0.8);
      }
    }
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      const k = i * 3;
      const s = this.seed[i];
      this.pos[k] += Math.sin(time * 6 + s) * 0.12 * dt;
      this.pos[k + 2] += Math.cos(time * 5 + s) * 0.06 * dt;
      this.pos[k + 1] += this.vel[i] * dt;
      if (this.flow?.active) {
        const f = this.flow.velocityAt(this.pos[k], this.pos[k + 1], this.pos[k + 2], this.fv);
        this.pos[k] += f.x * dt;
        this.pos[k + 2] += f.z * dt;
      }
      const surf = this.water.heightAt(this.pos[k], this.pos[k + 2]);
      if (this.pos[k + 1] >= surf - 0.04) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        if (this.size[i] > 0.06) this.water.disturb(this.pos[k], this.pos[k + 2], 0.12, 0.15);
        this.water.addRipple(this.pos[k], this.pos[k + 2], 0.006 + this.size[i] * 0.12);
        continue;
      }
      this.alpha[i] = Math.min(1, this.alpha[i] + dt * 4);
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Suspended particles ("marine snow") drifting with a wind-influenced current. */
export class MarineSnow {
  readonly count = 520;
  level = 0;
  flow: import('./FlowField').FlowField | null = null;
  private fv = new THREE.Vector3();
  readonly points: THREE.Points;
  private pos: Float32Array;
  private base: Float32Array;

  constructor(private terrain: TerrainSystem) {
    const n = this.count;
    this.pos = new Float32Array(n * 3);
    this.base = new Float32Array(n * 4);
    const size = new Float32Array(n);
    const alpha = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = rand(-22, 22);
      this.pos[i * 3 + 1] = rand(-6.5, -0.3);
      this.pos[i * 3 + 2] = randZ(0.4);
      this.base[i * 4] = rand(0, 100);
      this.base[i * 4 + 1] = rand(0.6, 1.4);
      size[i] = rand(0.025, 0.06);
      alpha[i] = rand(0.25, 0.7);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    this.points = new THREE.Points(g, pointsMaterial(makeSoftDot(), true, 0.55));
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  update(dt: number, time: number, wind: number, ambient: boolean) {
    const n = ambient ? Math.floor(this.count * 0.5) : this.count;
    this.points.geometry.setDrawRange(0, n);
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const s = this.base[i * 4],
        sp = this.base[i * 4 + 1];
      // individual particles respond differently to the current
      this.pos[k] += (0.04 + wind * 0.22 * sp + Math.sin(time * 0.3 + s) * 0.04) * dt;
      this.pos[k + 1] += (Math.sin(time * 0.5 + s * 1.3) * 0.03 - 0.012) * dt;
      this.pos[k + 2] += Math.cos(time * 0.4 + s) * 0.02 * dt;
      if (this.flow?.active) {
        const f = this.flow.velocityAt(this.pos[k], this.pos[k + 1], this.pos[k + 2], this.fv);
        this.pos[k] += f.x * dt * 1.3;
        this.pos[k + 1] += f.y * dt * 1.3;
        this.pos[k + 2] = Math.max(-5.8, Math.min(5.8, this.pos[k + 2] + f.z * dt * 1.3));
      }
      if (this.pos[k] > 22) this.pos[k] = -22;
      const g = this.terrain.heightAt(this.pos[k], this.pos[k + 2]);
      const lvl = this.level;
      if (this.pos[k + 1] < g + 0.1) this.pos[k + 1] = lvl + rand(-3, -0.4);
      if (this.pos[k + 1] > lvl - 0.2) this.pos[k + 1] = lvl - 0.25;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    void CONFIG;
  }
}
