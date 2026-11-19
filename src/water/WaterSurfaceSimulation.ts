import * as THREE from 'three';
import { CONFIG, viewWindow } from '../config';
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
  readonly x0 = CONFIG.world.xMin;
  readonly z0 = CONFIG.world.zBack;
  readonly sizeX = CONFIG.world.xMax - CONFIG.world.xMin;
  readonly sizeZ = CONFIG.world.zFront - CONFIG.world.zBack;
  readonly nx = Math.round(this.sizeX / CONFIG.water.simCellX) + 1;
  readonly nz = Math.round(this.sizeZ / CONFIG.water.simCellZ) + 1;
  /**
   * V2: tile sleeping. The tray is ~2.5x the v1 area, but ripples only live where something
   * disturbed the water. Tiles whose height and velocity stay below EPS for a while go to sleep
   * (zeroed, skipped); any impulse, mask change or active neighbour wakes them again.
   */
  static readonly TILE = 16;
  /** Below ~1 mm of height (slope < 0.5 %), a ripple is invisible: let the tile sleep. */
  static readonly EPS = 1e-3;
  /** Extra world units simulated beyond the view window on each side. */
  static readonly WINDOW_MARGIN = 6;
  static readonly GRACE = 24;
  readonly tilesX: number;
  readonly tilesZ: number;
  /** Steps left before a quiet tile sleeps (0 = asleep). */
  readonly tileLife: Uint8Array;
  private tileTex: Uint8Array;
  /** Disable to run every cell every step (reference behaviour, tests). */
  sleep = true;
  /** Cached terrain height per cell (mask updates only re-compare against the sea level). */
  private ground: Float32Array | null = null;
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
    const T = WaterSurfaceSimulation.TILE;
    this.tilesX = Math.ceil(this.nx / T);
    this.tilesZ = Math.ceil(this.nz / T);
    this.tileLife = new Uint8Array(this.tilesX * this.tilesZ);
    this.tileTex = new Uint8Array(this.tilesX * this.tilesZ);
  }

  /**
   * Marks cells where terrain rises above the water as walls. Pass `terrainChanged = false` when
   * only the sea level moved (the cached ground heights are reused).
   */
  updateMask(terrainHeight: (x: number, z: number) => number, terrainChanged = true) {
    const n = this.nx * this.nz;
    if (!this.ground || terrainChanged) {
      this.ground ??= new Float32Array(n);
      for (let j = 0; j < this.nz; j++)
        for (let i = 0; i < this.nx; i++) this.ground[j * this.nx + i] = terrainHeight(this.x0 + i * this.dx, this.z0 + j * this.dz);
    }
    const G = this.ground;
    const lim = this.level - 0.05;
    const T = WaterSurfaceSimulation.TILE;
    for (let j = 0; j < this.nz; j++)
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i;
        const m = G[k] < lim ? 1 : 0;
        if (m !== this.mask[k]) {
          this.mask[k] = m;
          this.tileLife[Math.floor(j / T) * this.tilesX + Math.floor(i / T)] = WaterSurfaceSimulation.GRACE;
        }
        if (!m) {
          this.h[k] = 0;
          this.v[k] = 0;
        }
      }
  }

  /** Wakes the tiles overlapping a world-space box. */
  private wakeBox(x0: number, x1: number, z0: number, z1: number) {
    const T = WaterSurfaceSimulation.TILE;
    const i0 = Math.max(0, Math.floor((x0 - this.x0) / this.dx / T)),
      i1 = Math.min(this.tilesX - 1, Math.floor((x1 - this.x0) / this.dx / T));
    const j0 = Math.max(0, Math.floor((z0 - this.z0) / this.dz / T)),
      j1 = Math.min(this.tilesZ - 1, Math.floor((z1 - this.z0) / this.dz / T));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.tileLife[j * this.tilesX + i] = WaterSurfaceSimulation.GRACE;
  }

  /** Number of awake tiles (diagnostics). */
  awakeTiles() {
    let n = 0;
    for (const l of this.tileLife) if (l) n++;
    return n;
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
    this.wakeBox(x - r * 2, x + r * 2, z - r * 2, z + r * 2);
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
      // gusts are only felt where someone is looking; the rate keeps the v1 density per area
      const gx0 = Math.max(this.x0, viewWindow.cx - viewWindow.halfW),
        gx1 = Math.min(this.x0 + this.sizeX, viewWindow.cx + viewWindow.halfW);
      const span = Math.max(4, gx1 - gx0);
      this.gustTimer = (0.08 + Math.random() * (0.6 - wind * 0.45)) * (60 / span) * (19 / this.sizeZ);
      const x = gx0 + Math.random() * (gx1 - gx0);
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
    const T = WaterSurfaceSimulation.TILE;
    const TX = this.tilesX,
      TZ = this.tilesZ;
    const life = this.tileLife;
    if (!this.sleep) life.fill(WaterSurfaceSimulation.GRACE);
    // Only water in (and just around) the view is simulated; tiles further out go calm. With the
    // Focus View that is about the v1 cell count, whatever the size of the tray.
    let tA = 0,
      tB = TX - 1;
    if (this.sleep) {
      const m = WaterSurfaceSimulation.WINDOW_MARGIN;
      tA = Math.max(0, Math.floor((viewWindow.cx - viewWindow.halfW - m - this.x0) / this.dx / T));
      tB = Math.min(TX - 1, Math.floor((viewWindow.cx + viewWindow.halfW + m - this.x0) / this.dx / T));
    }
    const active: number[] = [];
    for (let t = 0; t < life.length; t++) {
      if (!life[t]) continue;
      const ti = t % TX;
      if (ti < tA || ti > tB) {
        // outside the window: settle it (zeroed once, then skipped until it is in view again)
        life[t] = 0;
        this.tileTex[t] = 1;
        const tj = (t - ti) / TX;
        for (let j = tj * T; j < Math.min(nz, tj * T + T); j++) {
          const k0 = j * nx + ti * T;
          H.fill(0, k0, j * nx + Math.min(nx, ti * T + T));
          V.fill(0, k0, j * nx + Math.min(nx, ti * T + T));
        }
        continue;
      }
      active.push(t);
    }
    const EPS = WaterSurfaceSimulation.EPS;
    const tileMax = new Float32Array(active.length);
    for (let s = 0; s < sub; s++) {
      for (const t of active) {
        const ti = t % TX,
          tj = (t - ti) / TX;
        const iA = ti * T,
          iB = Math.min(nx, iA + T),
          jA = tj * T,
          jB = Math.min(nz, jA + T);
        for (let j = jA; j < jB; j++) {
          const jm = j > 0 ? j - 1 : j,
            jp = j < nz - 1 ? j + 1 : j;
          for (let i = iA; i < iB; i++) {
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
      }
      for (let a = 0; a < active.length; a++) {
        const t = active[a];
        const ti = t % TX,
          tj = (t - ti) / TX;
        const iA = ti * T,
          iB = Math.min(nx, iA + T),
          jA = tj * T,
          jB = Math.min(nz, jA + T);
        let mx = tileMax[a];
        for (let j = jA; j < jB; j++)
          for (let k = j * nx + iA, kEnd = j * nx + iB; k < kEnd; k++) {
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
            const e = Math.abs(nh) + Math.abs(V[k]) * 0.1;
            if (e > mx) mx = e;
          }
        tileMax[a] = mx;
      }
    }
    // bookkeeping: quiet tiles count down and sleep (zeroed); lively ones wake their neighbours
    for (let a = 0; a < active.length; a++) {
      const t = active[a];
      this.tileTex[t] = 1;
      if (!this.sleep) continue;
      if (tileMax[a] > EPS) {
        life[t] = WaterSurfaceSimulation.GRACE;
        const ti = t % TX,
          tj = (t - ti) / TX;
        if (ti > 0 && !life[t - 1]) life[t - 1] = 2;
        if (ti < TX - 1 && !life[t + 1]) life[t + 1] = 2;
        if (tj > 0 && !life[t - TX]) life[t - TX] = 2;
        if (tj < TZ - 1 && !life[t + TX]) life[t + TX] = 2;
      } else if (--life[t] === 0) {
        const ti = t % TX,
          tj = (t - ti) / TX;
        for (let j = tj * T; j < Math.min(nz, tj * T + T); j++)
          for (let k = j * nx + ti * T, kEnd = j * nx + Math.min(nx, ti * T + T); k < kEnd; k++) {
            H[k] = 0;
            V[k] = 0;
          }
      }
    }
  }

  /** Converts the tiles that changed since the last upload (sleeping tiles keep their texels). */
  uploadTexture() {
    const H = this.h,
      D = this.texData;
    const T = WaterSurfaceSimulation.TILE;
    let any = false;
    for (let t = 0; t < this.tileTex.length; t++) {
      if (!this.tileTex[t]) continue;
      this.tileTex[t] = 0;
      any = true;
      const ti = t % this.tilesX,
        tj = (t - ti) / this.tilesX;
      for (let j = tj * T; j < Math.min(this.nz, tj * T + T); j++)
        for (let k = j * this.nx + ti * T, kEnd = j * this.nx + Math.min(this.nx, ti * T + T); k < kEnd; k++) D[k] = THREE.DataUtils.toHalfFloat(H[k]);
    }
    if (any) this.texture.needsUpdate = true;
  }

  reset() {
    this.h.fill(0);
    this.v.fill(0);
    this.tileLife.fill(0);
    this.tileTex.fill(1);
  }
}
