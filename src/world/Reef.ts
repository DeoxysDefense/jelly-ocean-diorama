import * as THREE from 'three';
import { Rng } from '../util/math';
import { CONFIG } from '../config';
import { patchMaterial } from '../util/shaders';
import type { TerrainSystem } from './TerrainSystem';
import * as F from './coralFactory';
import { ARCHI } from './Archipelago';

export interface Selectable {
  id: string;
  kind: 'coral' | 'rock' | 'shell' | 'seagrass';
  label: string;
  object: THREE.Object3D;
  /** Footprint radius in xz for placement validation / obstacle avoidance. */
  radius: number;
  height: number;
  home: { pos: THREE.Vector3; rotY: number };
  outlines: THREE.Object3D[];
  /** Octopus may hide inside / behind it. */
  hideSpot: boolean;
  /** Habitat role in the creature AI. */
  habitat?: 'anemone' | 'cave' | 'shell';
  /** Placed by the user (Place tool) — saved with the world. */
  user?: boolean;
  /** Place-tool type (used to rebuild user objects on load). */
  type?: PlaceType;
  seed?: number;
  placedAt?: number;
  /** V2 journal: when / under what sky it was placed, and a user-given name. */
  bornAt?: number;
  birth?: import('../content/journal').BirthMeta;
  /** Left by a creature (a hermit crab's old shell): saved with the world, not "made by you". */
  natural?: boolean;
}

export type PlaceType = 'anemone' | 'cave' | 'branching' | 'brain' | 'fan' | 'seagrass' | 'rock' | 'shell';

export const PLACE_TYPES: { id: PlaceType; label: string; note: string }[] = [
  { id: 'anemone', label: 'Anemone', note: 'Clownfish may move in' },
  { id: 'cave', label: 'Cave rock', note: 'The octopus may adopt it' },
  { id: 'shell', label: 'Empty shell', note: 'Hermit crabs may switch' },
  { id: 'branching', label: 'Staghorn', note: 'Branching coral' },
  { id: 'brain', label: 'Brain coral', note: 'Massive coral' },
  { id: 'fan', label: 'Sea fan', note: 'Sways in the current' },
  { id: 'seagrass', label: 'Seagrass', note: 'Fish swim through it' },
  { id: 'rock', label: 'Rock', note: 'Reef rock' },
];

export interface Obstacle {
  center: THREE.Vector3;
  radius: number;
}

/**
 * Builds the underwater ecosystem decor and keeps the registry of selectable objects,
 * static obstacles and octopus hiding spots.
 */
/** Global size multiplier for reef props (procedural assets are authored at ~1 unit). */
const S = 1.55;

export class Reef {
  readonly group = new THREE.Group();
  readonly selectables: Selectable[] = [];
  readonly fixedObstacles: Obstacle[] = [];
  /** The large reef rock den (fixed hiding spot). */
  denPos = new THREE.Vector3();
  private rng = new Rng(77);
  private coralMat: THREE.MeshStandardMaterial;
  private rockMat: THREE.MeshStandardMaterial;
  private shellMat: THREE.MeshStandardMaterial;
  private fanMat: THREE.MeshStandardMaterial;
  private softMat: THREE.MeshStandardMaterial;
  private anemoneMat: THREE.MeshStandardMaterial;
  private grassMat: THREE.MeshStandardMaterial;
  static outlineMat = makeOutlineMaterial();
  private obstacleCache: Obstacle[] = [];

  constructor(private terrain: TerrainSystem) {
    const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
    this.coralMat = patchMaterial(std({ roughness: 0.72 }), { caustics: true, rim: 0.12, bump: { scale: 26, strength: 0.32 }, key: 'coral' });
    this.rockMat = patchMaterial(std({ roughness: 0.94 }), { caustics: true, bump: { scale: 7, strength: 0.55 }, key: 'rock' });
    this.shellMat = patchMaterial(std({ roughness: 0.35 }), { caustics: true, bump: { scale: 40, strength: 0.12 }, key: 'shell' });
    this.fanMat = patchMaterial(std({ roughness: 0.7, side: THREE.DoubleSide }), {
      caustics: true,
      sway: { height: 1.0, amount: 0.07, base: 0.6, wind: 0.5, speed: 0.9 },
      key: 'fan',
    });
    this.softMat = patchMaterial(std({ roughness: 0.75 }), {
      caustics: true,
      rim: 0.15,
      bump: { scale: 34, strength: 0.28 },
      sway: { height: 0.8, amount: 0.05, base: 0.6, wind: 0.4, speed: 1.0 },
      key: 'soft',
    });
    this.anemoneMat = patchMaterial(std({ roughness: 0.55 }), {
      caustics: true,
      rim: 0.25,
      sway: { height: 0.65, amount: 0.07, base: 0.8, wind: 0.5, speed: 1.3 },
      key: 'anemone',
    });
    this.grassMat = patchMaterial(new THREE.MeshStandardMaterial({ roughness: 0.55, side: THREE.DoubleSide, color: 0xffffff, vertexColors: true }), {
      rim: 0.18,
      caustics: true,
      sway: { height: 1.4, amount: 0.22, base: 0.55, wind: 0.6, speed: 0.85, instanced: true },
      key: 'seagrass',
    });
    this.build();
    this.originals = [...this.selectables];
  }
  private originals: Selectable[] = [];

  private build() {
    // ---- Right side: deeper reef with a fixed den rock
    this.addDen(12.7, -2.4);
    this.addCoral('branch-purple', 'Staghorn coral', F.branchingCoral(3, 0x7a5a8a, 0xd7a6e8, 1.15), 10.1, 1.0, 0.75, 1.2, this.coralMat, true);
    this.addCoral('brain', 'Brain coral', F.brainCoral(5, 0xd9cf7a, 0x6f7a3a, 1.25), 14.7, 2.2, 0.65, 0.6, this.coralMat, true);
    this.addCoral('fan-red', 'Sea fan', F.fanCoral(9, 0xb8344a, 1.35), 13.8, -4.6, 0.55, 1.5, this.fanMat, false, 0.15);
    this.addCoral('tubes-orange', 'Tube sponges', F.tubeSponges(4, 0xf07a22, 1.1), 16.0, -1.0, 0.45, 0.9, this.coralMat, true);
    this.addCoral('table', 'Plate coral', F.tableCoral(8, 0x9aa86a, 1.1), 10.8, -3.6, 0.75, 0.6, this.coralMat, true);
    this.addCoral('soft-cream', 'Leather coral', F.softCoral(12, 0xe8d6a0, 1.1), 8.9, -1.8, 0.5, 0.8, this.softMat, true);
    this.addCoral('branch-blue', 'Acropora', F.branchingCoral(17, 0x5a7a9a, 0xbfe8f8, 0.85), 15.3, 4.0, 0.5, 0.9, this.coralMat, true);
    this.addCoral('branch-gold', 'Staghorn coral', F.branchingCoral(29, 0x8a6a3a, 0xffd28a, 0.95), 6.8, -4.4, 0.55, 1.0, this.coralMat, true);
    this.addCoral('brain-green', 'Brain coral', F.brainCoral(37, 0x9ad0a0, 0x3f6a4a, 0.75), 11.8, 4.6, 0.4, 0.4, this.coralMat, true);
    // anemone — clownfish home (movable; more can be placed)
    this.addAnemone('anemone', 8.3, 2.6, 2, 0);

    // ---- Left: shallow lagoon shelf around the island
    this.addCoral('branch-pink', 'Staghorn coral', F.branchingCoral(23, 0xb06a6a, 0xffb7a6, 0.9), -3.4, 2.4, 0.6, 1.0, this.coralMat, true);
    this.addCoral('brain-small', 'Brain coral', F.brainCoral(31, 0xc3a46a, 0x6a5a3a, 0.8), -13.2, 3.0, 0.42, 0.4, this.coralMat, true);
    this.addCoral('tubes-purple', 'Tube sponges', F.tubeSponges(14, 0x8a4aa8, 0.9), -14.6, -3.0, 0.4, 0.75, this.coralMat, true);
    this.addCoral('fan-purple', 'Sea fan', F.fanCoral(19, 0x7a3a9a, 0.9), -12.0, -4.4, 0.4, 1.0, this.fanMat, false, -0.25);
    this.addCoral('soft-yellow', 'Leather coral', F.softCoral(41, 0xd8c060, 0.8), -4.6, -3.2, 0.4, 0.6, this.softMat, true);

    // ---- Rocks
    this.addRock('rock-a', -1.2, 3.6, 0.42, 0.62);
    this.addRock('rock-b', 5.2, -3.2, 0.55, 0.55);
    this.addRock('rock-c', 6.7, 3.9, 0.3, 0.7);
    this.addRock('rock-d', -15.3, 0.8, 0.5, 0.6);
    this.addRock('rock-e', 18.5, 1.2, 0.6, 0.6);
    this.addRock('rock-f', -18.8, -2.0, 0.65, 0.55);
    this.addRock('rock-g', 2.0, -4.8, 0.45, 0.6);
    this.addRock('rock-h', -5.8, 4.4, 0.35, 0.65);

    // ---- Shells & starfish
    this.addShell('scallop', 'Scallop', F.scallop(0xe8a07a, 1.0), 1.6, 4.5, 0.22);
    this.addEmptyShell('conch', 7.5, 4.2, 11);
    this.addEmptyShell('whelk', -1.8, 4.8, 12);
    this.addShell('starfish', 'Starfish', F.starfish(0xe0602e, 1.1), 3.4, 4.9, 0.26);
    this.addShell('starfish-2', 'Starfish', F.starfish(0xc84a6a, 0.85), -10.6, 4.6, 0.2);

    // ---- Seagrass meadows (front, middle and back)
    const grassSpots: [number, number, number][] = [
      [-1.8, -2.4, 1.25],
      [0.0, 1.2, 1.1],
      [1.2, -3.6, 1.35],
      [2.5, 2.0, 0.95],
      [3.6, -1.2, 1.2],
      [4.3, 3.8, 0.8],
      [5.6, 0.4, 1.0],
      [0.8, 4.8, 0.7],
      [-3.8, -4.6, 0.9],
      [-6.5, 3.6, 0.7],
      [-14.0, 4.0, 0.9],
      [17.2, -3.6, 1.0],
      [-17.4, 3.0, 1.0],
      [20.5, 2.4, 1.1],
    ];
    grassSpots.forEach(([x, z, h], i) => this.addSeagrass(`grass-${i}`, x, z, h, 12 + this.rng.int(0, 8)));

    // ---- V3 deep back region (z < -6): deliberately sparse — a few outcrops, meadows, a cave
    this.addRock('rock-i', 3.5, -8.2, 0.6, 0.6);
    this.addRock('rock-j', 11.5, -9.6, 0.7, 0.55);
    this.addRock('rock-k', -3.0, -10.5, 0.5, 0.6);
    this.addRock('rock-l', 17.0, -8.0, 0.55, 0.6);
    this.addRock('rock-m', -17.0, -9.0, 0.6, 0.55);
    this.addCoral('fan-back', 'Sea fan', F.fanCoral(51, 0xd8803a, 1.2), 8.5, -10.6, 0.5, 1.3, this.fanMat, false, 0.3);
    this.addCoral('brain-back', 'Brain coral', F.brainCoral(53, 0xb0a070, 0x5a5a3a, 0.9), -7.5, -9.5, 0.45, 0.45, this.coralMat, true);
    this.addCoral('branch-back', 'Acropora', F.branchingCoral(57, 0x6a7aa0, 0xc8d8f8, 0.9), 14.5, -11.4, 0.5, 0.9, this.coralMat, true);
    this.addCave('cave-back', 6.2, -9.0, 77);
    const backGrass: [number, number, number][] = [
      [6.0, -7.2, 1.1],
      [-1.0, -8.5, 1.0],
      [13.0, -10.4, 1.2],
      [-12.0, -8.0, 0.9],
      [9.5, -12.0, 1.0],
      [0.5, -11.8, 0.9],
    ];
    backGrass.forEach(([x, z, h], i) => this.addSeagrass(`grass-back-${i}`, x, z, h, 10 + this.rng.int(0, 8)));
    this.buildArchipelago();
    this.buildDeepAndBack();
  }

  /**
   * V2 (P1): the western lagoon's reef life. Ids start with `w2-` (older saves don't know them,
   * so they simply stay at home). The east deep water is deliberately left empty for now.
   */
  private buildArchipelago() {
    // Patch reefs ("bommies") scattered over the western lagoon, each a mixed community, plus
    // seagrass meadows on the open sand between them. Deterministic (own seed), ids `w2-…`.
    const rng = new Rng(909);
    const W = CONFIG.world;
    type Pick = (id: string, x: number, z: number) => number; // returns the footprint radius
    const pal = <T,>(list: T[]) => list[rng.int(0, list.length - 1)];
    const species: { w: number; make: Pick }[] = [
      { w: 3, make: (id, x, z) => (this.addCoral(id, 'Staghorn coral', F.branchingCoral(rng.int(1, 999), ...pal<[number, number]>([[0xa0585a, 0xffb0a0], [0x7a5a8a, 0xd7a6e8], [0x8a6a3a, 0xffd28a], [0x5a7a6a, 0xc8f0d0]]), rng.range(0.8, 1.15)), x, z, 0.6, 1.0, this.coralMat, true), 0.95) },
      { w: 2, make: (id, x, z) => (this.addCoral(id, 'Acropora', F.branchingCoral(rng.int(1, 999), 0x5a6a8a, pal([0xb0d8f0, 0xd0c8f8, 0xb8f0e0]), rng.range(0.7, 0.95)), x, z, 0.5, 0.85, this.coralMat, true), 0.8) },
      { w: 3, make: (id, x, z) => (this.addCoral(id, 'Brain coral', F.brainCoral(rng.int(1, 999), pal([0xd0b878, 0x9ad0a0, 0xc8a0a8, 0xd8cf7a]), 0x5a5a3a, rng.range(0.7, 1.15)), x, z, 0.55, 0.5, this.coralMat, true), 0.85) },
      { w: 2, make: (id, x, z) => (this.addCoral(id, 'Plate coral', F.tableCoral(rng.int(1, 999), pal([0x8aa070, 0xa08a6a, 0x7a9aa0]), rng.range(0.8, 1.05)), x, z, 0.7, 0.55, this.coralMat, true), 1.0) },
      { w: 2, make: (id, x, z) => (this.addCoral(id, 'Leather coral', F.softCoral(rng.int(1, 999), pal([0xc8d0a0, 0xd8c060, 0xe0b8c8]), rng.range(0.8, 1.0)), x, z, 0.45, 0.7, this.softMat, true), 0.7) },
      { w: 2, make: (id, x, z) => (this.addCoral(id, 'Tube sponges', F.tubeSponges(rng.int(1, 999), pal([0xe0a030, 0x8a4aa8, 0xd05a3a]), rng.range(0.8, 1.05)), x, z, 0.45, 0.85, this.coralMat, true), 0.7) },
      { w: 2, make: (id, x, z) => (this.addCoral(id, 'Sea fan', F.fanCoral(rng.int(1, 999), pal([0xc0405a, 0xd8803a, 0x7a3a9a, 0xe8c040]), rng.range(0.9, 1.2)), x, z, 0.5, 1.2, this.fanMat, false, rng.range(-0.4, 0.4)), 0.7) },
      { w: 3, make: (id, x, z) => (this.addCoral(id, 'Pillar coral', F.pillarCoral(rng.int(1, 999), pal([0xc8b48a, 0xb8a070, 0xd8c8a0]), rng.range(0.8, 1.1)), x, z, 0.45, 1.0, this.softMat, true), 0.75) },
      { w: 2, make: (id, x, z) => (this.addCoral(id, 'Barrel sponge', F.barrelSponge(rng.int(1, 999), pal([0xb0583a, 0xa86a6a, 0x9a6a4a, 0x8a5a7a]), rng.range(0.85, 1.15)), x, z, 0.6, 0.85, this.coralMat, true), 0.9) },
      { w: 3, make: (id, x, z) => (this.addCoral(id, 'Sea whips', F.seaWhips(rng.int(1, 999), pal([0xe0703a, 0xe8c040, 0xc84a8a, 0xf0e0c0]), rng.range(0.8, 1.1)), x, z, 0.35, 1.3, this.fanMat, false), 0.55) },
      { w: 2, make: (id, x, z) => (this.addCoral(id, 'Mushroom coral', F.mushroomCoral(rng.int(1, 999), pal([0xd8a070, 0xa0c070, 0xc89ab0]), rng.range(0.9, 1.2)), x, z, 0.35, 0.2, this.coralMat, false), 0.45) },
      { w: 2, make: (id, x, z) => (this.addShell(id, 'Giant clam', F.giantClam(rng.int(1, 999), pal([0x2a6ad0, 0x1aa0a0, 0x6a3ac0, 0x3ab06a]), rng.range(0.85, 1.1)), x, z, 0.32), 0.45) },
      { w: 2, make: (id, x, z) => (this.addShell(id, 'Sea urchin', F.seaUrchin(rng.int(1, 999), pal([0x2a1a3a, 0x3a1a1a, 0x5a2a6a]), rng.range(0.8, 1.1)), x, z, 0.2), 0.3) },
      { w: 1, make: (id, x, z) => (this.addShell(id, 'Starfish', F.starfish(pal([0xd0703a, 0xc84a6a, 0x3a6ac8, 0xe0a030]), rng.range(0.8, 1.0)), x, z, 0.22), 0.35) },
      { w: 2, make: (id, x, z) => (this.addRock(id, x, z, rng.range(0.4, 0.65), rng.range(0.5, 0.65)), 0.9) },
    ];
    const total = species.reduce((a, s) => a + s.w, 0);
    const pickSpecies = () => {
      let r = rng.range(0, total);
      for (const s of species) if ((r -= s.w) <= 0) return s;
      return species[0];
    };
    const placed: { x: number; z: number; r: number }[] = [];
    const level = W.waterLevel;
    const okSpot = (x: number, z: number, r: number) => {
      if (z > W.zFront - 0.9 || z < W.zBack + 1 || x < W.xMin + 1.2 || x > -24.5) return false;
      const g = this.terrain.heightAt(x, z);
      // deep enough to stay wet at low tide, not on the island slopes
      if (g > level - 1.6 || g < level - 7) return false;
      const n = this.terrain.normalAt(x, z);
      if (n.y < 0.8) return false;
      return placed.every((p) => Math.hypot(p.x - x, p.z - z) > (p.r + r) * 0.75);
    };
    // patch reef centres, laid out by hand for the composition (front, middle and back rows)
    const patches: [number, number, number][] = [
      [-28.0, 3.2, 11],
      [-36.0, 3.6, 10],
      [-45.5, 2.4, 9],
      [-28.5, -9.5, 11],
      [-37.0, -11.0, 11],
      [-48.0, -6.5, 8],
      [-30.5, -18.5, 10],
      [-39.5, -20.5, 7],
      [-49.0, -18.0, 6],
    ];
    patches.forEach(([cx, cz, n], p) => {
      let made = 0;
      for (let tries = 0; tries < 160 && made < n; tries++) {
        const a = rng.range(0, Math.PI * 2),
          d = Math.sqrt(rng.range(0, 1)) * 3.0;
        const x = cx + Math.cos(a) * d,
          z = cz + Math.sin(a) * d * 0.8;
        if (!okSpot(x, z, 0.6)) continue;
        const r = pickSpecies().make(`w2-p${p}-${made}`, x, z);
        placed.push({ x, z, r });
        made++;
      }
    });
    // a few loners on the open sand: urchins, clams, starfish, mushroom corals, stones
    const loners = [10, 11, 12, 13, 14];
    let lone = 0;
    for (let tries = 0; tries < 300 && lone < 22; tries++) {
      const x = rng.range(W.xMin + 1.5, -25),
        z = rng.range(W.zBack + 1.2, W.zFront - 1);
      if (!okSpot(x, z, 0.4)) continue;
      const r = species[loners[rng.int(0, loners.length - 1)]].make(`w2-s${lone}`, x, z);
      placed.push({ x, z, r });
      lone++;
    }
    // seagrass meadows on the open sand between the patches (blades stay under the surface)
    let meadows = 0;
    for (let tries = 0; tries < 500 && meadows < 18; tries++) {
      const x = rng.range(W.xMin + 2, -25),
        z = rng.range(W.zBack + 1.5, W.zFront - 1.2);
      const h = rng.range(0.75, 1.25);
      const g = this.terrain.heightAt(x, z);
      if (g > level - 1.1 - h * 1.1 || g < level - 6.5) continue;
      if (!placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + 1.6)) continue;
      const rx = rng.range(1.1, 2.0),
        rz = rng.range(0.8, 1.4);
      this.addMeadow(`w2-g${meadows}`, x, z, rx, rz, Math.round(rx * rz * rng.range(60, 90)), h);
      placed.push({ x, z, r: Math.max(rx, rz) });
      meadows++;
    }
  }

  /**
   * V2: the east drop-off and deep floor (big sea fans, black coral, giant sponges, boulders on
   * the ledges), a sparse row of tall silhouettes along the back of the whole tray, and extra
   * seagrass around the western islands. Ids `w2-d…`, `w2-b…`, `w2-i…`.
   */
  private buildDeepAndBack() {
    const rng = new Rng(4242);
    const W = CONFIG.world;
    const level = W.waterLevel;
    const placed: { x: number; z: number; r: number }[] = this.selectables.map((s) => ({ x: s.object.position.x, z: s.object.position.z, r: s.radius }));
    const free = (x: number, z: number, r: number) => placed.every((p) => Math.hypot(p.x - x, p.z - z) > (p.r + r) * 0.8);
    const spot = (x0: number, x1: number, z0: number, z1: number, minD: number, maxD: number, r: number, minNy: number) => {
      for (let i = 0; i < 40; i++) {
        const x = rng.range(x0, x1),
          z = rng.range(Math.max(z0, W.zBack + 1), Math.min(z1, W.zFront - 0.9));
        const g = this.terrain.heightAt(x, z);
        const d = level - g;
        if (d < minD || d > maxD) continue;
        if (this.terrain.normalAt(x, z).y < minNy) continue;
        if (!free(x, z, r)) continue;
        return [x, z] as [number, number];
      }
      return null;
    };
    const pal = <T,>(list: T[]) => list[rng.int(0, list.length - 1)];
    type Make = (id: string, x: number, z: number) => number;
    const bigFan: Make = (id, x, z) => (this.addCoral(id, 'Sea fan', F.fanCoral(rng.int(1, 999), pal([0xa02838, 0xd06a2a, 0x6a2a8a, 0xd8b030]), rng.range(1.5, 2.2)), x, z, 0.7, 2.2, this.fanMat, false, rng.range(-0.5, 0.5)), 1.0);
    const blackCoral: Make = (id, x, z) => (this.addCoral(id, 'Black coral', F.seaWhips(rng.int(1, 999), pal([0x3a2a24, 0x4a3a2a, 0x2a2a2a]), rng.range(1.3, 1.8)), x, z, 0.5, 1.9, this.fanMat, false), 0.8);
    const sponge: Make = (id, x, z) => (this.addCoral(id, 'Barrel sponge', F.barrelSponge(rng.int(1, 999), pal([0xb0583a, 0xa86a6a, 0x8a5a7a]), rng.range(1.1, 1.4)), x, z, 0.8, 1.0, this.coralMat, true), 1.1);
    const smallSponge: Make = (id, x, z) => (this.addCoral(id, 'Barrel sponge', F.barrelSponge(rng.int(1, 999), pal([0xb0583a, 0xa86a6a, 0x8a5a7a]), rng.range(0.8, 1.0)), x, z, 0.6, 0.7, this.coralMat, true), 0.8);
    const tubes: Make = (id, x, z) => (this.addCoral(id, 'Tube sponges', F.tubeSponges(rng.int(1, 999), pal([0xd05a3a, 0x8a4aa8, 0xe0a030]), rng.range(1.1, 1.4)), x, z, 0.55, 1.1, this.coralMat, true), 0.8);
    const plate: Make = (id, x, z) => (this.addCoral(id, 'Plate coral', F.tableCoral(rng.int(1, 999), pal([0x8a9a7a, 0x7a8aa0, 0xa08a6a]), rng.range(1.0, 1.3)), x, z, 0.8, 0.6, this.coralMat, true), 1.1);
    const brain: Make = (id, x, z) => (this.addCoral(id, 'Brain coral', F.brainCoral(rng.int(1, 999), pal([0xb0a070, 0x9ab0a0, 0xc8a0a8]), 0x5a5a3a, rng.range(0.9, 1.3)), x, z, 0.6, 0.55, this.coralMat, true), 0.9);
    const pillar: Make = (id, x, z) => (this.addCoral(id, 'Pillar coral', F.pillarCoral(rng.int(1, 999), pal([0xc8b48a, 0xb8a070]), rng.range(1.1, 1.4)), x, z, 0.5, 1.4, this.softMat, true), 0.8);
    const whips: Make = (id, x, z) => (this.addCoral(id, 'Sea whips', F.seaWhips(rng.int(1, 999), pal([0xe0703a, 0xe8c040, 0xc84a8a]), rng.range(1.1, 1.5)), x, z, 0.4, 1.7, this.fanMat, false), 0.6);
    const boulder: Make = (id, x, z) => (this.addRock(id, x, z, rng.range(0.7, 1.15), rng.range(0.5, 0.7)), 1.3);
    const weighted = (list: [Make, number][]) => {
      let tot = 0;
      for (const [, w] of list) tot += w;
      let r = rng.range(0, tot);
      for (const [m, w] of list) if ((r -= w) <= 0) return m;
      return list[0][0];
    };
    const fill = (prefix: string, n: number, area: [number, number, number, number], depth: [number, number], minNy: number, kinds: [Make, number][]) => {
      let made = 0;
      for (let tries = 0; tries < n * 6 && made < n; tries++) {
        const p = spot(area[0], area[1], area[2], area[3], depth[0], depth[1], 0.8, minNy);
        if (!p) continue;
        const r = weighted(kinds)(`${prefix}${made}`, p[0], p[1]);
        placed.push({ x: p[0], z: p[1], r });
        made++;
      }
    };
    // `dry` passes consume exactly the same random numbers but build nothing: the first deep
    // layout was replaced (too dense and too bright), and keeping the random sequence intact
    // keeps every later object (back row, island meadows) exactly where it was.
    const self = this as unknown as { addCoral: unknown; addRock: unknown };
    const realCoral = self.addCoral,
      realRock = self.addRock;
    const dryRun = <T,>(fn: () => T): T => {
      self.addCoral = (_id: string, _l: string, geo: THREE.BufferGeometry, _x: number, _z: number, _r: number, _h: number, _m: unknown, _hs: boolean, _rot = this.rng.range(0, Math.PI * 2)) => {
        geo.dispose();
        return null;
      };
      self.addRock = () => {
        this.rng.range(0, 50);
        this.rng.range(0, Math.PI * 2);
        return null;
      };
      try {
        return fn();
      } finally {
        self.addCoral = realCoral;
        self.addRock = realRock;
      }
    };
    const D = { x0: 26, x1: 39 };
    // (replaced deep layout — dry, see above)
    dryRun(() => fill('w2-d', 34, [D.x0, D.x1, W.zBack, W.zFront], [2.5, 10], 0.6, [
      [bigFan, 4],
      [blackCoral, 3],
      [sponge, 3],
      [tubes, 2],
      [plate, 2],
      [brain, 2],
      [whips, 2],
      [boulder, 3],
    ]));
    dryRun(() =>
      fill('w2-dd', 10, [D.x1, W.xMax - 1.5, W.zBack, W.zFront], [7, 12], 0.75, [
        [boulder, 3],
        [bigFan, 2],
        [sponge, 2],
        [blackCoral, 1],
      ]),
    );
    // the centre of the back row has no pillar corals (they read as odd columns behind the reef)
    const noPillar: Make = (id, x, z) => dryRun(() => pillar(id, x, z));
    // the back of the tray (z < -13.8), from the far west to the drop-off: slender silhouettes
    // that read through the blue haze (behind the main island only fans, whips and rocks)
    fill('w2-b', 16, [W.xMin + 1.5, -22, W.zBack, -13.8], [1.6, 9], 0.75, [
      [bigFan, 3],
      [whips, 3],
      [pillar, 2],
      [smallSponge, 1],
      [boulder, 3],
      [brain, 1],
      [tubes, 1],
    ]);
    fill('w2-bc', 12, [-22, D.x0, W.zBack, -13.8], [1.6, 9], 0.75, [
      [bigFan, 3],
      [whips, 3],
      [noPillar, 1],
      [boulder, 3],
    ]);
    // seagrass around the western islands (and a few in the back lagoon)
    const rings: [number, number, number, number][] = [
      [ARCHI.cay.x, ARCHI.cay.z, ARCHI.cay.rx + 2.5, ARCHI.cay.rz + 2.8],
      [ARCHI.granite.x, ARCHI.granite.z, ARCHI.granite.r + 3, ARCHI.granite.r + 2.8],
      [ARCHI.rocks.x, ARCHI.rocks.z, ARCHI.rocks.r + 2.2, ARCHI.rocks.r + 2],
    ];
    let m = 0;
    for (let tries = 0; tries < 400 && m < 16; tries++) {
      const [cx, cz, rx, rz] = rings[tries % rings.length];
      const a = rng.range(0, Math.PI * 2),
        k = rng.range(0.9, 1.6);
      const x = cx + Math.cos(a) * rx * k,
        z = cz + Math.sin(a) * rz * k;
      if (z > W.zFront - 1 || z < W.zBack + 1.2 || x > -24.5 || x < W.xMin + 1.5) continue;
      const h = rng.range(0.7, 1.15);
      const g = this.terrain.heightAt(x, z);
      if (g > level - 1.1 - h * 1.1 || g < level - 6.5) continue;
      if (!free(x, z, 1.1)) continue;
      const mrx = rng.range(1.0, 1.8),
        mrz = rng.range(0.7, 1.2);
      this.addMeadow(`w2-i${m}`, x, z, mrx, mrz, Math.round(mrx * mrz * rng.range(60, 90)), h);
      placed.push({ x, z, r: Math.max(mrx, mrz) });
      m++;
    }
    this.buildDeepReef(this.selectables.map((s) => ({ x: s.object.position.x, z: s.object.position.z, r: s.radius })));
  }

  /**
   * The drop-off and the deep floor: sparse, small and muted — a few 3D gorgonian bushes, black
   * coral, sponges and boulders on the upper ledges, thinning out with depth so the deep water
   * stays quiet and a little mysterious. Ids `w2-e…`.
   */
  private buildDeepReef(placed: { x: number; z: number; r: number }[]) {
    const rng = new Rng(8080);
    const W = CONFIG.world;
    const level = W.waterLevel;
    const free = (x: number, z: number, r: number) => placed.every((p) => Math.hypot(p.x - x, p.z - z) > (p.r + r) * 0.9);
    const pal = <T,>(list: T[]) => list[rng.int(0, list.length - 1)];
    const muted = [0x8a5f62, 0x8f7a52, 0x6f6478, 0x6c7252, 0x9a8a72, 0x5f6a72];
    const dark = [0x3a2e2a, 0x2e2c2a, 0x3a3430];
    type Make = (id: string, x: number, z: number, deep: number) => number;
    const bush: Make = (id, x, z, deep) => (this.addCoral(id, 'Sea rod', F.gorgonianBush(rng.int(1, 999), deep > 0.5 ? pal(dark) : pal(muted), rng.range(0.75, 1.05) * (1 - 0.15 * deep)), x, z, 0.5, 0.9, this.fanMat, false), 0.7);
    const black: Make = (id, x, z) => (this.addCoral(id, 'Black coral', F.gorgonianBush(rng.int(1, 999), pal(dark), rng.range(0.8, 1.1)), x, z, 0.5, 1.0, this.fanMat, false), 0.7);
    const sponge: Make = (id, x, z) => (this.addCoral(id, 'Barrel sponge', F.barrelSponge(rng.int(1, 999), pal([0x7a5a4a, 0x6a5a5a, 0x6a5a62]), rng.range(0.7, 0.9)), x, z, 0.55, 0.6, this.coralMat, true), 0.7);
    const plate: Make = (id, x, z) => (this.addCoral(id, 'Plate coral', F.tableCoral(rng.int(1, 999), pal([0x7a8270, 0x707a82, 0x8a7a68]), rng.range(0.7, 0.9)), x, z, 0.6, 0.45, this.coralMat, true), 0.8);
    const brain: Make = (id, x, z) => (this.addCoral(id, 'Brain coral', F.brainCoral(rng.int(1, 999), pal([0x8a8064, 0x7a8478]), 0x4a4a38, rng.range(0.7, 0.9)), x, z, 0.5, 0.45, this.coralMat, true), 0.7);
    const boulder: Make = (id, x, z) => (this.addRock(id, x, z, rng.range(0.45, 0.8), rng.range(0.5, 0.7)), 0.9);
    const place = (prefix: string, n: number, x0: number, x1: number, depth: [number, number], kinds: [Make, number][]) => {
      let made = 0;
      for (let tries = 0; tries < n * 12 && made < n; tries++) {
        const x = rng.range(x0, x1),
          z = rng.range(W.zBack + 1, W.zFront - 0.9);
        const g = this.terrain.heightAt(x, z);
        const d = level - g;
        if (d < depth[0] || d > depth[1] || this.terrain.normalAt(x, z).y < 0.7 || !free(x, z, 0.7)) continue;
        let tot = 0;
        for (const [, w] of kinds) tot += w;
        let r = rng.range(0, tot);
        let m = kinds[0][0];
        for (const [k, w] of kinds) if ((r -= w) <= 0) {
          m = k;
          break;
        }
        const deep = Math.min(1, Math.max(0, (d - 3) / 7));
        placed.push({ x, z, r: m(`${prefix}${made}`, x, z, deep) });
        made++;
      }
    };
    // upper ledges: a little life
    place('w2-e', 9, 26, 34, [2.5, 6], [
      [bush, 3],
      [plate, 1],
      [brain, 1],
      [sponge, 1],
      [boulder, 2],
    ]);
    // lower slope: darker and sparser
    place('w2-em', 5, 29, 38, [6, 9.5], [
      [bush, 2],
      [black, 2],
      [boulder, 2],
    ]);
    // the deep floor: almost empty
    place('w2-ed', 3, 38, W.xMax - 2, [8.5, 12], [
      [boulder, 2],
      [black, 1],
    ]);
  }

  /** A wide seagrass meadow in one instanced mesh (cheaper than many small tufts). */
  private addMeadow(id: string, x: number, z: number, rx: number, rz: number, count: number, h: number) {
    const blade = F.seagrassBlade(1);
    const mesh = new THREE.InstancedMesh(blade, this.grassMat, count);
    const phases = new Float32Array(count);
    const m4 = new THREE.Matrix4();
    const y0 = this.groundY(x, z, 0.3);
    for (let i = 0; i < count; i++) {
      const a = this.rng.range(0, Math.PI * 2),
        r = Math.sqrt(this.rng.range(0, 1));
      const px = Math.cos(a) * r * rx,
        pz = Math.sin(a) * r * rz;
      // denser and taller in the middle of the meadow
      const s = h * this.rng.range(0.55, 1.1) * (1 - 0.35 * r);
      const gy = this.terrain.heightAt(x + px, z + pz) - y0;
      m4.compose(
        new THREE.Vector3(px, gy - 0.03, pz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(this.rng.range(-0.12, 0.12), this.rng.range(-0.8, 0.8), this.rng.range(-0.15, 0.15))),
        new THREE.Vector3(s * 0.9, s, s),
      );
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, new THREE.Color().setHSL(this.rng.range(0.2, 0.3), this.rng.range(0.4, 0.6), this.rng.range(0.26, 0.42)));
      phases[i] = this.rng.range(0, 6.28);
    }
    blade.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(x, y0, z);
    this.group.add(g);
    return this.register(id, 'seagrass', 'Seagrass meadow', g, Math.max(rx, rz), h, false);
  }

  private anemonePalettes: [number, number, number][] = [
    [0x8a3a3a, 0xc8e08a, 0xff8ec8],
    [0x6a3a7a, 0xf0a0d0, 0xffe0f0],
    [0x7a5a2a, 0x9ad070, 0xf0f070],
    [0x3a5a7a, 0x90d0f0, 0xf0a0ff],
  ];

  private addAnemone(id: string, x: number, z: number, seed: number, palette: number) {
    const [c0, c1, c2] = this.anemonePalettes[palette % this.anemonePalettes.length];
    const m = new THREE.Mesh(F.anemone(seed, c0, c1, c2, 1.2 * S), this.anemoneMat);
    m.castShadow = true;
    m.receiveShadow = true;
    const g = new THREE.Group();
    g.add(m);
    g.position.set(x, this.groundY(x, z, 0.3) - 0.02, z);
    this.group.add(g);
    const sel = this.register(id, 'coral', 'Sea anemone', g, 0.55, 0.75, false);
    sel.habitat = 'anemone';
    return sel;
  }

  /** World position of the first anemone (legacy single-home helper). */
  get anemonePos() {
    const a = this.anemones()[0];
    return a ? a.object.position.clone().add(new THREE.Vector3(0, a.height * 0.55, 0)) : new THREE.Vector3(8.3, -4, 2.6);
  }
  anemones() {
    return this.selectables.filter((s) => s.habitat === 'anemone');
  }
  emptyShells() {
    return this.selectables.filter((s) => s.habitat === 'shell');
  }
  /** The most recently placed user object, if placed within `seconds`. */
  recentPlacement(seconds: number): Selectable | null {
    const now = performance.now() / 1000;
    let best: Selectable | null = null;
    for (const s of this.selectables) if (s.user && s.placedAt && now - s.placedAt < seconds && (!best || s.placedAt > best.placedAt!)) best = s;
    return best;
  }

  private userCounter = 0;
  /** Listeners (selection mesh list, etc.) when the registry changes. */
  onChange?: () => void;

  /**
   * Place tool: creates a new habitat / decor object on the seabed. It becomes selectable,
   * an obstacle, and — depending on its type — a home the creature AI can discover.
   */
  createObject(type: PlaceType, x: number, z: number, seed = Math.floor(Math.random() * 1e6), rotY = Math.random() * Math.PI * 2, id?: string): Selectable {
    const sid = id ?? `user-${type}-${Date.now().toString(36)}-${this.userCounter++}`;
    const r = new Rng(seed);
    let sel: Selectable;
    switch (type) {
      case 'anemone':
        sel = this.addAnemone(sid, x, z, seed, r.int(0, 3));
        break;
      case 'cave':
        sel = this.addCave(sid, x, z, seed);
        break;
      case 'branching': {
        const pal = r.pick([[0xb06a6a, 0xffb7a6], [0x7a5a8a, 0xd7a6e8], [0x8a6a3a, 0xffd28a], [0x5a7a9a, 0xbfe8f8]] as [number, number][]);
        sel = this.addCoral(sid, 'Staghorn coral', F.branchingCoral(seed % 1000, pal[0], pal[1], r.range(0.8, 1.1)), x, z, 0.6, 1.0, this.coralMat, true, rotY);
        break;
      }
      case 'brain': {
        const pal = r.pick([[0xd9cf7a, 0x6f7a3a], [0xc3a46a, 0x6a5a3a], [0x9ad0a0, 0x3f6a4a]] as [number, number][]);
        sel = this.addCoral(sid, 'Brain coral', F.brainCoral(seed % 1000, pal[0], pal[1], r.range(0.7, 1.0)), x, z, 0.5, 0.5, this.coralMat, true, rotY);
        break;
      }
      case 'fan':
        sel = this.addCoral(sid, 'Sea fan', F.fanCoral(seed % 1000, r.pick([0xb8344a, 0x7a3a9a, 0xd8803a]), r.range(0.9, 1.2)), x, z, 0.45, 1.2, this.fanMat, false, rotY);
        break;
      case 'seagrass':
        sel = this.addSeagrass(sid, x, z, r.range(0.8, 1.25), 12 + r.int(0, 8));
        break;
      case 'rock':
        sel = this.addRock(sid, x, z, r.range(0.3, 0.5), r.range(0.55, 0.7));
        break;
      case 'shell':
      default:
        sel = this.addEmptyShell(sid, x, z, seed);
        break;
    }
    sel.user = true;
    sel.type = type;
    sel.seed = seed;
    sel.placedAt = performance.now() / 1000;
    sel.object.rotation.y = rotY;
    sel.home.rotY = rotY;
    this.onChange?.();
    return sel;
  }

  /** An empty spiral shell (conch or whelk) — hermit crab real estate. */
  addEmptyShell(id: string, x: number, z: number, seed: number) {
    const { geo, whelk } = Reef.shellGeometry(seed);
    const mesh = new THREE.Mesh(geo, this.shellMat);
    mesh.castShadow = true;
    mesh.scale.setScalar(S);
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(x, this.groundY(x, z, 0.3) - 0.01, z);
    this.group.add(g);
    const sel = this.register(id, 'shell', whelk ? 'Empty whelk shell' : 'Empty conch shell', g, 0.3, 0.3, false);
    sel.habitat = 'shell';
    sel.seed = seed;
    return sel;
  }

  /** Deterministic spiral shell for a seed (shared with the hermit crab's carried shell). */
  static shellGeometry(seed: number) {
    const r = new Rng(seed);
    const whelk = r.next() < 0.5;
    const geo = whelk ? F.conch(r.pick([0xd8b090, 0xc89a7a, 0xe8d0b0]), 0.85) : F.conch(r.pick([0xe8b07a, 0xf0c090, 0xd89a6a]), 1.0);
    if (whelk) {
      // taller, slimmer whelk: stretch along the spire axis and keep the aperture frame in sync
      geo.scale(1, 1.3, 1);
      const ap = geo.userData.aperture as { c: THREE.Vector3; n: THREE.Vector3; axis: THREE.Vector3 } | undefined;
      if (ap) {
        ap.c.y *= 1.3;
        ap.n.y /= 1.3;
        ap.n.normalize();
        ap.axis.y *= 1.3;
        ap.axis.normalize();
      }
    }
    return { geo, whelk };
  }
  get shellMaterial() {
    return this.shellMat;
  }

  /** Rock arch with a dark hollow facing the viewer: a ready-made octopus den. */
  private addCave(id: string, x: number, z: number, seed: number) {
    const g = new THREE.Group();
    const parts: [number, number, number, number, number][] = [
      [-0.55, 0.0, 0.0, 0.45, 1.25],
      [0.55, 0.0, 0.05, 0.42, 1.3],
      [0.0, 0.62, -0.05, 0.72, 0.5],
      [0.0, 0.12, -0.5, 0.55, 0.9],
    ];
    parts.forEach(([px, py, pz, r, fl], i) => {
      const m = new THREE.Mesh(F.reefRock(seed % 97 + i * 5.3, r, fl), this.rockMat);
      m.position.set(px, py, pz);
      m.rotation.y = i * 1.7;
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    });
    const hollow = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8).scale(1.1, 0.8, 0.6), new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 1 }));
    hollow.position.set(0, 0.25, -0.12);
    g.add(hollow);
    g.scale.setScalar(S * 0.9);
    g.position.set(x, this.groundY(x, z, 1.0) - 0.08, z);
    this.group.add(g);
    const sel = this.register(id, 'rock', 'Cave rock', g, 1.05, 1.15, true);
    sel.habitat = 'cave';
    return sel;
  }

  /** Detaches an object (Remove tool / hermit crab taking a shell). Re-attachable for undo. */
  detach(sel: Selectable) {
    const i = this.selectables.indexOf(sel);
    if (i < 0) return;
    this.selectables.splice(i, 1);
    this.group.remove(sel.object);
    this.onChange?.();
  }
  attach(sel: Selectable) {
    if (this.selectables.includes(sel)) return;
    this.selectables.push(sel);
    this.group.add(sel.object);
    this.onChange?.();
  }
  /** Removes all user-placed objects (Reset / Load). */
  clearUserObjects() {
    for (const s of [...this.selectables]) if (s.user) this.detach(s);
  }

  groundY(x: number, z: number, r: number) {
    const t = this.terrain;
    const s = [t.heightAt(x, z), t.heightAt(x + r * 0.6, z), t.heightAt(x - r * 0.6, z), t.heightAt(x, z + r * 0.6), t.heightAt(x, z - r * 0.6)];
    return Math.min(...s) * 0.5 + (s.reduce((a, b) => a + b) / s.length) * 0.5;
  }

  private register(
    id: string,
    kind: Selectable['kind'],
    label: string,
    object: THREE.Object3D,
    radius: number,
    height: number,
    hideSpot: boolean,
  ) {
    object.userData.selectableId = id;
    const outlines: THREE.Object3D[] = [];
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.isOutline) return;
      let out: THREE.Mesh;
      if ((m as THREE.InstancedMesh).isInstancedMesh) {
        const im = m as THREE.InstancedMesh;
        const oi = new THREE.InstancedMesh(im.geometry, Reef.outlineMat, im.count);
        oi.instanceMatrix = im.instanceMatrix;
        out = oi;
      } else out = new THREE.Mesh(m.geometry, Reef.outlineMat);
      out.userData.isOutline = true;
      out.visible = false;
      out.renderOrder = 2;
      outlines.push(out);
    });
    // attach after traversal to avoid visiting new children
    let i = 0;
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.isOutline && i < outlines.length) {
        m.add(outlines[i++]);
      }
    });
    const sel: Selectable = {
      id,
      kind,
      label,
      object,
      radius,
      height,
      hideSpot,
      outlines,
      home: { pos: object.position.clone(), rotY: object.rotation.y },
    };
    this.selectables.push(sel);
    return sel;
  }

  private addCoral(
    id: string,
    label: string,
    geo: THREE.BufferGeometry,
    x: number,
    z: number,
    radius: number,
    height: number,
    mat: THREE.Material,
    hideSpot: boolean,
    rotY = this.rng.range(0, Math.PI * 2),
  ) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.scale.setScalar(S);
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(x, this.groundY(x, z, radius * S) - 0.05, z);
    g.rotation.y = rotY;
    this.group.add(g);
    return this.register(id, 'coral', label, g, radius * S, height * S, hideSpot);
  }

  private addRock(id: string, x: number, z: number, r: number, flatten: number) {
    r *= S;
    const mesh = new THREE.Mesh(F.reefRock(this.rng.range(0, 50), r, flatten), this.rockMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(x, this.groundY(x, z, r) + r * 0.08, z);
    g.rotation.y = this.rng.range(0, Math.PI * 2);
    this.group.add(g);
    return this.register(id, 'rock', 'Reef rock', g, r * 1.05, r * flatten * 1.2, false);
  }

  private addShell(id: string, label: string, geo: THREE.BufferGeometry, x: number, z: number, r: number) {
    const mesh = new THREE.Mesh(geo, this.shellMat);
    mesh.castShadow = true;
    mesh.scale.setScalar(S);
    r *= S;
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(x, this.groundY(x, z, r) - 0.01, z);
    g.rotation.y = this.rng.range(0, Math.PI * 2);
    this.group.add(g);
    this.register(id, 'shell', label, g, r, 0.15, false);
  }

  private addSeagrass(id: string, x: number, z: number, h: number, count: number) {
    const blade = F.seagrassBlade(1);
    const mesh = new THREE.InstancedMesh(blade, this.grassMat, count);
    const phases = new Float32Array(count);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const a = this.rng.range(0, Math.PI * 2),
        r = this.rng.range(0, 0.28);
      const s = h * this.rng.range(0.55, 1.15);
      m4.compose(
        new THREE.Vector3(Math.cos(a) * r, -0.03, Math.sin(a) * r * 0.8),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(this.rng.range(-0.12, 0.12), this.rng.range(-0.8, 0.8), this.rng.range(-0.15, 0.15))),
        new THREE.Vector3(s * 0.9, s, s),
      );
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, new THREE.Color().setHSL(this.rng.range(0.22, 0.3), this.rng.range(0.45, 0.6), this.rng.range(0.28, 0.42)));
      phases[i] = this.rng.range(0, 6.28);
    }
    blade.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(x, this.groundY(x, z, 0.3), z);
    this.group.add(g);
    return this.register(id, 'seagrass', 'Seagrass', g, 0.38, h, false);
  }

  private addDen(x: number, z: number) {
    const den = new THREE.Group();
    const parts: [number, number, number, number, number][] = [
      [0, 0, 0, 1.05, 0.62],
      [-0.85, 0.05, 0.35, 0.62, 0.7],
      [0.8, 0.0, -0.2, 0.7, 0.6],
      [0.15, 0.62, -0.1, 0.55, 0.75],
      [-0.4, 0.55, -0.45, 0.45, 0.8],
    ];
    parts.forEach(([px, py, pz, r, fl], i) => {
      const m = new THREE.Mesh(F.reefRock(i * 7.7 + 3, r, fl), this.rockMat);
      m.position.set(px, py, pz);
      m.rotation.y = i * 1.3;
      m.castShadow = true;
      m.receiveShadow = true;
      den.add(m);
    });
    // encrusting little corals on the den
    const small = new THREE.Mesh(F.branchingCoral(51, 0xc0704a, 0xffc08a, 0.5), this.coralMat);
    small.position.set(0.3, 0.95, 0.1);
    small.castShadow = true;
    den.add(small);
    const sm2 = new THREE.Mesh(F.brainCoral(61, 0x9ad0a0, 0x4a7a5a, 0.5), this.coralMat);
    sm2.position.set(-0.7, 0.5, 0.55);
    den.add(sm2);
    den.scale.setScalar(S * 0.95);
    den.position.set(x, this.groundY(x, z, 1.5) - 0.15, z);
    this.group.add(den);
    const k = S * 0.95;
    this.denPos.set(x - 0.2, den.position.y + 0.45, z + 1.15);
    this.fixedObstacles.push({ center: den.position.clone().add(new THREE.Vector3(0, 0.35 * k, 0)), radius: 1.2 * k });
    this.fixedObstacles.push({ center: den.position.clone().add(new THREE.Vector3(-0.85 * k, 0.3 * k, 0.35 * k)), radius: 0.7 * k });
    this.fixedObstacles.push({ center: den.position.clone().add(new THREE.Vector3(0.8 * k, 0.3 * k, -0.2 * k)), radius: 0.75 * k });
  }

  /** Current obstacle spheres (fixed + selectable objects at their live positions). */
  obstacles(): Obstacle[] {
    const out = this.obstacleCache;
    out.length = 0;
    for (const o of this.fixedObstacles) out.push(o);
    for (const s of this.selectables) {
      if (s.kind === 'seagrass') continue; // fish swim through grass
      const c = (s.object.userData.obsCenter ??= new THREE.Vector3()) as THREE.Vector3;
      c.copy(s.object.position);
      c.y += s.height * 0.4;
      out.push((s.object.userData.obs ??= { center: c, radius: 0 }) as Obstacle);
      (s.object.userData.obs as Obstacle).radius = Math.max(s.radius, s.height * 0.5);
    }
    return out;
  }

  hidingSpotsDetailed(): { p: THREE.Vector3; ref: Selectable | null; cave: boolean }[] {
    const out: { p: THREE.Vector3; ref: Selectable | null; cave: boolean }[] = [{ p: this.denPos.clone(), ref: null, cave: true }];
    for (const s of this.selectables) {
      if (!s.hideSpot) continue;
      const cave = s.habitat === 'cave';
      out.push({ p: s.object.position.clone().add(new THREE.Vector3(0, cave ? 0.3 : 0.05, cave ? 0.05 : 0.3)), ref: s, cave });
    }
    return out;
  }

  hidingSpots(): THREE.Vector3[] {
    const spots = [this.denPos.clone()];
    for (const s of this.selectables) if (s.hideSpot) spots.push(s.object.position.clone().add(new THREE.Vector3(0, 0.1, 0.25)));
    return spots;
  }

  resetPositions() {
    this.clearUserObjects();
    for (const o of this.originals) this.attach(o);
    for (const s of this.selectables) {
      s.object.position.copy(s.home.pos);
      s.object.rotation.y = s.home.rotY;
    }
  }

  setHighlight(sel: Selectable | null, on: boolean) {
    if (!sel) return;
    for (const o of sel.outlines) o.visible = on;
  }
}

function makeOutlineMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xd8fdff, side: THREE.BackSide, transparent: true, opacity: 0.85, depthWrite: false });
  m.onBeforeCompile = (s) => {
    s.uniforms.uOutline = { value: 0.035 };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;')
      .replace('#include <begin_vertex>', 'vec3 transformed = position + normalize(normal) * uOutline;');
  };
  m.customProgramCacheKey = () => 'outline';
  return m;
}
