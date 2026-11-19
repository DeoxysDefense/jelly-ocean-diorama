import * as THREE from 'three';
import { CONFIG, outsideView, randViewX, randZ } from '../config';
import { rand } from '../util/math';
import { makeSoftDot } from '../util/textures';
import { pointScale } from './Particles';
import type { TerrainSystem } from './TerrainSystem';
import type { WaterSurfaceSimulation } from '../water/WaterSurfaceSimulation';
import type { FlowField } from './FlowField';

/**
 * Bioluminescent plankton. Invisible by day; at night a faint sparkle drifts in the water and
 * any disturbance — the pointer sweeping through the water, painted currents, fish darting,
 * raindrops — makes nearby plankton flash and slowly fade, leaving soft glowing trails.
 * Deliberately restrained: cool blue-green, low intensity, no neon.
 */
export class Plankton {
  readonly count = 900;
  readonly points: THREE.Points;
  private pos: Float32Array;
  private glow: Float32Array;
  private size: Float32Array;
  private seed: Float32Array;
  private mat: THREE.ShaderMaterial;
  private fv = new THREE.Vector3();
  night = 0;
  private cursor = 0;

  constructor(private terrain: TerrainSystem, private water: WaterSurfaceSimulation, private flow: FlowField) {
    const n = this.count;
    this.pos = new Float32Array(n * 3);
    this.glow = new Float32Array(n);
    this.size = new Float32Array(n);
    this.seed = new Float32Array(n);
    for (let i = 0; i < n; i++) this.respawn(i, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aGlow', new THREE.BufferAttribute(this.glow, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: makeSoftDot() }, uScale: pointScale, uNight: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aGlow; attribute float aSize; attribute float aSeed;
        uniform float uScale; uniform float uNight; uniform float uTime;
        varying float vA;
        void main(){
          float idle = 0.05 + 0.05 * sin(uTime * (0.7 + aSeed) + aSeed * 30.0);
          vA = (idle + aGlow) * uNight;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.5, aSize * (0.8 + aGlow * 1.8) * uScale);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; varying float vA;
        void main(){
          float a = texture2D(uTex, gl_PointCoord).a * vA;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vec3(0.35, 0.95, 1.0) * a * 1.8, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  private respawn(i: number, anywhere = false) {
    const x = randViewX(),
      z = randZ(0.4);
    const ground = this.terrain.heightAt(x, z);
    const surf = this.water.level;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = rand(Math.min(surf - 0.3, ground + 0.3), surf - 0.2);
    this.pos[i * 3 + 2] = z;
    this.size[i] = rand(0.04, 0.09);
    this.seed[i] = rand(0, 1);
    if (anywhere) this.glow[i] = 0;
  }

  /** Disturb plankton around p (world units). */
  excite(x: number, y: number, z: number, radius: number, amount = 1) {
    if (this.night < 0.05) return;
    // seed fresh sparks along the disturbance so strokes leave a visible trail
    const n = Math.ceil(amount * 4);
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      const a = Math.random() * Math.PI * 2,
        r = Math.random() * radius;
      this.pos[i * 3] = x + Math.cos(a) * r;
      this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * radius;
      this.pos[i * 3 + 2] = z + Math.sin(a) * r * 0.8;
      this.glow[i] = Math.min(1.2, 0.35 + amount * 0.6);
    }
    const r2 = radius * radius;
    for (let i = 0; i < this.count; i++) {
      const dx = this.pos[i * 3] - x,
        dy = this.pos[i * 3 + 1] - y,
        dz = this.pos[i * 3 + 2] - z;
      const d2 = dx * dx + dy * dy * 1.5 + dz * dz;
      if (d2 < r2) this.glow[i] = Math.min(1.4, this.glow[i] + amount * (1 - d2 / r2));
    }
  }

  update(dt: number, time: number, night: number, fishPositions: THREE.Vector3[]) {
    this.night = night;
    this.mat.uniforms.uNight.value = night;
    this.mat.uniforms.uTime.value = time;
    this.points.visible = night > 0.02;
    if (!this.points.visible) return;
    const decay = Math.exp(-dt * 0.9);
    // a few fast fish leave faint trails
    for (const p of fishPositions) this.excite(p.x, p.y, p.z, 0.45, 0.12);
    const flowOn = this.flow.active;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      this.glow[i] *= decay;
      this.pos[k] += Math.sin(time * 0.2 + this.seed[i] * 20) * 0.03 * dt;
      this.pos[k + 1] += Math.cos(time * 0.3 + this.seed[i] * 11) * 0.015 * dt;
      if (flowOn) {
        const f = this.flow.velocityAt(this.pos[k], this.pos[k + 1], this.pos[k + 2], this.fv);
        const sp = f.length();
        if (sp > 0.05) {
          this.pos[k] += f.x * dt;
          this.pos[k + 1] += f.y * dt;
          this.pos[k + 2] += f.z * dt;
          this.glow[i] = Math.min(1.3, this.glow[i] + sp * dt * 1.2);
        }
      }
      const surf = this.water.level;
      if (this.pos[k + 1] > surf - 0.12 || this.pos[k + 1] < this.terrain.heightAt(this.pos[k], this.pos[k + 2]) || outsideView(this.pos[k]) || this.pos[k + 2] > CONFIG.world.zFront - 0.2 || this.pos[k + 2] < CONFIG.world.zBack + 0.2)
        this.respawn(i);
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aGlow as THREE.BufferAttribute).needsUpdate = true;
  }
}
