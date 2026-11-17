import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp } from '../util/math';
import { WaveField } from './WaveField';

/**
 * 2D damped wave-equation heightfield over the water top (x, z).
 *
 *   dv/dt = c^2 * laplacian(h) - restoring * h - damping * v
 *   dh/dt = v
 *
 * Cells covered by terrain (the island) are walls with reflective boundaries, so ripples
 * bounce off the island and the front/back of the diorama slab. The result is uploaded as a
 * half-float texture and added to the analytic wind waves in the water vertex shader.
 */
export class WaterSurfaceSimulation {
  readonly nx = CONFIG.water.simNX;
  readonly nz = CONFIG.water.simNZ;
  readonly x0 = CONFIG.world.xMin;
  readonly z0 = CONFIG.world.zBack;
  readonly sizeX = CONFIG.world.xMax - CONFIG.world.xMin;
  readonly sizeZ = CONFIG.world.zFront - CONFIG.world.zBack;
  readonly dx: number;
  readonly dz: number;
  readonly h: Float32Array;
  readonly v: Float32Array;
  /** 1 = water, 0 = blocked by terrain. */
  readonly mask: Uint8Array;
  readonly texture: THREE.DataTexture;
  private texData: Uint16Array;
  readonly waves = new WaveField();
  private gustTimer = 0;
  time = 0;
  /** Current sea level (tide). Everything samples heights relative to this. */
  level = CONFIG.world.waterLevel;
  /** Micro ripples: analytic ring wave packets (x, z, startTime, amplitude). */
  static readonly RIPPLES = 32;
  readonly ripples = new Float32Array(WaterSurfaceSimulation.RIPPLES * 4);
  private rippleCursor = 0;

  constructor() {
    const n = this.nx * this.nz;
    this.h = new Float32Array(n);
    this.v = new Float32Array(n);
    this.mask = new Uint8Array(n).fill(1);
    this.dx = this.sizeX / (this.nx - 1);
    this.dz = this.sizeZ / (this.nz - 1);
    this.texData = new Uint16Array(n);
    this.texture = new THREE.DataTexture(this.texData, this.nx, this.nz, THREE.RedFormat, THREE.HalfFloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  /** Marks cells where terrain rises above the water as walls. */
  updateMask(terrainHeight: (x: number, z: number) => number) {
    for (let j = 0; j < this.nz; j++)
      for (let i = 0; i < this.nx; i++) {
        const x = this.x0 + i * this.dx,
          z = this.z0 + j * this.dz;
        const k = j * this.nx + i;
        this.mask[k] = terrainHeight(x, z) < this.level - 0.05 ? 1 : 0;
        if (!this.mask[k]) {
          this.h[k] = 0;
          this.v[k] = 0;
        }
      }
  }

  private idx(x: number, z: number) {
    const i = Math.round((x - this.x0) / this.dx);
    const j = Math.round((z - this.z0) / this.dz);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }

  /** Simulated (interactive) height only, bilinear. */
  simHeight(x: number, z: number) {
    const fx = clamp((x - this.x0) / this.dx, 0, this.nx - 1.001);
    const fz = clamp((z - this.z0) / this.dz, 0, this.nz - 1.001);
    const i = Math.floor(fx),
      j = Math.floor(fz);
    const tx = fx - i,
      tz = fz - j;
    const k = j * this.nx + i;
    const a = this.h[k],
      b = this.h[k + 1],
      c = this.h[k + this.nx],
      d = this.h[k + this.nx + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** Total water surface height (rest level + waves + interaction). */
  heightAt(x: number, z: number) {
    return this.level + this.simHeight(x, z) + this.waves.height(x, z) + this.rippleHeight(x, z);
  }

  /**
   * Micro ripple: a small expanding ring (hover sweeps, raindrops, bubble pops, food).
   * Evaluated identically here and in the water shaders, so Front and Top View show the
   * same surface W(x, z, t).
   */
  addRipple(x: number, z: number, amp: number) {
    const i = this.rippleCursor;
    this.rippleCursor = (i + 1) % WaterSurfaceSimulation.RIPPLES;
    this.ripples[i * 4] = x;
    this.ripples[i * 4 + 1] = z;
    this.ripples[i * 4 + 2] = this.time;
    this.ripples[i * 4 + 3] = Math.min(0.09, amp);
  }

  rippleHeight(x: number, z: number) {
    let h = 0;
    const R = this.ripples;
    for (let i = 0; i < WaterSurfaceSimulation.RIPPLES; i++) {
      const a = R[i * 4 + 3];
      if (a <= 0) continue;
      const age = this.time - R[i * 4 + 2];
      if (age < 0 || age > 2.6) continue;
      const dx = x - R[i * 4],
        dz = z - R[i * 4 + 1];
      const f = Math.sqrt(dx * dx + dz * dz) - 1.5 * age;
      if (f * f > 0.6) continue;
      h += a * Math.exp(-age * 1.5) * Math.exp(-(f * f) / 0.09) * Math.cos(f * 13);
    }
    return h;
  }

  /** Applies a gaussian velocity impulse (negative = push down). */
  disturb(x: number, z: number, amount: number, radius = 0.6) {
    this.forEachInRadius(x, z, radius, (k, w) => {
      this.v[k] += amount * w;
    });
  }

  /** Spring pull of a region toward a target height (used for drag / hover lift). */
  pull(x: number, z: number, target: number, stiffness: number, radius: number, dt: number) {
    this.forEachInRadius(x, z, radius, (k, w) => {
      const f = (target - this.h[k]) * stiffness * w;
      this.v[k] += f * dt;
      this.v[k] *= 1 - Math.min(0.5, 4 * w * dt); // extra local damping keeps the grab stable
    });
  }

  private forEachInRadius(x: number, z: number, r: number, fn: (k: number, w: number) => void) {
    const i0 = Math.max(1, Math.floor((x - r * 2 - this.x0) / this.dx));
    const i1 = Math.min(this.nx - 2, Math.ceil((x + r * 2 - this.x0) / this.dx));
    const j0 = Math.max(0, Math.floor((z - r * 2 - this.z0) / this.dz));
    const j1 = Math.min(this.nz - 1, Math.ceil((z + r * 2 - this.z0) / this.dz));
    const inv = 1 / (r * r);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * this.nx + i;
        if (!this.mask[k]) continue;
        const px = this.x0 + i * this.dx - x,
          pz = this.z0 + j * this.dz - z;
        const w = Math.exp(-(px * px + pz * pz) * inv);
        if (w > 0.01) fn(k, w);
      }
  }

  step(dt: number, wind: number) {
    const cfg = CONFIG.water;
    this.time += dt;
    this.waves.update(dt, wind);

    // Wind gusts: occasional soft drops make the surface feel alive in strong wind.
    this.gustTimer -= dt;
    if (wind > 0.05 && this.gustTimer <= 0) {
      this.gustTimer = 0.08 + Math.random() * (0.6 - wind * 0.45);
      const x = this.x0 + Math.random() * this.sizeX;
      const z = this.z0 + Math.random() * this.sizeZ;
      this.disturb(x, z, -(0.15 + Math.random() * 0.5) * wind, 0.35 + Math.random() * 0.4);
    }

    const c2 = cfg.waveSpeed * cfg.waveSpeed;
    const idx2 = 1 / (this.dx * this.dx),
      idz2 = 1 / (this.dz * this.dz);
    // Stability (CFL) for this explicit scheme: c·h·sqrt(1/dx² + 1/dz²) ≤ 1. Slow / throttled
    // frames (dt up to 1/15 s) get extra substeps instead of blowing up into spikes.
    const hMax = 0.8 / (cfg.waveSpeed * Math.sqrt(idx2 + idz2));
    const sub = Math.max(cfg.substeps, Math.ceil(dt / hMax));
    const h = dt / sub;
    const { nx, nz, mask } = this;
    const H = this.h,
      V = this.v;
    const maxD = cfg.maxDisplacement;
    for (let s = 0; s < sub; s++) {
      for (let j = 0; j < nz; j++) {
        const jm = j > 0 ? j - 1 : j,
          jp = j < nz - 1 ? j + 1 : j;
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          if (!mask[k]) continue;
          const hc = H[k];
          const im = i > 0 ? i - 1 : i,
            ip = i < nx - 1 ? i + 1 : i;
          // Reflective (Neumann) boundaries at walls: blocked neighbours mirror the centre.
          const kl = j * nx + im,
            kr = j * nx + ip,
            kd = jm * nx + i,
            ku = jp * nx + i;
          const hl = mask[kl] ? H[kl] : hc,
            hr = mask[kr] ? H[kr] : hc;
          const hd = mask[kd] ? H[kd] : hc,
            hu = mask[ku] ? H[ku] : hc;
          const lap = (hl + hr - 2 * hc) * idx2 + (hd + hu - 2 * hc) * idz2;
          V[k] += (c2 * lap - cfg.restoring * hc - cfg.damping * V[k]) * h;
        }
      }
      for (let k = 0; k < H.length; k++) {
        if (!mask[k]) continue;
        let nh = H[k] + V[k] * h;
        // Soft limit: no extreme stretching or tearing.
        if (nh > maxD) {
          nh = maxD;
          V[k] *= 0.5;
        } else if (nh < -maxD) {
          nh = -maxD;
          V[k] *= 0.5;
        }
        H[k] = nh;
      }
    }
  }

  uploadTexture() {
    const H = this.h,
      T = this.texData;
    for (let k = 0; k < H.length; k++) T[k] = THREE.DataUtils.toHalfFloat(H[k]);
    this.texture.needsUpdate = true;
  }

  reset() {
    this.h.fill(0);
    this.v.fill(0);
  }
}
