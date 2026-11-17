import * as THREE from 'three';
import { CONFIG } from '../config';
import { Rng } from '../util/math';
import { bakeStatic, lathe, leafGeometry, merge, normalizeGeo, paint, rockGeometry, taperedTube } from '../util/geometry';
import { makeBarkTextures, makeThatchTextures, makeWoodTextures } from '../util/textures';
import { patchMaterial, shared } from '../util/shaders';
import type { TerrainSystem } from './TerrainSystem';

/**
 * The small tropical island: a Hawaiian-style wooden hut on a stilted deck, two coconut palms,
 * broad-leaf shrubs, beach grass and a few props. Everything is procedural; to replace with
 * authored GLB models, swap the builders in buildHut()/buildPalm() (see ASSETS.md).
 */
export class Island {
  readonly group = new THREE.Group();
  /** Palms: crowns sway with the bark shader; `shake` (0..1) is a decaying user shake. */
  readonly palms: { crown: THREE.Group; top: THREE.Vector3; origin: THREE.Vector3; fronds: THREE.Object3D[]; phase: number; bend: number; trunk: THREE.Mesh; shake: number; shakeT: number; spine: THREE.Vector3[] }[] = [];
  private woodMat: THREE.MeshStandardMaterial;
  private darkWoodMat: THREE.MeshStandardMaterial;
  private thatchMat: THREE.MeshStandardMaterial;
  private barkMat: THREE.MeshStandardMaterial;
  private leafMat: THREE.MeshStandardMaterial;
  private bushMat: THREE.MeshStandardMaterial;
  private rng = new Rng(42);
  private flames: { mat: THREE.MeshStandardMaterial; glow: THREE.Sprite; phase: number; base: number }[] = [];
  private glowTex = makeGlowTexture();
  private interiorMat!: THREE.MeshStandardMaterial;
  private hutLight: THREE.PointLight;
  private windowGlow: THREE.Sprite[] = [];
  night = 0;

  constructor(private terrain: TerrainSystem) {
    const wood = makeWoodTextures(7, [150, 104, 64]);
    const thatch = makeThatchTextures(11);
    const bark = makeBarkTextures(21);
    this.woodMat = new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.82 });
    this.darkWoodMat = new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, color: 0x8a6a52, roughness: 0.85 });
    this.thatchMat = new THREE.MeshStandardMaterial({ map: thatch.map, normalMap: thatch.normalMap, normalScale: new THREE.Vector2(1, 1), roughness: 0.95, side: THREE.DoubleSide });
    this.barkMat = patchMaterial(
      new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.9 }),
      { sway: { height: 4.2, amount: 0.22, base: 0.18, wind: 1.0, speed: 0.8 }, key: 'bark' },
    );
    this.leafMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55, metalness: 0 }), { rim: 0.22, key: 'palmleaf' });
    this.bushMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.65 }), {
      sway: { height: 0.9, amount: 0.06, base: 0.25, wind: 1.0, speed: 1.4 },
      key: 'bush',
    });

    const I = CONFIG.island;
    const hut = this.buildHut();
    const hx = I.x + 0.35,
      hz = I.z - 0.05;
    hut.position.set(hx, terrain.heightAt(hx, hz) - 0.02, hz);
    hut.rotation.y = -0.12;
    hut.scale.setScalar(0.92);
    bakeStatic(hut);
    this.group.add(hut);
    // warm night light spilling from the hut onto the sand
    this.hutLight = new THREE.PointLight(0xffb060, 0, 5.5, 1.6);
    this.hutLight.position.copy(hut.position).add(new THREE.Vector3(0, 0.9, 0.85));
    this.group.add(this.hutLight);
    for (const [ox, oy, s] of [[-0.31, 0.92, 0.75], [0.3, 0.75, 0.9]] as [number, number, number][]) {
      const g = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      g.position.copy(hut.position).add(new THREE.Vector3(ox * 0.92, oy, 0.32));
      g.scale.setScalar(s);
      this.group.add(g);
      this.windowGlow.push(g);
    }

    this.addPalm(I.x - 1.45, I.z + 0.45, 4.0, -0.95, 0.35, 0);
    this.addPalm(I.x + 1.6, I.z - 0.75, 3.5, 0.9, -0.25, 2.1);

    this.addBush(I.x - 0.85, I.z + 0.9, 0.7, 'ti');
    this.addBush(I.x + 1.35, I.z + 0.55, 0.55, 'green');
    this.addBush(I.x - 1.3, I.z - 0.95, 0.6, 'green');
    this.addBush(I.x + 0.95, I.z - 1.2, 0.5, 'hibiscus');
    this.addGrass();
    this.addBeachProps();
  }

  // --------------------------------------------------------------- hut
  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, uvScale = 1) {
    const g = new THREE.BoxGeometry(w, h, d);
    // scale UVs so wood grain density is consistent
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d) * uvScale, uv.getY(i) * h * uvScale);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  private rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, parent: THREE.Object3D) {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 8);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  private log(r: number, h: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) {
    const g = new THREE.CylinderGeometry(r * 0.92, r, h, 10);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  private buildHut() {
    const hut = new THREE.Group();
    hut.name = 'hut';
    const W = this.woodMat,
      D = this.darkWoodMat;
    const deckY = 0.34;
    // stilts
    for (const x of [-0.82, 0, 0.82]) for (const z of [-0.62, 0.66]) this.log(0.05, deckY + 0.3, D, x, -0.3, z, hut);
    // deck planks (along x), with gaps
    const planks = 11;
    for (let i = 0; i < planks; i++) {
      const z = -0.72 + (i / (planks - 1)) * 1.5;
      this.box(1.96, 0.045, 0.125, W, this.rng.range(-0.02, 0.02), deckY, z, hut, 1.4);
    }
    // deck beams
    this.box(2.0, 0.07, 0.07, D, 0, deckY - 0.06, -0.62, hut);
    this.box(2.0, 0.07, 0.07, D, 0, deckY - 0.06, 0.66, hut);

    // walls (vertical planks), room spans x [-0.72,0.72], z [-0.6,0.3]
    const floor = deckY + 0.025;
    const wallH = 0.98;
    const room = { x0: -0.72, x1: 0.72, z0: -0.6, z1: 0.3 };
    const plankW = 0.12;
    const door = { x0: 0.14, x1: 0.5, top: 0.74 };
    const win = { x0: -0.52, x1: -0.16, y0: 0.38, y1: 0.7 };
    // front wall
    for (let x = room.x0 + plankW / 2; x < room.x1; x += plankW) {
      const inDoor = x > door.x0 && x < door.x1;
      const inWin = x > win.x0 && x < win.x1;
      const tone = this.rng.range(0, 1) < 0.5 ? W : D;
      if (inDoor) {
        this.box(plankW - 0.008, wallH - door.top, 0.04, tone, x, floor + door.top + (wallH - door.top) / 2, room.z1, hut);
      } else if (inWin) {
        this.box(plankW - 0.008, win.y0, 0.04, tone, x, floor + win.y0 / 2, room.z1, hut);
        this.box(plankW - 0.008, wallH - win.y1, 0.04, tone, x, floor + win.y1 + (wallH - win.y1) / 2, room.z1, hut);
      } else {
        this.box(plankW - 0.008, wallH, 0.04, tone, x, floor + wallH / 2, room.z1, hut);
      }
    }
    // back + side walls
    for (let x = room.x0 + plankW / 2; x < room.x1; x += plankW)
      this.box(plankW - 0.008, wallH, 0.04, this.rng.next() < 0.5 ? W : D, x, floor + wallH / 2, room.z0, hut);
    for (const sx of [room.x0, room.x1])
      for (let z = room.z0 + plankW / 2; z < room.z1; z += plankW) {
        const sideWin = sx > 0 && z > -0.36 && z < -0.04;
        if (sideWin) {
          this.box(0.04, 0.4, plankW - 0.008, W, sx, floor + 0.2, z, hut);
          this.box(0.04, 0.25, plankW - 0.008, W, sx, floor + wallH - 0.125, z, hut);
        } else this.box(0.04, wallH, plankW - 0.008, this.rng.next() < 0.5 ? W : D, sx, floor + wallH / 2, z, hut);
      }
    // dark warm interior (visible through door/windows)
    this.interiorMat = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 1, side: THREE.BackSide, emissive: 0xff9a40, emissiveIntensity: 0.12 });
    const interior = new THREE.Mesh(new THREE.BoxGeometry(1.38, wallH - 0.02, 0.84), this.interiorMat);
    interior.position.set(0, floor + wallH / 2, (room.z0 + room.z1) / 2);
    hut.add(interior);
    // corner posts + wall plates
    for (const x of [room.x0, room.x1]) for (const z of [room.z0, room.z1]) this.log(0.045, wallH + 0.06, D, x, floor - 0.02, z, hut);
    this.box(1.56, 0.06, 0.06, D, 0, floor + wallH, room.z1 + 0.01, hut);
    this.box(1.56, 0.06, 0.06, D, 0, floor + wallH, room.z0 - 0.01, hut);
    this.box(0.06, 0.06, 1.0, D, room.x0, floor + wallH, (room.z0 + room.z1) / 2, hut);
    this.box(0.06, 0.06, 1.0, D, room.x1, floor + wallH, (room.z0 + room.z1) / 2, hut);
    // door frame + half-open door
    this.box(0.04, door.top, 0.06, D, door.x0 - 0.01, floor + door.top / 2, room.z1 + 0.01, hut);
    this.box(0.04, door.top, 0.06, D, door.x1 + 0.01, floor + door.top / 2, room.z1 + 0.01, hut);
    this.box(door.x1 - door.x0 + 0.1, 0.05, 0.06, D, (door.x0 + door.x1) / 2, floor + door.top, room.z1 + 0.01, hut);
    const doorPivot = new THREE.Group();
    doorPivot.position.set(door.x1, floor, room.z1);
    doorPivot.rotation.y = -1.05;
    for (let i = 0; i < 3; i++) this.box(0.11, door.top - 0.03, 0.03, W, -0.065 - i * 0.115, (door.top - 0.03) / 2, 0, doorPivot);
    this.box(0.33, 0.04, 0.035, D, -0.18, 0.2, 0.02, doorPivot);
    this.box(0.33, 0.04, 0.035, D, -0.18, 0.55, 0.02, doorPivot);
    hut.add(doorPivot);
    // window frame + propped shutter
    const wy = floor + (win.y0 + win.y1) / 2,
      wx = (win.x0 + win.x1) / 2,
      ww = win.x1 - win.x0,
      wh = win.y1 - win.y0;
    this.box(ww + 0.08, 0.04, 0.07, D, wx, floor + win.y0, room.z1 + 0.02, hut);
    this.box(ww + 0.08, 0.04, 0.07, D, wx, floor + win.y1, room.z1 + 0.02, hut);
    this.box(0.04, wh, 0.07, D, win.x0, wy, room.z1 + 0.02, hut);
    this.box(0.04, wh, 0.07, D, win.x1, wy, room.z1 + 0.02, hut);
    this.box(0.02, wh, 0.05, D, wx, wy, room.z1 + 0.02, hut);
    const shutter = new THREE.Group();
    shutter.position.set(wx, floor + win.y1 + 0.02, room.z1 + 0.04);
    shutter.rotation.x = -1.0;
    for (let i = 0; i < 3; i++) this.box(ww / 3 - 0.01, 0.025, 0.36, W, -ww / 3 + (i * ww) / 3, 0, 0.18, shutter);
    hut.add(shutter);
    this.box(0.015, 0.3, 0.015, D, wx + ww / 2 - 0.02, floor + win.y1 + 0.1, room.z1 + 0.18, hut).rotation.x = 0.5;

    // porch railing + steps
    const rz = 0.72;
    for (const x of [-0.95, -0.55, -0.15, 0.55, 0.95]) this.log(0.025, 0.42, D, x, deckY, rz, hut);
    this.box(0.84, 0.035, 0.04, W, -0.55, deckY + 0.4, rz, hut);
    this.box(0.44, 0.035, 0.04, W, 0.75, deckY + 0.4, rz, hut);
    this.box(0.84, 0.03, 0.03, W, -0.55, deckY + 0.22, rz, hut);
    this.box(0.44, 0.03, 0.03, W, 0.75, deckY + 0.22, rz, hut);
    for (let s = 0; s < 3; s++) this.box(0.62, 0.04, 0.16, W, 0.2, deckY - 0.1 - s * 0.12, rz + 0.12 + s * 0.15, hut);
    this.box(0.04, 0.5, 0.04, D, -0.11, deckY - 0.3, rz + 0.3, hut).rotation.x = 0.6;
    this.box(0.04, 0.5, 0.04, D, 0.51, deckY - 0.3, rz + 0.3, hut).rotation.x = 0.6;

    // roof
    const roof = this.buildRoof(1.13, 0.86, 0.95, floor + wallH + 0.02);
    roof.position.z = -0.16;
    hut.add(roof);

    // lantern
    const lantern = new THREE.Group();
    lantern.position.set(-0.35, floor + wallH - 0.15, rz - 0.05);
    this.box(0.01, 0.12, 0.01, D, 0, 0.1, 0, lantern);
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8),
      new THREE.MeshStandardMaterial({ color: 0xffd28a, emissive: 0xffa040, emissiveIntensity: 0.9, roughness: 0.3 }),
    );
    lantern.add(glass);
    this.box(0.12, 0.02, 0.12, D, 0, 0.06, 0, lantern);
    hut.add(lantern);

    // surfboard leaning on the right wall
    const board = new THREE.Mesh(
      paint(normalizeGeo(new THREE.SphereGeometry(0.5, 20, 10).scale(0.24, 1, 0.04)), (p, _n, c) => {
        const stripe = Math.abs(p.x) < 0.03 ? 1 : 0;
        c.set(stripe ? 0xff6a3c : p.y > 0.25 ? 0x2fb5c9 : 0xf6efe0);
      }),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 }),
    );
    board.position.set(0.95, deckY + 0.5, -0.15);
    board.rotation.set(0, Math.PI / 2, -0.25);
    board.castShadow = true;
    hut.add(board);

    // small barrel
    const barrel = this.log(0.1, 0.24, D, -0.78, deckY + 0.02, 0.5, hut);
    barrel.geometry = new THREE.CylinderGeometry(0.095, 0.1, 0.24, 12);

    // bamboo trim bands around the walls
    const bamboo = new THREE.MeshStandardMaterial({ color: 0xc8a160, roughness: 0.55 });
    for (const y of [floor + 0.06, floor + 0.5]) {
      this.rod(new THREE.Vector3(room.x0 - 0.03, y, room.z1 + 0.035), new THREE.Vector3(room.x1 + 0.03, y, room.z1 + 0.035), 0.016, bamboo, hut);
      this.rod(new THREE.Vector3(room.x0 - 0.03, y, room.z0 - 0.035), new THREE.Vector3(room.x1 + 0.03, y, room.z0 - 0.035), 0.016, bamboo, hut);
      this.rod(new THREE.Vector3(room.x0 - 0.035, y, room.z0), new THREE.Vector3(room.x0 - 0.035, y, room.z1), 0.016, bamboo, hut);
      this.rod(new THREE.Vector3(room.x1 + 0.035, y, room.z0), new THREE.Vector3(room.x1 + 0.035, y, room.z1), 0.016, bamboo, hut);
    }
    // flower box under the window
    this.box(ww + 0.1, 0.07, 0.09, D, wx, floor + win.y0 - 0.05, room.z1 + 0.07, hut);
    const petal = new THREE.MeshStandardMaterial({ color: 0xe83a52, roughness: 0.5 });
    const petal2 = new THREE.MeshStandardMaterial({ color: 0xffc23a, roughness: 0.5 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x3f7a2e, roughness: 0.6 });
    for (let i = 0; i < 7; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), i % 3 === 0 ? petal2 : petal);
      f.position.set(wx - ww / 2 + 0.02 + (i / 6) * (ww - 0.04), floor + win.y0 + 0.005 + (i % 2) * 0.02, room.z1 + 0.07 + this.rng.range(-0.02, 0.02));
      hut.add(f);
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4).scale(1, 0.5, 1), leaf);
      l.position.copy(f.position).add(new THREE.Vector3(0.015, -0.02, 0));
      hut.add(l);
    }
    // potted plant on the deck
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.055, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0xb4623a, roughness: 0.8 }));
    pot.position.set(0.93, deckY + 0.08, 0.56);
    hut.add(pot);
    const plantGeo = merge(
      Array.from({ length: 7 }, (_, i) => {
        const g = leafGeometry({ length: 0.2, width: 0.07, segs: 5, fold: 0.3, curl: 0.4 });
        paint(g, (pp, _n, c) => c.set(0x3f7f2e).lerp(new THREE.Color(0x7fb84a), pp.x / 0.2));
        g.rotateZ(0.9);
        g.rotateY((i / 7) * Math.PI * 2);
        return g;
      }),
    );
    const plant = new THREE.Mesh(plantGeo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 }));
    plant.position.set(0.93, deckY + 0.14, 0.56);
    hut.add(plant);
    // sign board on the right railing post
    this.box(0.26, 0.11, 0.02, W, 0.75, deckY + 0.55, rz + 0.03, hut).rotation.z = 0.06;

    // tiki torches either side of the steps (flames animate in update())
    for (const tx of [-0.25, 0.65]) {
      const tz = rz + 0.62;
      this.log(0.02, 0.95, D, tx, deckY - 0.75, tz, hut);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.035, 0.1, 10), this.thatchMat);
      cup.position.set(tx, deckY + 0.24, tz);
      hut.add(cup);
      const fm = new THREE.MeshStandardMaterial({ color: 0xffb04a, emissive: 0xff7a1a, emissiveIntensity: 2.2, roughness: 1 });
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 8).translate(0, 0.06, 0), fm);
      flame.position.set(tx, deckY + 0.29, tz);
      hut.add(flame);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
      glow.scale.setScalar(0.42);
      glow.position.set(tx, deckY + 0.36, tz);
      hut.add(glow);
      this.flames.push({ mat: fm, glow, phase: this.rng.range(0, 10), base: 0.42 });
    }
    {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.45 }));
      glow.scale.setScalar(0.32);
      glow.position.set(-0.35, floor + wallH - 0.15, rz - 0.05);
      hut.add(glow);
      this.flames.push({ mat: glass.material as THREE.MeshStandardMaterial, glow, phase: 3, base: 0.32 });
    }
    // fishing net hanging on the left wall
    const netPts: number[] = [];
    const nx0 = room.x0 - 0.06;
    for (let i = 0; i <= 6; i++) {
      const z = -0.5 + i * 0.1;
      netPts.push(nx0, floor + 0.85, z, nx0, floor + 0.3 - Math.sin((i / 6) * Math.PI) * 0.08, z);
    }
    for (let j = 0; j <= 5; j++) {
      const y = floor + 0.85 - j * 0.1;
      const sag = Math.sin((j / 5) * Math.PI) * 0.0;
      netPts.push(nx0 - sag, y, -0.5, nx0 - sag, y, 0.1);
    }
    const net = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(netPts, 3)), new THREE.LineBasicMaterial({ color: 0xe8dcc0 }));
    hut.add(net);
    return hut;
  }

  /**
   * Volumetric thatch: a dark underlay shell covered by ~600 instanced straw bundles laid in
   * overlapping rows on every roof face, a rolled ridge cap and a ragged hanging fringe.
   */
  private buildRoof(halfX: number, halfZ: number, height: number, eaveY: number) {
    const roof = new THREE.Group();
    const ridgeHalf = Math.max(0.05, halfX - halfZ * 0.92);
    const yTop = eaveY + height;
    const under = new THREE.Mesh(hipRoofGeometry(halfX * 0.97, halfZ * 0.97, ridgeHalf, eaveY + 0.02, yTop - 0.02, 0.07), this.darkThatch());
    under.castShadow = true;
    under.receiveShadow = true;
    roof.add(under);

    const E = [
      new THREE.Vector3(-halfX, eaveY, halfZ),
      new THREE.Vector3(halfX, eaveY, halfZ),
      new THREE.Vector3(halfX, eaveY, -halfZ),
      new THREE.Vector3(-halfX, eaveY, -halfZ),
    ];
    const R0 = new THREE.Vector3(-ridgeHalf, yTop, 0),
      R1 = new THREE.Vector3(ridgeHalf, yTop, 0);
    type Face = (s: number, t: number) => THREE.Vector3;
    const quad = (A: THREE.Vector3, B: THREE.Vector3, C: THREE.Vector3, D: THREE.Vector3): Face => (u, t) =>
      A.clone().lerp(B, u).lerp(D.clone().lerp(C, u), t);
    const tri = (A: THREE.Vector3, B: THREE.Vector3, C: THREE.Vector3): Face => (u, t) => A.clone().lerp(B, u).lerp(C, t);
    const faces: Face[] = [quad(E[0], E[1], R1, R0), quad(E[2], E[3], R0, R1), tri(E[1], E[2], R1), tri(E[3], E[0], R0)];

    const bundle = thatchBundleGeometry();
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    const centre = new THREE.Vector3(0, eaveY + height * 0.4, 0);
    for (const F of faces) {
      const slope = F(0.5, 1).distanceTo(F(0.5, 0));
      const rows = Math.ceil(slope / 0.095);
      for (let r = 0; r < rows; r++) {
        const t = 1 - (r + 0.15) / rows;
        const w = F(1, t).distanceTo(F(0, t));
        const n = Math.max(1, Math.round(w / 0.105));
        for (let k = 0; k < n; k++) {
          const u = (k + 0.5 + this.rng.range(-0.25, 0.25)) / n;
          const P = F(u, t);
          const down = F(u, Math.max(0, t - 0.05)).sub(F(u, Math.min(1, t + 0.05))).normalize();
          const across = F(Math.min(1, u + 0.05), t).sub(F(Math.max(0, u - 0.05), t)).normalize();
          let nrm = new THREE.Vector3().crossVectors(across, down).normalize();
          if (nrm.dot(P.clone().sub(centre)) < 0) nrm.negate();
          const X = new THREE.Vector3().crossVectors(nrm, down).normalize();
          const m = new THREE.Matrix4().makeBasis(X, nrm, down);
          m.multiply(new THREE.Matrix4().makeRotationY(this.rng.range(-0.12, 0.12)));
          const sc = this.rng.range(0.9, 1.18);
          m.scale(new THREE.Vector3(sc, this.rng.range(0.8, 1.3), this.rng.range(0.95, 1.2) * (r === rows - 1 ? 1.25 : 1)));
          m.setPosition(P.addScaledVector(nrm, 0.04 + 0.006 * (rows - r)));
          mats.push(m);
          cols.push(new THREE.Color().setHSL(0.1 + this.rng.range(-0.012, 0.015), this.rng.range(0.38, 0.55), this.rng.range(0.44, 0.66)));
        }
      }
    }
    const inst = new THREE.InstancedMesh(bundle, this.thatchMat, mats.length);
    mats.forEach((m, i) => {
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, cols[i]);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    roof.add(inst);

    // rolled ridge cap with tied bands
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, ridgeHalf * 2 + 0.28, 12), this.thatchMat);
    cap.rotation.z = Math.PI / 2;
    cap.position.y = yTop + 0.04;
    cap.castShadow = true;
    roof.add(cap);
    const tieMat = new THREE.MeshStandardMaterial({ color: 0x5a3e22, roughness: 0.9 });
    for (let i = 0; i < 4; i++) {
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.008, 6, 16), tieMat);
      tie.rotation.y = Math.PI / 2;
      tie.position.set(-ridgeHalf - 0.08 + (i / 3) * (ridgeHalf * 2 + 0.16), yTop + 0.04, 0);
      roof.add(tie);
    }

    // ragged fringe along the eave
    const strand = new THREE.ConeGeometry(0.012, 0.2, 4);
    strand.translate(0, -0.1, 0);
    strand.rotateX(Math.PI);
    strand.translate(0, -0.2, 0);
    const count = 620;
    const fringe = new THREE.InstancedMesh(strand, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), count);
    const m4 = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      sv = new THREE.Vector3(),
      pv = new THREE.Vector3();
    const hx = halfX + 0.06,
      hz = halfZ + 0.06;
    const per = 2 * (hx * 2 + hz * 2);
    for (let i = 0; i < count; i++) {
      let d = (i / count) * per + this.rng.range(-0.01, 0.01);
      if (d < hx * 2) pv.set(-hx + d, eaveY + 0.02, hz);
      else if ((d -= hx * 2) < hz * 2) pv.set(hx, eaveY + 0.02, hz - d);
      else if ((d -= hz * 2) < hx * 2) pv.set(hx - d, eaveY + 0.02, -hz);
      else pv.set(-hx, eaveY + 0.02, -hz + (d - hx * 2));
      q.setFromEuler(new THREE.Euler(this.rng.range(-0.25, 0.25), this.rng.range(0, 3), this.rng.range(-0.25, 0.25)));
      sv.set(1, this.rng.range(0.5, 1.35), 1);
      m4.compose(pv, q, sv);
      fringe.setMatrixAt(i, m4);
      fringe.setColorAt(i, new THREE.Color().setHSL(0.1, 0.45, this.rng.range(0.4, 0.64)));
    }
    fringe.castShadow = true;
    roof.add(fringe);
    return roof;
  }

  private darkThatch() {
    const m = this.thatchMat.clone();
    m.color = new THREE.Color(0x8a7050);
    return m;
  }

  // --------------------------------------------------------------- palms
  private addPalm(x: number, z: number, height: number, leanX: number, leanZ: number, phase: number) {
    const y0 = this.terrain.heightAt(x, z) - 0.15;
    const palm = new THREE.Group();
    palm.position.set(x, y0, z);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(leanX * 0.12, height * 0.3, leanZ * 0.1),
      new THREE.Vector3(leanX * 0.45, height * 0.65, leanZ * 0.4),
      new THREE.Vector3(leanX, height, leanZ),
    ]);
    const trunkGeo = taperedTube(curve, 28, 12, (t) => 0.115 * (1 - 0.32 * t) + 0.07 * Math.exp(-t * 14), 7, false);
    // ring bulges
    const pos = trunkGeo.attributes.position as THREE.BufferAttribute;
    const uv = trunkGeo.attributes.uv as THREE.BufferAttribute;
    const nor = trunkGeo.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const v = uv.getY(i);
      const bump = 0.012 * Math.pow(Math.abs(Math.sin(v * Math.PI * 2.2)), 6);
      pos.setXYZ(i, pos.getX(i) + nor.getX(i) * bump, pos.getY(i) + nor.getY(i) * bump, pos.getZ(i) + nor.getZ(i) * bump);
    }
    trunkGeo.computeVertexNormals();
    const trunk = new THREE.Mesh(trunkGeo, this.barkMat);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    palm.add(trunk);
    this.group.add(palm);

    const top = new THREE.Vector3(x + leanX, y0 + height, z + leanZ);
    const crown = new THREE.Group();
    crown.position.copy(top);
    this.group.add(crown);
    // crown shaft + old frond boots (fibrous bases)
    const shaft = new THREE.Mesh(
      lathe([[0.001, -0.32], [0.1, -0.3], [0.15, -0.16], [0.17, -0.02], [0.13, 0.08], [0.06, 0.14], [0.001, 0.16]], 14, (a2, t) => 1 + 0.06 * Math.sin(a2 * 7) * t),
      this.barkMat,
    );
    shaft.castShadow = true;
    crown.add(shaft);
    for (let i = 0; i < 9; i++) {
      const a2 = (i / 9) * Math.PI * 2 + this.rng.range(-0.2, 0.2);
      const boot = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 6).translate(0, 0.13, 0), this.barkMat);
      boot.position.set(Math.cos(a2) * 0.1, -0.22 + this.rng.range(-0.04, 0.04), Math.sin(a2) * 0.1);
      boot.rotation.set(Math.sin(a2) * 0.9, 0, -Math.cos(a2) * 0.9);
      crown.add(boot);
    }
    // two tiny flower-stage buttons; the real coconuts are grown by CoconutGrowth (V3)
    const nutGreen = new THREE.MeshStandardMaterial({ color: 0x6a8a30, roughness: 0.4 });
    const nutGeo = coconutGeometry();
    for (let i = 0; i < 2; i++) {
      const a2 = i * 2.6 + 0.4;
      const nut = new THREE.Mesh(nutGeo, nutGreen);
      nut.position.set(Math.cos(a2) * 0.09, -0.12, Math.sin(a2) * 0.09);
      nut.scale.setScalar(0.38);
      crown.add(nut);
    }
    // fronds in whorls: young upright, mature spreading, old drooping, dead hanging
    const fronds: THREE.Object3D[] = [];
    const defs: { pitch: number; len: number; dead?: boolean }[] = [];
    for (let i = 0; i < 4; i++) defs.push({ pitch: this.rng.range(0.55, 0.95), len: this.rng.range(1.2, 1.5) });
    for (let i = 0; i < 7; i++) defs.push({ pitch: this.rng.range(-0.05, 0.3), len: this.rng.range(1.8, 2.15) });
    for (let i = 0; i < 4; i++) defs.push({ pitch: this.rng.range(-0.55, -0.3), len: this.rng.range(1.75, 2.0) });
    defs.push({ pitch: -1.25, len: 1.6, dead: true }, { pitch: -1.1, len: 1.5, dead: true });
    defs.forEach((d, i) => {
      const pivot = new THREE.Group();
      let yaw = i * 2.399 + this.rng.range(-0.15, 0.15); // golden-angle spiral like real crowns
      // dry hanging fronds go to the back sides so they never curtain the coconuts from view
      if (d.dead) yaw = Math.PI / 2 + (i % 2 ? 1 : -1) * this.rng.range(0.7, 1.1);
      pivot.rotation.order = 'YZX';
      pivot.rotation.y = yaw;
      pivot.rotation.z = d.pitch;
      pivot.rotation.x = this.rng.range(-0.25, 0.25);
      const frond = new THREE.Mesh(frondGeometry(d.len, !!d.dead, this.rng), this.leafMat);
      frond.castShadow = true;
      pivot.add(frond);
      pivot.userData.baseZ = pivot.rotation.z;
      pivot.userData.baseY = yaw;
      crown.add(pivot);
      fronds.push(pivot);
    });
    this.palms.push({ crown, top, origin: palm.position.clone(), fronds, phase, bend: Math.min(1, (height / 4.2) ** 2), trunk, shake: 0, shakeT: 0, spine: curve.getPoints(14).map((p) => p.add(palm.position)) });
  }

  // --------------------------------------------------------------- plants
  private addBush(x: number, z: number, size: number, kind: 'ti' | 'green' | 'hibiscus') {
    const y = this.terrain.heightAt(x, z) - 0.03;
    const geos: THREE.BufferGeometry[] = [];
    const leaves = kind === 'ti' ? 11 : 14;
    for (let i = 0; i < leaves; i++) {
      const L = size * this.rng.range(0.55, 0.95) * (kind === 'ti' ? 1.1 : 0.75);
      const g = leafGeometry({ length: L, width: L * (kind === 'ti' ? 0.24 : 0.42), segs: 8, fold: 0.35, curl: this.rng.range(0.25, 0.5) });
      const base = new THREE.Color(
        kind === 'ti' ? (i % 3 === 0 ? 0x7a2a4a : 0x3f6a2a) : kind === 'hibiscus' ? 0x2f6e2c : i % 2 ? 0x3d7a2e : 0x4f8a34,
      );
      const tip = base.clone().offsetHSL(0.02, 0, 0.12);
      paint(g, (p, _n, c) => c.copy(base).lerp(tip, Math.min(1, p.x / L)));
      g.rotateZ(this.rng.range(0.45, 1.1));
      g.rotateY((i / leaves) * Math.PI * 2 + this.rng.range(-0.3, 0.3));
      g.translate(0, this.rng.range(0.02, 0.12) * size, 0);
      geos.push(g);
    }
    if (kind === 'hibiscus') {
      for (let f = 0; f < 5; f++) {
        const petals: THREE.BufferGeometry[] = [];
        for (let p = 0; p < 5; p++) {
          const pg = leafGeometry({ length: 0.07, width: 0.07, segs: 4, fold: -0.2, curl: -0.3 });
          paint(pg, (_p, _n, c) => c.set(0xe8304a));
          pg.rotateZ(0.5);
          pg.rotateY((p / 5) * Math.PI * 2);
          petals.push(pg);
        }
        const fl = merge(petals);
        const a = this.rng.range(0, Math.PI * 2);
        fl.translate(Math.cos(a) * size * 0.35, size * this.rng.range(0.25, 0.45), Math.sin(a) * size * 0.35);
        geos.push(fl);
      }
    }
    const mesh = new THREE.Mesh(merge(geos), this.bushMat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private addGrass() {
    const blade = leafGeometry({ length: 0.32, width: 0.03, segs: 4, fold: 0.1, curl: 0.25, shape: (t) => 1 - t * 0.9 });
    blade.rotateZ(Math.PI / 2);
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x8aa04a, roughness: 0.8, side: THREE.DoubleSide }), {
      sway: { height: 0.32, amount: 0.05, base: 0.3, wind: 1.2, speed: 1.8, instanced: true },
      key: 'grass',
    });
    const tufts: [number, number][] = [];
    const I = CONFIG.island;
    for (let i = 0; i < 16; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(0.9, 1.75);
      tufts.push([I.x + Math.cos(a) * r * 1.1, I.z + (Math.sin(a) * r) / I.zScale]);
    }
    const per = 14;
    const mesh = new THREE.InstancedMesh(blade, mat, tufts.length * per);
    const phases = new Float32Array(tufts.length * per);
    const m4 = new THREE.Matrix4();
    let k = 0;
    for (const [tx, tz] of tufts) {
      const y = this.terrain.heightAt(tx, tz);
      if (y < 0.15) continue;
      for (let b = 0; b < per; b++) {
        const e = new THREE.Euler(this.rng.range(-0.5, 0.5), this.rng.range(0, Math.PI * 2), this.rng.range(-0.5, 0.5));
        const s = this.rng.range(0.6, 1.25);
        m4.compose(
          new THREE.Vector3(tx + this.rng.range(-0.08, 0.08), y - 0.02, tz + this.rng.range(-0.08, 0.08)),
          new THREE.Quaternion().setFromEuler(e),
          new THREE.Vector3(s, s, s),
        );
        mesh.setMatrixAt(k, m4);
        mesh.setColorAt(k, new THREE.Color().setHSL(0.17 + this.rng.range(-0.03, 0.04), 0.45, this.rng.range(0.32, 0.5)));
        phases[k] = this.rng.range(0, 6.28);
        k++;
      }
    }
    mesh.count = k;
    blade.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.castShadow = true;
    this.group.add(mesh);
  }

  private addBeachProps() {
    const I = CONFIG.island;
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b8378, roughness: 0.9 });
    const spots: [number, number, number][] = [
      [I.x - 2.0, I.z + 1.1, 0.16],
      [I.x + 2.1, I.z + 0.9, 0.12],
      [I.x + 1.95, I.z + 1.15, 0.08],
    ];
    spots.forEach(([x, z, r], i) => {
      const m = new THREE.Mesh(rockGeometry(r, 2, i * 3.1, 0.6), rockMat);
      m.position.set(x, this.terrain.heightAt(x, z) - r * 0.15, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    });
  }

  /** Shake a palm (Coconut harvest). */
  shakePalm(i: number) {
    const p = this.palms[i];
    if (!p) return;
    p.shake = 1;
    p.shakeT = 0;
  }

  update(dt: number, time: number) {
    const n = this.night;
    for (const f of this.flames) {
      const k = 0.8 + 0.2 * Math.sin(time * 13 + f.phase) * Math.sin(time * 7.3 + f.phase * 2);
      f.mat.emissiveIntensity = (1.6 + k) * (1 + n * 0.8);
      f.glow.scale.setScalar(f.base * (0.9 + 0.15 * k) * (1 + n * 1.6));
      (f.glow.material as THREE.SpriteMaterial).opacity = (0.4 + 0.25 * k) * (0.7 + n * 0.5);
    }
    const flick = 0.92 + 0.08 * Math.sin(time * 9.1) * Math.sin(time * 5.3);
    this.interiorMat.emissiveIntensity = 0.12 + n * 2.4 * flick;
    this.hutLight.intensity = n * 2.2 * flick;
    for (const g of this.windowGlow) (g.material as THREE.SpriteMaterial).opacity = n * 0.55 * flick;
    // Mirror the bark sway shader so crowns stay attached to the bending trunks.
    const wind = shared.uWind.value;
    const st = shared.uSwayTime.value * 0.8;
    for (const palm of this.palms) {
      const off = swayOffset(palm.origin, st, wind, 0.22, 0.18, 1.0);
      const b = palm.bend;
      palm.crown.position.set(palm.top.x + off.x * b, palm.top.y - off.y * b, palm.top.z + off.z * b);
      // user shake: a quick damped wobble of the crown and a rustle through the fronds
      palm.shake = Math.max(0, palm.shake - dt * 0.9);
      palm.shakeT += dt;
      const sk = palm.shake * palm.shake;
      const wob = Math.sin(palm.shakeT * 17) * sk;
      palm.crown.position.x += wob * 0.09;
      palm.crown.rotation.z = -off.x * 0.35 - wob * 0.16;
      palm.crown.rotation.x = off.z * 0.3 + Math.sin(palm.shakeT * 13 + 1) * sk * 0.08;
      palm.fronds.forEach((f, i) => {
        const flutter = Math.sin(time * (1.6 + wind * 2.2) + i * 1.7 + palm.phase) * (0.025 + wind * 0.09) + Math.sin(palm.shakeT * 21 + i * 2.1) * sk * 0.14;
        f.rotation.z = f.userData.baseZ + flutter - wind * 0.06;
        f.rotation.y = f.userData.baseY + Math.sin(time * 0.9 + i) * (0.02 + wind * 0.05);
      });
    }
  }
}

/** JS mirror of the GLSL sway in patchMaterial (bend factor = 1 at the top). */
export function swayOffset(
  origin: THREE.Vector3,
  st: number,
  wind: number,
  amount: number,
  base: number,
  windK: number,
) {
  const ph = origin.x * 0.71 + origin.z * 1.37;
  const s = Math.sin(st * 1.3 + ph) * 0.62 + Math.sin(st * 2.27 + ph * 1.9) * 0.28 + Math.sin(st * 0.53 + ph * 0.7) * 0.25;
  const amp = amount * (base + wind * windK);
  return {
    x: s * amp + wind * windK * amount * 0.45,
    z: Math.cos(st * 1.1 + ph * 1.3) * amp * 0.35,
    y: Math.abs(s) * amp * 0.25,
  };
}

/**
 * Pinnate coconut frond: arched, tapered rachis with ~70 lanceolate leaflets. Each leaflet is
 * a creased strip that leaves the rachis angled toward the tip, rising slightly (V-shaped
 * frond cross-section) and drooping along its length. Colour varies per leaflet; some tips
 * are sun-bleached. Dead fronds are brown, narrower and hang.
 */
function frondGeometry(length: number, dead: boolean, rng: Rng) {
  const pos: number[] = [],
    col: number[] = [],
    idx: number[] = [];
  const rachis = (t: number) => new THREE.Vector3(t * length, length * (0.3 * t - 0.62 * t * t), 0);
  const base = dead ? new THREE.Color(0x7a5a32) : new THREE.Color(0x2b6326);
  const mid = dead ? new THREE.Color(0x9a7a48) : new THREE.Color(0x46852f);
  const tip = dead ? new THREE.Color(0xb89a62) : new THREE.Color(0x93b845);
  const push = (v: THREE.Vector3, c: THREE.Color) => {
    pos.push(v.x, v.y, v.z);
    col.push(c.r, c.g, c.b);
    return pos.length / 3 - 1;
  };
  // rachis: two crossed tapered ribbons so it reads from any angle
  const RS = 18;
  for (const plane of [0, 1]) {
    const start = pos.length / 3;
    for (let i = 0; i <= RS; i++) {
      const t = i / RS;
      const p = rachis(t);
      const w = 0.03 * (1 - t * 0.85) + 0.004;
      const c = base.clone().lerp(mid, t).multiplyScalar(0.8);
      if (plane === 0) {
        push(new THREE.Vector3(p.x, p.y + w, 0), c);
        push(new THREE.Vector3(p.x, p.y - w * 0.6, 0), c);
      } else {
        push(new THREE.Vector3(p.x, p.y, w), c);
        push(new THREE.Vector3(p.x, p.y, -w), c);
      }
      if (i < RS) {
        const a = start + i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }
  // leaflets
  const N = dead ? 22 : 36;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const t = 0.06 + (i / (N - 1)) * 0.92;
    const p = rachis(t);
    const dir = rachis(Math.min(1, t + 0.01)).sub(p).normalize();
    const Lmax = length * (dead ? 0.24 : 0.34);
    const L = Lmax * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)), 0.65) * rng.range(0.85, 1.08);
    const W = (dead ? 0.03 : 0.055) * (1 - t * 0.35);
    const tint = rng.range(0.88, 1.12);
    const sunburn = !dead && rng.next() < 0.12;
    for (const side of [-1, 1]) {
      const angle = rng.range(0.85, 1.05); // radians from the rachis toward the side
      const lift = dead ? -0.9 : 0.28 - t * 0.35;
      const out = dir.clone().multiplyScalar(Math.cos(angle)).add(new THREE.Vector3(0, lift, side * Math.sin(angle))).normalize();
      const across = new THREE.Vector3().crossVectors(up, out).normalize();
      const droop = (dead ? 1.0 : 0.35 + t * 0.55) * L;
      const SEG = 4;
      const startIdx = pos.length / 3;
      for (let k = 0; k <= SEG; k++) {
        const u = k / SEG;
        const c = (u < 0.5 ? base.clone().lerp(mid, u * 2) : mid.clone().lerp(tip, (u - 0.5) * 2)).multiplyScalar(tint);
        if (sunburn && u > 0.6) c.lerp(new THREE.Color(0xc4ad62), (u - 0.6) * 1.8);
        const center = p.clone().addScaledVector(out, L * u);
        center.y -= droop * u * u;
        const w = W * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + u * 0.95)), 0.7);
        const keel = w * 0.35;
        push(center.clone().addScaledVector(across, w).setY(center.y + keel), c);
        push(center.clone(), c.clone().multiplyScalar(0.85));
        push(center.clone().addScaledVector(across, -w).setY(center.y + keel), c);
      }
      for (let k = 0; k < SEG; k++) {
        const a = startIdx + k * 3,
          b = a + 3;
        idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A single dry, brown frond (Ocean Surprises: a leaf that drops from a palm). */
export function deadFrond(seed: number) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75 });
  return new THREE.Mesh(frondGeometry(1.25, true, new Rng(seed)), mat);
}

/** Coconut: slightly three-sided ovoid with a pointed tip. */
export function coconutGeometry() {
  const g = new THREE.SphereGeometry(0.085, 16, 12);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.06 * Math.cos(a * 3) * (1 - Math.abs(y) / 0.085);
    const tipK = y < 0 ? 1 + (-y / 0.085) * 0.12 : 1;
    p.setXYZ(i, x * k, y * 1.15 * tipK, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Soft radial glow for torch flames and the lantern. */
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,220,150,1)');
  grd.addColorStop(0.3, 'rgba(255,170,80,0.55)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** One straw bundle: a tapered, slightly arched slab hanging down-slope from its origin. */
function thatchBundleGeometry() {
  const g = new THREE.BoxGeometry(0.14, 0.03, 0.3, 3, 1, 5);
  g.translate(0, 0, 0.15);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const t = z / 0.3;
    p.setX(i, p.getX(i) * (0.85 + 0.35 * t));
    p.setY(i, p.getY(i) * (1 - 0.6 * t) + Math.sin(Math.PI * t) * 0.02);
  }
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.4, uv.getY(i) * 0.8);
  g.computeVertexNormals();
  return g;
}

/** Builds a hip roof shell between an eave rectangle and a ridge line, with thickness. */
function hipRoofGeometry(hx: number, hz: number, ridgeHalf: number, yEave: number, yTop: number, thick: number) {
  const E = [
    new THREE.Vector3(-hx, yEave, hz),
    new THREE.Vector3(hx, yEave, hz),
    new THREE.Vector3(hx, yEave, -hz),
    new THREE.Vector3(-hx, yEave, -hz),
  ];
  const R0 = new THREE.Vector3(-ridgeHalf, yTop, 0),
    R1 = new THREE.Vector3(ridgeHalf, yTop, 0);
  const faces: THREE.Vector3[][] = [
    [E[0], E[1], R1, R0], // front
    [E[2], E[3], R0, R1], // back
    [E[1], E[2], R1], // right
    [E[3], E[0], R0], // left
  ];
  const pos: number[] = [],
    uv: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ua: number[], ub: number[], uc: number[]) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    uv.push(...ua, ...ub, ...uc);
  };
  const slopeLen = Math.hypot(hz, yTop - yEave);
  for (const f of faces) {
    const vy = (p: THREE.Vector3) => ((p.y - yEave) / (yTop - yEave)) * slopeLen * 1.6;
    const ux = (p: THREE.Vector3) => (p.x + p.z) * 1.6;
    const U = (p: THREE.Vector3) => [ux(p), vy(p)];
    if (f.length === 4) {
      pushTri(f[0], f[1], f[2], U(f[0]), U(f[1]), U(f[2]));
      pushTri(f[0], f[2], f[3], U(f[0]), U(f[2]), U(f[3]));
    } else pushTri(f[0], f[1], f[2], U(f[0]), U(f[1]), U(f[2]));
  }
  // underside (offset down) and eave edge strips
  const n = pos.length;
  for (let i = 0; i < n; i += 9) {
    const a = [pos[i], pos[i + 1] - thick, pos[i + 2]],
      b = [pos[i + 3], pos[i + 4] - thick, pos[i + 5]],
      c = [pos[i + 6], pos[i + 7] - thick, pos[i + 8]];
    pos.push(...a, ...c, ...b);
    const u = uv.slice((i / 3) * 2, (i / 3) * 2 + 6);
    uv.push(u[0], u[1], u[4], u[5], u[2], u[3]);
  }
  for (let i = 0; i < 4; i++) {
    const a = E[i],
      b = E[(i + 1) % 4];
    const a2 = a.clone(),
      b2 = b.clone();
    a2.y -= thick;
    b2.y -= thick;
    pushTri(a, a2, b, [0, 0], [0, 0.1], [1, 0]);
    pushTri(b, a2, b2, [1, 0], [0, 0.1], [1, 0.1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
