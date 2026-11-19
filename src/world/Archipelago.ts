import * as THREE from 'three';
import { CONFIG } from '../config';
import { Rng, smoothstep } from '../util/math';
import { fbm2 } from '../util/noise';
import { patchMaterial } from '../util/shaders';
import { rockGeometry } from '../util/geometry';
import type { TerrainSystem } from './TerrainSystem';
import type { Island } from './Island';

/**
 * V2 (P1) micro-archipelago around the v1 diorama.
 *
 * Layout (x left → right, z front 6 → back -22.6):
 *   west  — the shallow lagoon: a sand cay with a tidal flat, a cluster of dark boulders right
 *           beside it, a low granite-boulder island with palms at the back, and patch reefs +
 *           seagrass meadows all over the lagoon floor (see Reef.buildArchipelago)
 *   core  — the v1 main island + reef, unchanged (|x| < 23 and z > -13 keep v1 base terrain)
 *   east  — the seabed drops away into deep water (reserved for deep-sea life later)
 *
 * Every shape here is a pure function of (x, z) so the base terrain stays deterministic and
 * old saves (which only store added sand) land on exactly the same ground as before.
 */
export const ARCHI = {
  /** Sand cay: dry land at mid tide, a wide tidal flat that dries at low tide. */
  cay: { x: -34, z: -4.4, rx: 5.2, rz: 2.1, rot: 0.15, crest: 0.55 },
  /** A cluster of dark weathered boulders on a rocky reef flat, right beside the cay. */
  rocks: { x: -41.4, z: -6.4, r: 2.5 },
  /** Low island of big rounded granite boulders on a sandy beach, at the back. */
  granite: { x: -43.5, z: -13.4, r: 3.0 },
  /** The east drops into deep water from here (≈ a third of the tray with the far back strip). */
  deep: { xMin: 27, xFull: 37, floor: -10.4 },
};

/** Weight that is exactly 0 inside the v1 core region (|x| < 23, z > -13). */
export const outsideCore = (x: number, z: number) => Math.max(smoothstep(23, 26.5, Math.abs(x)), smoothstep(13.2, 15.5, -z));

/** West lagoon weight: 0 at x = -23, 1 from x = -30 outward. */
export const westWeight = (x: number) => smoothstep(23, 30, -x);

/**
 * Archipelago contribution to the base terrain. `y` is the v1 base height; returns the new one.
 * Zero change inside the v1 core region.
 */
export function archipelagoHeight(x: number, z: number, y0: number): number {
  const k = outsideCore(x, z);
  if (k <= 0) return y0;
  return y0 + (shapeHeight(x, z, y0) - y0) * k;
}

/**
 * Low sandy island profile by `e`, the distance (world units) beyond the dry-land outline
 * (negative inside): a gentle dome, a beach, a wide tidal flat, then a soft shoreface.
 */
function beachProfile(e: number, crest: number) {
  if (e < 0) {
    const f = Math.min(1, -e / 2.2);
    return 0.15 + (crest - 0.15) * (1 - (1 - f) * (1 - f));
  }
  if (e < 1.8) return 0.15 - 0.27 * e; // beach + tidal flat (dries at low tide)
  return 0.15 - 0.27 * 1.8 - 0.6 * Math.pow(e - 1.8, 1.2);
}

function shapeHeight(x: number, z: number, y: number): number {
  // ---- calm far back strip: a gentle hollow behind the v1 back ridge, rising to the far wall
  const back = smoothstep(13.5, 17.5, -z);
  if (back > 0) y += -0.55 * back + 0.75 * smoothstep(19.5, 22.4, -z) + 0.18 * Math.sin(x * 0.21 + z * 0.4) * back;

  // ---- east: the seabed slides down a long slope into deep, quiet water
  const D = ARCHI.deep;
  const east = smoothstep(D.xMin, D.xFull, x + 1.2 * Math.sin(z * 0.35));
  if (east > 0) {
    const target = D.floor + 0.35 * Math.sin(x * 0.13 - z * 0.27) + 0.4 * fbm2(x * 0.06 + 4, z * 0.09, 2);
    // the drop-off comes down in three soft rocky ledges (risers read as rock, treads as sand)
    const u = Math.max(0, east * 3 + 0.25 * fbm2(x * 0.3, z * 0.3 + 5, 2));
    const k = Math.min(2, Math.floor(u)),
      f = Math.min(1, Math.max(0, u - k));
    const stair = (k + smoothstep(0.3, 0.75, f)) / 3;
    const t = east < 1 ? east * 0.4 + stair * 0.6 : 1;
    y += (target - y) * t;
  }

  // ---- west lagoon: shallow sand, slightly deeper toward the far west and the back
  const west = westWeight(x);
  if (west > 0) {
    // a little deeper than the v1 shelf, so the patch reefs have room under the surface
    y += west * (-0.7 - 0.45 * smoothstep(30, 46, -x) - 0.35 * smoothstep(5, 16, -z) + 0.18 * fbm2(x * 0.11, z * 0.13 + 3, 2));

    // sand cay with a tidal flat
    const S = ARCHI.cay;
    const c = Math.cos(S.rot),
      s = Math.sin(S.rot);
    const u = ((x - S.x) * c + (z - S.z) * s) / S.rx,
      v = (-(x - S.x) * s + (z - S.z) * c) / S.rz;
    const d = Math.sqrt(u * u + v * v);
    const ang = Math.atan2(v, u);
    const wob = 1 + 0.08 * Math.sin(ang * 3 + 1.1) + 0.05 * Math.sin(ang * 5 - 0.4);
    const e = (d / wob - 1) * Math.min(S.rx, S.rz);
    if (e < 10) {
      const prof = beachProfile(e, S.crest) + 0.03 * Math.sin(x * 2.1 + z * 1.3);
      const w = (1 - smoothstep(8.5, 10, e)) * west;
      if (prof > y) y = y + (prof - y) * w;
    }

    // rocky reef flat under the boulder cluster (joins the cay's tidal flat)
    const R = ARCHI.rocks;
    const rr = Math.hypot(x - R.x, (z - R.z) * 1.15);
    if (rr < R.r * 2.6) {
      const rough = 0.3 * fbm2(x * 1.3 + 7, z * 1.3, 3) + 0.1 * Math.sin(x * 3.1) * Math.cos(z * 2.7);
      const top = -0.25 + rough;
      const f = 1 - smoothstep(R.r * 0.6, R.r * 2.6, rr);
      const k = f * f * (3 - 2 * f) * west;
      if (top > y) y = y + (top - y) * k;
    }

    // low sandy island under the granite boulders
    const G = ARCHI.granite;
    const gr = Math.hypot(x - G.x, (z - G.z) * 1.1);
    const ge = (gr / (1 + 0.07 * Math.sin(Math.atan2(z - G.z, x - G.x) * 4))) - G.r;
    if (ge < 10) {
      const prof = beachProfile(ge, 0.5);
      const w = (1 - smoothstep(8.5, 10, ge)) * west;
      if (prof > y) y = y + (prof - y) * w;
    }
  }
  return y;
}

/**
 * Above-water dressing of the new islands: beach plants and palms on the cay, the dark boulder
 * cluster, and the stacked granite boulders. Purely decorative: not selectable, never saved.
 */
export class Archipelago {
  readonly group = new THREE.Group();
  private rng = new Rng(2024);
  private rockMat: THREE.MeshStandardMaterial;
  private darkRockMat: THREE.MeshStandardMaterial;
  private graniteMat: THREE.MeshStandardMaterial;
  private graniteMat2: THREE.MeshStandardMaterial;

  constructor(private terrain: TerrainSystem, private island: Island) {
    this.rockMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.95 }), {
      caustics: true,
      bump: { scale: 6, strength: 0.6 },
      key: 'archi-rock',
    });
    this.darkRockMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x4f4a48, roughness: 0.92 }), {
      caustics: true,
      bump: { scale: 5, strength: 0.7 },
      key: 'archi-dark',
    });
    // weathered pink-grey granite: smooth rounded boulders like Seychelles beaches
    this.graniteMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xb4a49a, roughness: 0.8 }), {
      caustics: true,
      bump: { scale: 3.5, strength: 0.35 },
      key: 'archi-granite',
    });
    this.graniteMat2 = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x9a8a84, roughness: 0.85 }), {
      caustics: true,
      bump: { scale: 4, strength: 0.4 },
      key: 'archi-granite2',
    });
    this.buildCay();
    this.buildRockCluster();
    this.buildGraniteIsland();
  }

  private rock(x: number, z: number, r: number, mat: THREE.Material, sink = 0.35, squash = 0.75, rough = 0.35, y?: number) {
    const m = new THREE.Mesh(rockGeometry(r, 3, this.rng.range(0, 100), squash, rough), mat);
    m.position.set(x, y ?? this.terrain.heightAt(x, z) - r * sink, z);
    m.rotation.y = this.rng.range(0, Math.PI * 2);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  /** Point on the cay in its local frame (u along the long axis, v across). */
  private cayPoint(u: number, v: number): [number, number] {
    const S = ARCHI.cay;
    const c = Math.cos(S.rot),
      s = Math.sin(S.rot);
    return [S.x + u * c - v * s, S.z + u * s + v * c];
  }

  private buildCay() {
    const S = ARCHI.cay;
    // beach vegetation: grass tufts, low shrubs, two palms rooted in the sand
    const tufts: [number, number][] = [];
    for (let i = 0; i < 22; i++) {
      const a = this.rng.range(0, Math.PI * 2),
        r = Math.sqrt(this.rng.range(0, 1)) * 0.75;
      tufts.push(this.cayPoint(Math.cos(a) * r * S.rx, Math.sin(a) * r * S.rz));
    }
    this.island.addDecorGrass(tufts, this.group);
    const bushes: [number, number, number, 'green' | 'ti' | 'hibiscus'][] = [
      [-1.6, 0.4, 0.55, 'green'],
      [-0.4, -0.7, 0.5, 'green'],
      [1.2, 0.5, 0.45, 'ti'],
      [2.6, -0.3, 0.4, 'green'],
      [-2.8, -0.3, 0.38, 'hibiscus'],
      [0.4, 0.9, 0.36, 'green'],
    ];
    for (const [u, v, s, k] of bushes) {
      const [x, z] = this.cayPoint(u, v);
      this.island.addDecorBush(x, z, s, k, this.group);
    }
    const [p1x, p1z] = this.cayPoint(-0.9, -0.2);
    const [p2x, p2z] = this.cayPoint(1.9, 0.3);
    this.island.addDecorPalm(p1x, p1z, 2.9, -0.55, 0.35, 1.3, this.group);
    this.island.addDecorPalm(p2x, p2z, 2.4, 0.6, -0.2, 3.7, this.group);
    // pebbles and a few beach stones along the shore
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + this.rng.range(-0.25, 0.25);
      const [x, z] = this.cayPoint(Math.cos(a) * S.rx * 1.05, Math.sin(a) * S.rz * 1.05);
      if (z > CONFIG.world.zFront - 0.8) continue;
      this.rock(x, z, this.rng.range(0.1, 0.24), this.rockMat, 0.4, 0.6);
    }
    // a bleached driftwood log on the beach
    const log = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 1.6, 8),
      new THREE.MeshStandardMaterial({ color: 0xc8bba4, roughness: 0.9 }),
    );
    const [lx, lz] = this.cayPoint(0.6, -1.5);
    log.position.set(lx, this.terrain.heightAt(lx, lz) + 0.05, lz);
    log.rotation.set(0.05, 0.6, Math.PI / 2);
    log.castShadow = true;
    log.receiveShadow = true;
    this.group.add(log);
  }

  private buildRockCluster() {
    const R = ARCHI.rocks;
    // dark weathered boulders breaking the surface on a rocky reef flat
    const spots: [number, number, number][] = [
      [0, 0, 1.05],
      [1.4, 0.5, 0.8],
      [-1.3, 0.4, 0.75],
      [0.6, -1.1, 0.7],
      [-0.6, 1.25, 0.55],
      [2.3, -0.6, 0.5],
      [-2.2, -0.7, 0.5],
      [1.1, 1.6, 0.45],
      [3.0, 0.9, 0.36],
      [-2.9, 0.8, 0.35],
      [-1.5, -1.7, 0.4],
    ];
    for (const [dx, dz, r] of spots) this.rock(R.x + dx, R.z + dz, r, dx * dz > 0 ? this.darkRockMat : this.rockMat, 0.25, 0.8);
    this.island.addDecorBush(R.x + 0.1, R.z + 0.15, 0.42, 'green', this.group, 0.75);
    this.island.addDecorBush(R.x - 1.15, R.z + 0.35, 0.3, 'green', this.group, 0.5);
  }

  private buildGraniteIsland() {
    const G = ARCHI.granite;
    const ground = (dx: number, dz: number) => this.terrain.heightAt(G.x + dx, G.z + dz);
    // [dx, dz, radius, squash] — big rounded boulders on the sand, a few resting on others
    const base: [number, number, number, number][] = [
      [0, 0, 1.35, 0.78],
      [1.7, 0.5, 1.0, 0.82],
      [-1.6, 0.4, 0.95, 0.8],
      [0.5, -1.3, 0.85, 0.85],
      [-0.7, 1.3, 0.7, 0.85],
      [2.5, -0.8, 0.55, 0.9],
    ];
    const tops: { x: number; z: number; y: number; r: number }[] = [];
    base.forEach(([dx, dz, r, sq], i) => {
      const y = ground(dx, dz) - r * sq * 0.3;
      this.rock(G.x + dx, G.z + dz, r, i % 2 ? this.graniteMat2 : this.graniteMat, 0, sq, 0.12, y);
      tops.push({ x: dx, z: dz, y: y + r * sq * 0.92, r });
    });
    // two stacked boulders: the tor that gives the island its silhouette
    const stack: [number, number, number][] = [
      [0, 0.75, 0.82],
      [1, 0.55, 0.88],
    ];
    for (const [i, r, sq] of stack) {
      const t = tops[i];
      this.rock(G.x + t.x + 0.15, G.z + t.z - 0.1, r, this.graniteMat, 0, sq, 0.12, t.y + r * sq * 0.2);
    }
    // palms rooted in the beach sand around the boulders, leaning out toward the light
    const palms: [number, number, number, number][] = [
      [-2.7, -0.9, 2.6, 1.1],
      [2.4, 1.4, 2.2, 2.9],
      [-0.6, 2.6, 2.0, 4.6],
    ];
    for (const [dx, dz, h, ph] of palms) {
      const l = Math.hypot(dx, dz);
      this.island.addDecorPalm(G.x + dx, G.z + dz, h, (dx / l) * 0.6, (dz / l) * 0.4, ph, this.group);
    }
    const bushes: [number, number, number, 'green' | 'ti' | 'hibiscus'][] = [
      [-2.2, 0.9, 0.5, 'green'],
      [1.2, 1.9, 0.45, 'hibiscus'],
      [2.9, 0.2, 0.4, 'green'],
      [-1.0, -2.1, 0.42, 'ti'],
    ];
    for (const [dx, dz, s, k] of bushes) this.island.addDecorBush(G.x + dx, G.z + dz, s, k, this.group);
    const tufts: [number, number][] = [];
    for (let i = 0; i < 14; i++) {
      const a = this.rng.range(0, Math.PI * 2),
        r = this.rng.range(1.9, 2.9);
      tufts.push([G.x + Math.cos(a) * r, G.z + (Math.sin(a) * r) / 1.1]);
    }
    this.island.addDecorGrass(tufts, this.group);
  }
}
