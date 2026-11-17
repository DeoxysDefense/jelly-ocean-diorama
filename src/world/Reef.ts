import * as THREE from 'three';
import { Rng } from '../util/math';
import { patchMaterial } from '../util/shaders';
import type { TerrainSystem } from './TerrainSystem';
import * as F from './coralFactory';

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
