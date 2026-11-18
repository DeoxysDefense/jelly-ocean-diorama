import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp, smoothstep } from '../util/math';
import { fbm2 } from '../util/noise';
import { GLSL_NOISE, shared } from '../util/shaders';

/**
 * Seabed + island terrain.
 *
 * Height = base (procedural, indestructible) + sediment (user-added sand, removable).
 * Two meshes: the top heightfield surface and the front cross-section "cut" that shows the
 * layered sand / sediment / rock strata, like a resin diorama.
 */
export class TerrainSystem {
  readonly nx = 361;
  /** ~0.2 world units per row across the full depth. */
  readonly nz = Math.round((CONFIG.world.zFront - CONFIG.world.zBack) / 0.2) + 1;
  readonly x0 = CONFIG.world.xMin;
  readonly z0 = CONFIG.world.zBack;
  readonly dx: number;
  readonly dz: number;
  readonly base: Float32Array;
  readonly sed: Float32Array;
  /** Part of `sed` that is compacted (Island Stamp): never slides, but can still be erased. */
  readonly firm: Float32Array;
  readonly group = new THREE.Group();
  readonly topMesh: THREE.Mesh;
  readonly frontMesh: THREE.Mesh;
  private topGeo: THREE.BufferGeometry;
  private frontGeo: THREE.BufferGeometry;
  private frontRows = 18;
  private dirty = { any: false, i0: 0, i1: 0, j0: 0, j1: 0 };
  /** Seconds of remaining relaxation activity (granular sliding). */
  private relaxActive = 0;
  /** Bumped whenever the total height changes (consumers can cache against it). */
  version = 0;

  constructor() {
    this.dx = (CONFIG.world.xMax - CONFIG.world.xMin) / (this.nx - 1);
    this.dz = (CONFIG.world.zFront - CONFIG.world.zBack) / (this.nz - 1);
    const n = this.nx * this.nz;
    this.base = new Float32Array(n);
    this.sed = new Float32Array(n);
    this.firm = new Float32Array(n);
    for (let j = 0; j < this.nz; j++)
      for (let i = 0; i < this.nx; i++) this.base[j * this.nx + i] = TerrainSystem.baseHeight(this.x0 + i * this.dx, this.z0 + j * this.dz);

    this.topGeo = this.buildTopGeometry();
    this.frontGeo = this.buildFrontGeometry();
    this.topMesh = new THREE.Mesh(this.topGeo, makeTopMaterial());
    this.frontMesh = new THREE.Mesh(this.frontGeo, makeFrontMaterial());
    this.topMesh.receiveShadow = true;
    this.frontMesh.receiveShadow = true;
    this.topMesh.name = 'terrainTop';
    this.frontMesh.name = 'terrainFront';
    this.group.add(this.topMesh, this.frontMesh);
  }

  /**
   * Procedural base terrain: a shallow sand shelf on the lagoon side (left) that the small
   * island rises from with gentle beach slopes, dropping to the deeper reef seabed on the right.
   */
  static baseHeight(x: number, z: number): number {
    const W = CONFIG.world,
      I = CONFIG.island;
    let y = W.seabedY;
    y += 0.5 * fbm2(x * 0.09 + 3.1, z * 0.16 + 1.7, 3);
    y += 0.14 * Math.sin(x * 0.23 + 0.6) + 0.06 * Math.sin(x * 0.61 + z * 0.37);
    y -= 0.35 * Math.exp(-(((x - 4.0) / 5.5) ** 2)); // open-water basin
    y += 0.7 * Math.exp(-(((x - 12.5) / 4.0) ** 2) - ((z + 1.5) / 6) ** 2); // reef platform
    y += 0.3 * smoothstep(1.5, 5.8, -z); // far side rises slightly
    // V3 deep back region: gentle dunes, then a soft rise toward the far wall
    y += 0.22 * Math.sin(x * 0.31 + z * 0.52) * smoothstep(5, 9, -z);
    y += 0.65 * smoothstep(8.5, 12.8, -z);
    // shallow shelf (lagoon) on the left, blending down a soft slope
    const shelf = 1 - smoothstep(-4.5, 2.5, x + 0.6 * Math.sin(z * 0.45));
    const shelfY = W.shelfY + 0.25 * fbm2(x * 0.2, z * 0.25 + 9, 2) + 0.15 * smoothstep(-14, -24, x);
    y = y + (shelfY - y) * shelf;
    // island: sandy plateau on the shelf, gentle beach + flank
    const dx = x - I.x,
      dz = (z - I.z) * I.zScale;
    const r = Math.sqrt(dx * dx + dz * dz);
    const f = Math.exp(-Math.pow(r / I.radius, I.power));
    if (f > 0.002) {
      let top = I.peak - 0.12 * (r / I.radius) ** 2;
      top += 0.02 * Math.sin(x * 5.2 + z * 1.3) + 0.035 * fbm2(x * 0.8, z * 0.8, 2);
      y = y + (top - y) * f;
      // flatten a pad for the hut
      const hx = x - (I.x + 0.35),
        hz = (z - I.z) * 1.2;
      const pad = 1 - smoothstep(0.7, 1.5, Math.sqrt(hx * hx + hz * hz));
      y = y + (I.peak - 0.02 - y) * pad * 0.8;
    }
    return y;
  }

  // ---------------------------------------------------------------- queries
  private sample(arr: Float32Array | null, x: number, z: number) {
    const fx = clamp((x - this.x0) / this.dx, 0, this.nx - 1.0001);
    const fz = clamp((z - this.z0) / this.dz, 0, this.nz - 1.0001);
    const i = Math.floor(fx),
      j = Math.floor(fz);
    const tx = fx - i,
      tz = fz - j;
    const k = j * this.nx + i;
    const g = (kk: number) => this.base[kk] + (arr ? arr[kk] : 0);
    return (g(k) * (1 - tx) + g(k + 1) * tx) * (1 - tz) + (g(k + this.nx) * (1 - tx) + g(k + this.nx + 1) * tx) * tz;
  }
  /** Total height (base + added sand). */
  heightAt(x: number, z: number) {
    return this.sample(this.sed, x, z);
  }
  baseAt(x: number, z: number) {
    return this.sample(null, x, z);
  }
  sedimentAt(x: number, z: number) {
    return this.heightAt(x, z) - this.baseAt(x, z);
  }
  normalAt(x: number, z: number, out = new THREE.Vector3()) {
    const e = 0.15;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  }

  /**
   * Ray-marches the heightfield from any camera direction (Front, Top or in between).
   * A ray entering through the front cut below the contour hits the cut itself.
   */
  raycast(ray: THREE.Ray, out = new THREE.Vector3()): THREE.Vector3 | null {
    const W = CONFIG.world;
    const o = ray.origin,
      d = ray.direction;
    let t0 = 0,
      t1 = Infinity;
    const lo = [W.xMin, W.bottomY, W.zBack],
      hi = [W.xMax, 6, W.zFront];
    const oa = [o.x, o.y, o.z],
      da = [d.x, d.y, d.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(da[a]) < 1e-9) {
        if (oa[a] < lo[a] || oa[a] > hi[a]) return null;
        continue;
      }
      let ta = (lo[a] - oa[a]) / da[a],
        tb = (hi[a] - oa[a]) / da[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
    const at = (t: number) => out.set(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    const p0 = at(t0);
    if (p0.y <= this.heightAt(p0.x, p0.z)) return p0; // entered through the cut / below ground
    const step = 0.05;
    let prev = t0;
    for (let t = t0 + step; t <= t1; t += step) {
      const p = at(t);
      if (p.y <= this.heightAt(p.x, p.z)) {
        let a = prev,
          b = t;
        for (let r = 0; r < 7; r++) {
          const m = (a + b) / 2;
          const q = at(m);
          if (q.y <= this.heightAt(q.x, q.z)) b = m;
          else a = m;
        }
        return at(b);
      }
      prev = t;
    }
    return null;
  }

  // ---------------------------------------------------------------- sediment edits
  /** Adds sediment volume around (x, z) using a bilinear splat. */
  addSediment(x: number, z: number, volume: number) {
    const fx = (x - this.x0) / this.dx,
      fz = (z - this.z0) / this.dz;
    const i = Math.floor(fx),
      j = Math.floor(fz);
    if (i < 1 || j < 0 || i >= this.nx - 2 || j >= this.nz - 1) return;
    const tx = fx - i,
      tz = fz - j;
    const h = volume / (this.dx * this.dz);
    const max = CONFIG.sand.maxSediment;
    const add = (kk: number, w: number) => {
      this.sed[kk] = Math.min(max, this.sed[kk] + h * w);
    };
    const k = j * this.nx + i;
    add(k, (1 - tx) * (1 - tz));
    add(k + 1, tx * (1 - tz));
    add(k + this.nx, (1 - tx) * tz);
    add(k + this.nx + 1, tx * tz);
    this.markDirty(i - 1, i + 2, j - 1, j + 2);
    this.relaxActive = 2.5;
  }

  /**
   * Removes only user-added sediment inside an elliptical brush. Base terrain is never touched,
   * so the original seabed can never be dug through. Returns the removed volume.
   */
  removeSediment(x: number, z: number, rx: number, rz: number, amount: number) {
    let removed = 0;
    const i0 = Math.max(0, Math.floor((x - rx * 1.5 - this.x0) / this.dx));
    const i1 = Math.min(this.nx - 1, Math.ceil((x + rx * 1.5 - this.x0) / this.dx));
    const j0 = Math.max(0, Math.floor((z - rz * 1.5 - this.z0) / this.dz));
    const j1 = Math.min(this.nz - 1, Math.ceil((z + rz * 1.5 - this.z0) / this.dz));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * this.nx + i;
        if (this.sed[k] <= 0) continue;
        const px = (this.x0 + i * this.dx - x) / rx,
          pz = (this.z0 + j * this.dz - z) / rz;
        const w = Math.exp(-(px * px + pz * pz) * 1.6);
        if (w < 0.02) continue;
        const r = Math.min(this.sed[k], amount * w);
        this.sed[k] -= r;
        if (this.sed[k] < 1e-4) this.sed[k] = 0;
        if (this.firm[k] > this.sed[k]) this.firm[k] = this.sed[k];
        removed += r * this.dx * this.dz;
      }
    if (removed > 0) {
      this.markDirty(i0, i1, j0, j1);
      this.relaxActive = Math.max(this.relaxActive, 1.0);
    }
    return removed;
  }

  /**
   * Smooth brush: relaxes the total surface toward its local average. Only the added sand
   * layer changes (valleys may receive sand, peaks lose only added sand).
   */
  smoothSediment(x: number, z: number, radius: number, strength: number) {
    const { nx, nz, base, sed } = this;
    const i0 = Math.max(2, Math.floor((x - radius * 1.4 - this.x0) / this.dx));
    const i1 = Math.min(nx - 3, Math.ceil((x + radius * 1.4 - this.x0) / this.dx));
    const j0 = Math.max(2, Math.floor((z - radius * 1.4 - this.z0) / this.dz));
    const j1 = Math.min(nz - 3, Math.ceil((z + radius * 1.4 - this.z0) / this.dz));
    if (i1 < i0 || j1 < j0) return 0;
    const H = (k: number) => base[k] + sed[k];
    const delta: number[] = [];
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        const px = (this.x0 + i * this.dx - x) / radius,
          pz = (this.z0 + j * this.dz - z) / radius;
        const w = Math.exp(-(px * px + pz * pz) * 1.8);
        if (w < 0.02) {
          delta.push(0);
          continue;
        }
        let avg = 0;
        for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) avg += H((j + b) * nx + i + a);
        avg /= 25;
        let dlt = (avg - H(k)) * Math.min(1, strength) * w;
        if (dlt < 0) dlt = -Math.min(-dlt, sed[k]);
        // smoothing alone never builds land above the water
        if (dlt > 0 && H(k) + dlt > CONFIG.world.waterLevel + 1.6) dlt = 0;
        delta.push(dlt);
      }
    let changed = 0,
      q = 0;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const dlt = delta[q++];
        if (dlt === 0) continue;
        const k = j * nx + i;
        sed[k] = Math.max(0, Math.min(CONFIG.sand.maxSediment, sed[k] + dlt));
        if (this.firm[k] > sed[k]) this.firm[k] = sed[k];
        changed += Math.abs(dlt);
      }
    if (changed > 0) this.markDirty(i0, i1, j0, j1);
    return changed;
  }

  /**
   * Island Stamp: adds a parametric sand bar (dome rising just above the water line) to the
   * removable sand layer, so it can be shaped with the other brushes or erased later.
   */
  stampIsland(x: number, z: number, radius: number) {
    const { nx, nz, base, sed } = this;
    const level = CONFIG.world.waterLevel;
    const top = level + CONFIG.sand.islandCrest;
    // Profile of a real sand island: a gently domed beach plateau, a smooth beach face down to
    // the waterline at `radius`, then a concave shoreface (Dean-type, depth ∝ distance^(2/3))
    // that flares out until it meets the seabed — a sand bar, not a spike from the deep floor.
    const skirt = 8;
    const reach = radius * 1.2 + skirt;
    const i0 = Math.max(0, Math.floor((x - reach - this.x0) / this.dx));
    const i1 = Math.min(nx - 1, Math.ceil((x + reach - this.x0) / this.dx));
    const j0 = Math.max(0, Math.floor((z - reach - this.z0) / this.dz));
    const j1 = Math.min(nz - 1, Math.ceil((z + reach - this.z0) / this.dz));
    let added = 0;
    const seed = x * 1.7 + z * 3.1;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        const px = this.x0 + i * this.dx - x,
          pz = this.z0 + j * this.dz - z;
        const ang = Math.atan2(pz, px);
        const wob = 1 + 0.12 * Math.sin(ang * 3 + seed) + 0.06 * Math.sin(ang * 5 - seed);
        const d = Math.sqrt(px * px + pz * pz) / wob; // world units, with a wobbly coastline
        const rn = d / radius;
        let target: number;
        if (rn <= 0.55) target = top - 0.06 * (rn / 0.55) ** 2;
        else if (rn <= 1) target = top - 0.06 + (level - 0.18 - (top - 0.06)) * smoothstep(0.55, 1, rn);
        else {
          const u = d - radius;
          target = level - 0.18 - 1.25 * Math.pow(u, 0.67) - 0.02 * u * u;
        }
        const h = base[k] + sed[k];
        if (target > h) {
          const add = Math.min(target - h, CONFIG.sand.maxSediment - sed[k]);
          sed[k] += add;
          this.firm[k] += add;
          added += add * this.dx * this.dz;
        }
      }
    if (added > 0) {
      this.markDirty(i0, i1, j0, j1);
      this.relaxActive = Math.max(this.relaxActive, 1.5);
    }
    return added;
  }

  /** Angle-of-repose relaxation: steep added sand slides to lower neighbours. */
  relax(dt: number) {
    if (this.relaxActive <= 0) return;
    this.relaxActive -= dt;
    const slope = CONFIG.sand.reposeSlope;
    const { nx, nz, base, sed, firm } = this;
    const mx = slope * this.dx,
      mz = slope * this.dz;
    let moved = false;
    let i0 = nx,
      i1 = 0,
      j0 = nz,
      j1 = 0;
    for (let it = 0; it < 2; it++) {
      for (let j = 0; j < nz; j++)
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          const hk = base[k] + sed[k];
          // +x neighbour
          if (i < nx - 1) {
            const n = k + 1;
            const hn = base[n] + sed[n];
            const d = hk - hn;
            if (d > mx && sed[k] - firm[k] > 0) {
              const m = Math.min((d - mx) * 0.45, sed[k] - firm[k]);
              sed[k] -= m;
              sed[n] += m;
              moved = true;
              i0 = Math.min(i0, i);
              i1 = Math.max(i1, i + 1);
              j0 = Math.min(j0, j);
              j1 = Math.max(j1, j);
            } else if (-d > mx && sed[n] - firm[n] > 0) {
              const m = Math.min((-d - mx) * 0.45, sed[n] - firm[n]);
              sed[n] -= m;
              sed[k] += m;
              moved = true;
              i0 = Math.min(i0, i);
              i1 = Math.max(i1, i + 1);
              j0 = Math.min(j0, j);
              j1 = Math.max(j1, j);
            }
          }
          if (j < nz - 1) {
            const n = k + nx;
            const hk2 = base[k] + sed[k];
            const hn = base[n] + sed[n];
            const d = hk2 - hn;
            if (d > mz && sed[k] - firm[k] > 0) {
              const m = Math.min((d - mz) * 0.45, sed[k] - firm[k]);
              sed[k] -= m;
              sed[n] += m;
              moved = true;
              i0 = Math.min(i0, i);
              i1 = Math.max(i1, i);
              j0 = Math.min(j0, j);
              j1 = Math.max(j1, j + 1);
            } else if (-d > mz && sed[n] - firm[n] > 0) {
              const m = Math.min((-d - mz) * 0.45, sed[n] - firm[n]);
              sed[n] -= m;
              sed[k] += m;
              moved = true;
              i0 = Math.min(i0, i);
              i1 = Math.max(i1, i);
              j0 = Math.min(j0, j);
              j1 = Math.max(j1, j + 1);
            }
          }
        }
    }
    if (moved) this.markDirty(i0 - 1, i1 + 1, j0 - 1, j1 + 1);
  }

  private markDirty(i0: number, i1: number, j0: number, j1: number) {
    const d = this.dirty;
    i0 = Math.max(0, i0);
    j0 = Math.max(0, j0);
    i1 = Math.min(this.nx - 1, i1);
    j1 = Math.min(this.nz - 1, j1);
    if (!d.any) {
      d.any = true;
      d.i0 = i0;
      d.i1 = i1;
      d.j0 = j0;
      d.j1 = j1;
    } else {
      d.i0 = Math.min(d.i0, i0);
      d.i1 = Math.max(d.i1, i1);
      d.j0 = Math.min(d.j0, j0);
      d.j1 = Math.max(d.j1, j1);
    }
  }

  /** Added-sand state: [sed..., firm...]. */
  snapshot(): Float32Array {
    const n = this.sed.length;
    const out = new Float32Array(n * 2);
    out.set(this.sed, 0);
    out.set(this.firm, n);
    return out;
  }
  restore(s: Float32Array) {
    const n = this.sed.length;
    this.sed.set(s.subarray(0, n));
    if (s.length >= n * 2) this.firm.set(s.subarray(n, n * 2));
    else this.firm.fill(0);
    this.markDirty(0, this.nx - 1, 0, this.nz - 1);
  }
  clearSediment() {
    this.sed.fill(0);
    this.firm.fill(0);
    this.markDirty(0, this.nx - 1, 0, this.nz - 1);
  }
  hasSediment() {
    for (let k = 0; k < this.sed.length; k++) if (this.sed[k] > 0) return true;
    return false;
  }

  /** Pushes changed heights to the GPU meshes (only the dirty region). */
  update(dt: number) {
    this.relax(dt);
    const d = this.dirty;
    if (!d.any) return;
    d.any = false;
    this.version++;
    const { nx, nz, base, sed } = this;
    const pos = this.topGeo.attributes.position as THREE.BufferAttribute;
    const nor = this.topGeo.attributes.normal as THREE.BufferAttribute;
    const aSed = this.topGeo.attributes.aSed as THREE.BufferAttribute;
    const H = (i: number, j: number) => {
      i = clamp(i, 0, nx - 1);
      j = clamp(j, 0, nz - 1);
      const k = j * nx + i;
      return base[k] + sed[k];
    };
    for (let j = d.j0; j <= d.j1; j++)
      for (let i = d.i0; i <= d.i1; i++) {
        const k = j * nx + i;
        pos.setY(k, base[k] + sed[k]);
        aSed.setX(k, sed[k]);
      }
    for (let j = Math.max(0, d.j0 - 1); j <= Math.min(nz - 1, d.j1 + 1); j++)
      for (let i = Math.max(0, d.i0 - 1); i <= Math.min(nx - 1, d.i1 + 1); i++) {
        const k = j * nx + i;
        const hx = (H(i + 1, j) - H(i - 1, j)) / (2 * this.dx);
        const hz = (H(i, j + 1) - H(i, j - 1)) / (2 * this.dz);
        const l = Math.hypot(hx, 1, hz);
        nor.setXYZ(k, -hx / l, 1 / l, -hz / l);
      }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    aSed.needsUpdate = true;
    // front cut: last z row
    if (d.j1 >= nz - 2) this.updateFront(d.i0, d.i1);
  }

  private updateFront(i0: number, i1: number) {
    const pos = this.frontGeo.attributes.position as THREE.BufferAttribute;
    const aSed = this.frontGeo.attributes.aSed as THREE.BufferAttribute;
    const R = this.frontRows;
    const j = this.nz - 1;
    const yb = CONFIG.world.bottomY;
    for (let i = i0; i <= i1; i++) {
      const k = j * this.nx + i;
      const top = this.base[k] + this.sed[k];
      for (let r = 0; r <= R; r++) {
        const v = i * (R + 1) + r;
        pos.setY(v, frontRowY(yb, top, r / R));
        aSed.setX(v, this.sed[k]);
      }
    }
    pos.needsUpdate = true;
    aSed.needsUpdate = true;
  }

  // ---------------------------------------------------------------- geometry
  private buildTopGeometry() {
    const { nx, nz } = this;
    const pos = new Float32Array(nx * nz * 3);
    const nor = new Float32Array(nx * nz * 3);
    const sedA = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        pos[k * 3] = this.x0 + i * this.dx;
        pos[k * 3 + 1] = this.base[k];
        pos[k * 3 + 2] = this.z0 + j * this.dz;
      }
    const idx: number[] = [];
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i,
          b = a + 1,
          c = a + nx,
          d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('aSed', new THREE.BufferAttribute(sedA, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.boundingSphere!.radius += 10;
    return g;
  }

  private buildFrontGeometry() {
    const R = this.frontRows;
    const nx = this.nx;
    const j = this.nz - 1;
    const yb = CONFIG.world.bottomY;
    const z = CONFIG.world.zFront + 0.02;
    const pos = new Float32Array(nx * (R + 1) * 3);
    const nor = new Float32Array(nx * (R + 1) * 3);
    const aTop = new Float32Array(nx * (R + 1));
    const aTopS = new Float32Array(nx * (R + 1));
    const aSed = new Float32Array(nx * (R + 1));
    // heavily smoothed contour for flat deep strata
    const tops: number[] = [];
    for (let i = 0; i < nx; i++) tops.push(this.base[j * nx + i]);
    const smooth: number[] = [];
    const win = 40;
    for (let i = 0; i < nx; i++) {
      let s = 0,
        c = 0;
      for (let q = -win; q <= win; q++) {
        const ii = clamp(i + q, 0, nx - 1);
        s += Math.min(tops[ii], CONFIG.world.shelfY + 0.3);
        c++;
      }
      smooth.push(s / c);
    }
    for (let i = 0; i < nx; i++) {
      const x = this.x0 + i * this.dx;
      for (let r = 0; r <= R; r++) {
        const v = i * (R + 1) + r;
        pos.set([x, frontRowY(yb, tops[i], r / R), z], v * 3);
        nor.set([0, 0, 1], v * 3);
        aTop[v] = tops[i];
        aTopS[v] = smooth[i];
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < nx - 1; i++)
      for (let r = 0; r < R; r++) {
        const a = i * (R + 1) + r,
          b = (i + 1) * (R + 1) + r;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('aTop', new THREE.BufferAttribute(aTop, 1));
    g.setAttribute('aTopS', new THREE.BufferAttribute(aTopS, 1));
    g.setAttribute('aSed', new THREE.BufferAttribute(aSed, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.boundingSphere!.radius += 10;
    return g;
  }
}

/** Front rows are denser near the top contour where strata detail lives. */
function frontRowY(bottom: number, top: number, t: number) {
  const s = 1 - Math.pow(1 - t, 2.2);
  return bottom + (top - bottom) * s;
}

const SRGB = /* glsl */ `vec3 s2l(vec3 c){ return pow(c, vec3(2.2)); }`;

function makeTopMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSed; varying float vSed; varying vec3 vWPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvSed = aSed; vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vSed; varying vec3 vWPos;
        uniform float uTime; uniform float uWaterLevel; uniform float uCausticStrength; uniform vec3 uCausticColor;
        ${GLSL_NOISE}
        ${SRGB}`,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        /* glsl */ `
        float y = vWPos.y;
        float n1 = jFbm(vWPos.xz * vec2(0.9, 1.6));
        float n2 = jNoise(vWPos.xz * 26.0);
        vec3 dry = s2l(vec3(0.96, 0.88, 0.70));
        vec3 wet = s2l(vec3(0.80, 0.69, 0.52));
        vec3 sea = s2l(vec3(0.90, 0.84, 0.70));
        float wl = uWaterLevel;
        float dryF = smoothstep(wl + 0.1, wl + 0.42, y + (n1 - 0.5) * 0.25);
        float wetF = smoothstep(wl - 0.9, wl + 0.02, y);
        vec3 col = mix(sea, wet, wetF);
        col = mix(col, dry, dryF);
        // silt / algae patches on the seabed
        float patchF = smoothstep(0.52, 0.72, n1) * (1.0 - wetF);
        col = mix(col, col * vec3(0.84, 0.9, 0.8), patchF);
        col = mix(col, col * vec3(0.92, 0.88, 0.84), smoothstep(0.35, 0.2, n1) * (1.0 - wetF) * 0.6);
        // ripple marks on shallow sand
        float rip = sin(vWPos.x * 7.0 + jNoise(vWPos.xz * 1.5) * 4.0) * 0.5 + 0.5;
        col *= 1.0 - rip * 0.05 * (1.0 - dryF);
        col *= 0.9 + 0.18 * n2;
        {
          vec2 sp = vWPos.xz * 30.0; vec2 sid = floor(sp);
          vec2 sf = fract(sp) - 0.5 - (jHash22(sid) - 0.5) * 0.6;
          float speck = step(0.9, jHash12(sid)) * smoothstep(0.22, 0.1, length(sf));
          col = mix(col, s2l(vec3(0.45, 0.37, 0.30)), speck * 0.5);
          vec2 sp2 = vWPos.xz * 42.0 + 3.0; vec2 sid2 = floor(sp2);
          vec2 sf2 = fract(sp2) - 0.5 - (jHash22(sid2) - 0.5) * 0.6;
          col = mix(col, s2l(vec3(1.0, 0.95, 0.88)), step(0.95, jHash12(sid2)) * smoothstep(0.2, 0.08, length(sf2)) * 0.6);
        }
        // freshly added sand: lighter and finer
        float fresh = smoothstep(0.004, 0.05, vSed);
        col = mix(col, s2l(vec3(1.0, 0.9, 0.68)) * (0.95 + 0.1 * n2), fresh);
        vec4 diffuseColor = vec4(col, opacity);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          float uwDepth = uWaterLevel - vWPos.y;
          if (uwDepth > 0.0) {
            float c = jCaustics(vWPos.xz * 0.95, uTime * 0.9);
            float fade = exp(-uwDepth * 0.1) * smoothstep(0.0, 0.35, uwDepth);
            outgoingLight += uCausticColor * c * fade * uCausticStrength * diffuseColor.rgb;
          }
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-top';
  return mat;
}

function makeFrontMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aTop; attribute float aTopS; attribute float aSed; varying float vTop; varying float vTopS; varying float vSed; varying vec3 vWPos;',
      )
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvTop = aTop; vTopS = aTopS; vSed = aSed; vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vTop; varying float vTopS; varying float vSed; varying vec3 vWPos;
        uniform float uWaterLevel;
        ${GLSL_NOISE}
        ${SRGB}
        vec3 band(vec3 a, vec3 b, float x, float e, float w){ return mix(a, b, smoothstep(e - w, e + w, x)); }`,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        /* glsl */ `
        float y = vWPos.y;
        float dBase = vTop - y;
        float L = mix(dBase, vTopS - y, smoothstep(0.6, 2.6, dBase));
        float wob = (jFbm(vec2(vWPos.x * 0.45, L * 0.7)) - 0.5) * 0.28;
        float Lw = L + wob;
        float g = jNoise(vWPos.xy * vec2(30.0, 34.0));
        vec3 pale = s2l(vec3(0.93, 0.85, 0.68));
        vec3 beige = s2l(vec3(0.86, 0.73, 0.54));
        vec3 tan = s2l(vec3(0.74, 0.60, 0.43));
        vec3 silt = s2l(vec3(0.55, 0.49, 0.43));
        vec3 rock = s2l(vec3(0.32, 0.29, 0.28));
        vec3 col = pale;
        col = band(col, beige, Lw, 0.32, 0.06);
        col = band(col, tan, Lw, 0.66, 0.08);
        col = band(col, silt, Lw, 1.45, 0.1);
        col = band(col, rock, Lw, 2.35, 0.14);
        // thin dark seam and a shell-hash line
        col *= 1.0 - 0.28 * exp(-pow((Lw - 0.6) / 0.025, 2.0));
        float shellLine = exp(-pow((Lw - 1.3) / 0.05, 2.0));
        {
          vec2 sc = vWPos.xy * vec2(16.0, 22.0);
          vec2 sid = floor(sc); vec2 sf = fract(sc) - 0.5 - (jHash22(sid) - 0.5) * 0.6;
          float blob = smoothstep(0.32, 0.18, length(sf * vec2(1.0, 1.6))) * step(0.45, jHash12(sid + 3.3));
          col = mix(col, s2l(vec3(0.97, 0.94, 0.88)), shellLine * blob * 0.85);
        }
        // laminations in the silt
        col *= 1.0 - 0.07 * smoothstep(1.4, 1.6, Lw) * (1.0 - smoothstep(2.2, 2.4, Lw)) * (0.5 + 0.5 * sin(Lw * 46.0));
        // pebbles in the tan layer and cracks in rock
        vec2 cell = floor(vWPos.xy * vec2(7.0, 9.0));
        float peb = step(0.8, jHash12(cell)) * smoothstep(0.7, 0.8, Lw) * (1.0 - smoothstep(1.3, 1.4, Lw));
        vec2 f = fract(vWPos.xy * vec2(7.0, 9.0)) - 0.5 - (jHash22(cell + 1.7) - 0.5) * 0.5;
        float pr = mix(0.12, 0.3, jHash12(cell + 9.1));
        float pebMask = smoothstep(pr, pr * 0.6, length(f * vec2(1.0, 1.3)));
        vec3 pebCol = s2l(mix(vec3(0.5, 0.45, 0.4), vec3(0.72, 0.66, 0.58), jHash12(cell + 7.0)));
        col = mix(col, pebCol * (0.85 + 0.3 * (0.5 - f.y)), peb * pebMask);
        float crack = smoothstep(0.03, 0.0, abs(jFbm(vWPos.xy * vec2(1.2, 2.2)) - 0.5)) * smoothstep(2.3, 2.6, Lw);
        col *= 1.0 - crack * 0.4;
        // grain
        col *= 0.9 + 0.2 * g;
        // wet sand below the waterline darkens slightly
        col *= mix(1.0, 0.88, smoothstep(uWaterLevel + 0.15, uWaterLevel - 0.25, y) * (1.0 - smoothstep(0.0, 0.4, dBase)));
        // freshly added sand on top of the cut
        if (y > vTop - 0.002) {
          vec3 fresh = s2l(vec3(1.0, 0.9, 0.68));
          float strat = 0.5 + 0.5 * sin((y - vTop) * 60.0 + jNoise(vWPos.xy * 3.0) * 3.0);
          col = fresh * (0.92 + 0.06 * strat + 0.08 * g);
        }
        // soft rounded-edge highlight on the lip of the cut
        float lip = exp(-max(vTop + vSed - y, 0.0) * 22.0);
        col = mix(col, col * 1.18 + 0.02, lip * 0.6);
        // ambient occlusion with depth
        col *= mix(1.0, 0.62, smoothstep(0.0, 4.5, dBase));
        vec4 diffuseColor = vec4(col, opacity);`,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-front';
  return mat;
}
