import * as THREE from 'three';
import { CONFIG } from '../config';
import { clamp, damp, rand } from '../util/math';
import { merge, paint, taperedTube } from '../util/geometry';
import { fbm3 } from '../util/noise';
import { patchMaterial } from '../util/shaders';
import { seaUrchin } from '../world/coralFactory';
import type { WorldContext } from './types';
import type { HabitatKind } from '../world/Habitat';

/**
 * V2 small lagoon residents: garden eels, crawling sea urchins and sea cucumbers, cleaner
 * shrimp. Each is a light, self-contained creature with the same small API as the v1 ones
 * (`group`, `pos`, `active`, `update`, `reset`, `poke`, `label`).
 */

const tmp = new THREE.Vector3();

/** A spot on the seabed in a habitat that stays wet at low tide. */
function seabedSpot(ctx: WorldContext, kinds: HabitatKind[], minDepth = 1.6, near?: THREE.Vector3, radius = 0): THREE.Vector3 | null {
  for (let i = 0; i < 30; i++) {
    let x: number, z: number;
    if (near) {
      const a = rand(0, Math.PI * 2),
        r = rand(0.2, radius);
      x = near.x + Math.cos(a) * r;
      z = near.z + Math.sin(a) * r;
    } else {
      const p = ctx.habitat?.sample(kinds[Math.floor(Math.random() * kinds.length)], [0, 0], tmp);
      if (!p) return null;
      x = p.x;
      z = p.z;
    }
    z = clamp(z, CONFIG.world.zBack + 0.8, CONFIG.world.zFront - 0.6);
    const g = ctx.terrain.heightAt(x, z);
    if (CONFIG.world.waterLevel - g < minDepth) continue;
    if (ctx.terrain.normalAt(x, z).y < 0.82) continue;
    return new THREE.Vector3(x, g, z);
  }
  return null;
}

// ============================================================================ garden eels

/**
 * A colony of spotted garden eels: thin bodies standing out of their burrows, all leaning into
 * the current. Anything coming close makes the nearest ones sink back into the sand; they rise
 * again slowly when it is calm.
 */
export class GardenEels {
  readonly group = new THREE.Group();
  active = true;
  readonly pos = new THREE.Vector3();
  readonly radius = 0.6;
  private eels: { g: THREE.Group; body: THREE.Mesh; ext: number; want: number; calm: number; phase: number; base: THREE.Vector3 }[] = [];
  private count = 0;
  private colonies: THREE.Vector3[] = [];

  constructor(private ctx: WorldContext, max: number) {
    // two colonies on open sand: the western lagoon and the top of the eastern drop-off
    const W = CONFIG.world;
    const candidates = [new THREE.Vector3(-45.5, 0, 0.5), new THREE.Vector3(-27.5, 0, -14.5), new THREE.Vector3(29.5, 0, -2.5)];
    for (const c of candidates) {
      const g = ctx.terrain.heightAt(c.x, c.z);
      if (W.waterLevel - g > 2) this.colonies.push(c.setY(g));
    }
    if (!this.colonies.length) this.colonies.push(new THREE.Vector3(-40, ctx.terrain.heightAt(-40, 0), 0));
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), { caustics: true, key: 'garden-eel' });
    for (let i = 0; i < max; i++) {
      const col = this.colonies[i % this.colonies.length];
      const a = rand(0, Math.PI * 2),
        r = Math.sqrt(rand(0, 1)) * 1.3;
      const x = col.x + Math.cos(a) * r,
        z = col.z + Math.sin(a) * r * 0.8;
      const base = new THREE.Vector3(x, ctx.terrain.heightAt(x, z), z);
      const body = new THREE.Mesh(eelGeometry(i * 7 + 3, rand(0.55, 0.75)), mat);
      body.castShadow = true;
      const g = new THREE.Group();
      g.position.copy(base);
      g.add(body);
      // a little sand ring around each burrow
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.025, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0x9a8a6a, roughness: 1 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.005;
      g.add(ring);
      this.group.add(g);
      this.eels.push({ g, body, ext: 1, want: 1, calm: 0, phase: rand(0, 6), base });
    }
    this.pos.copy(this.colonies[0]);
  }

  get label() {
    const out = this.eels.slice(0, this.count).filter((e) => e.ext > 0.5).length;
    return out > this.count / 2 ? 'swaying in the current' : 'hiding in their burrows';
  }

  setCount(n: number) {
    this.count = n;
    this.eels.forEach((e, i) => (e.g.visible = i < n));
  }

  /** Something passed close: the nearest eels retract. */
  scare(p: THREE.Vector3, radius: number) {
    for (let i = 0; i < this.count; i++) {
      const e = this.eels[i];
      const d = Math.hypot(e.base.x - p.x, e.base.z - p.z);
      if (d < radius && Math.abs(p.y - e.base.y) < 1.6) {
        e.want = 0.04;
        e.calm = rand(3, 7) * (1 - d / radius) + 2;
      }
    }
  }

  poke(from: THREE.Vector3) {
    this.scare(from, 2.4);
  }

  reset() {
    for (const e of this.eels) {
      e.ext = 1;
      e.want = 1;
      e.calm = 0;
    }
  }

  update(dt: number, time: number, threats: THREE.Vector3[]) {
    const flow = this.ctx.flow;
    let ducked = 0;
    for (let i = 0; i < this.count; i++) {
      const e = this.eels[i];
      e.calm -= dt;
      if (e.calm <= 0) e.want = 1;
      // fish swimming low over the colony make the eels duck
      for (const t of threats) {
        if (Math.abs(t.x - e.base.x) < 0.9 && Math.abs(t.z - e.base.z) < 0.9 && t.y - e.base.y < 0.9) {
          if (e.ext > 0.7) ducked++;
          e.want = 0.15;
          e.calm = Math.max(e.calm, 2.5);
        }
      }
      // retract fast, rise slowly
      e.ext = damp(e.ext, e.want, e.want < e.ext ? 9 : 0.6, dt);
      const s = Math.max(0.03, e.ext);
      e.body.scale.set(1, s, 1);
      e.body.position.y = -0.02 - (1 - s) * 0.04;
      // lean into the current (plus painted currents) and sway
      let lean = 0.22 + 0.06 * Math.sin(time * 0.7 + e.phase);
      let dir = 0.4;
      if (flow.active) {
        const v = flow.velocityAt(e.base.x, e.base.y + 0.3, e.base.z, tmp);
        lean += Math.min(0.5, Math.hypot(v.x, v.z) * 0.3);
        dir = Math.atan2(-v.z, v.x);
      }
      e.g.rotation.set(0, dir, 0);
      e.body.rotation.z = -lean * s;
      e.body.rotation.x = 0.06 * Math.sin(time * 1.3 + e.phase);
    }
    if (ducked > 0) this.ctx.sight?.('eelsDuck', this.eels[0].base);
  }
}

function eelGeometry(seed: number, len: number) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.05, 0),
    new THREE.Vector3(0.01, len * 0.4, 0),
    new THREE.Vector3(0.04, len * 0.8, 0),
    new THREE.Vector3(0.1, len, 0),
  ]);
  const body = taperedTube(curve, 18, 7, (t) => 0.034 * (1 - 0.25 * t) + 0.006 * Math.sin(t * 3), 1, true);
  const eye = new THREE.SphereGeometry(0.008, 6, 4);
  const e1 = eye.clone().translate(0.1, len - 0.005, 0.018);
  const e2 = eye.clone().translate(0.1, len - 0.005, -0.018);
  const g = merge([body, e1, e2]);
  const pale = new THREE.Color(0xeee8d8),
    spot = new THREE.Color(0x1a1a1a);
  paint(g, (p, _n, c) => {
    if (p.y > len - 0.02 && Math.abs(p.z) > 0.012 && p.x > 0.09) c.copy(spot);
    else c.copy(pale).lerp(spot, fbm3(p.x * 60 + seed, p.y * 60, p.z * 60, 1) > 0.32 ? 0.85 : 0).multiplyScalar(0.85 + 0.2 * (p.y / len));
  });
  return g;
}

// ============================================================================ crawlers

/**
 * A slow seabed crawler: sea urchins mostly move at night, sea cucumbers inch along the sand
 * all day, gently stretching and contracting as they go.
 */
export class Crawler {
  readonly group = new THREE.Group();
  active = true;
  readonly pos = new THREE.Vector3();
  readonly radius: number;
  private target = new THREE.Vector3();
  private home: THREE.Vector3;
  private yaw = rand(0, Math.PI * 2);
  private rest = 0;
  private phase = rand(0, 6);
  private mesh: THREE.Mesh;
  night = 0;

  constructor(private ctx: WorldContext, readonly kind: 'urchin' | 'cucumber', seed: number) {
    const spot = seabedSpot(ctx, kind === 'urchin' ? ['lagoonReef', 'lagoon'] : ['seagrass', 'lagoon'], 1.7) ?? new THREE.Vector3(-38, ctx.terrain.heightAt(-38, -2), -2);
    this.home = spot.clone();
    this.pos.copy(spot);
    this.target.copy(spot);
    this.radius = kind === 'urchin' ? 0.3 : 0.35;
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: kind === 'urchin' ? 0.45 : 0.75 }), { caustics: true, key: `crawler-${kind}` });
    const geo = kind === 'urchin' ? seaUrchin(seed, [0x2a1a3a, 0x3a1a1a, 0x5a2a6a][seed % 3], rand(1.05, 1.35)) : cucumberGeometry(seed);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.group.position.copy(this.pos);
  }

  get label() {
    if (this.kind === 'urchin') return this.rest > 0 ? 'resting in a crevice' : this.night > 0.5 ? 'grazing algae (night)' : 'crawling slowly';
    return this.rest > 0 ? 'resting' : 'sifting the sand';
  }

  private bristle = 0;
  poke(_from: THREE.Vector3) {
    // urchins bristle (stop for a while), cucumbers contract
    this.rest = rand(6, 12);
    this.bristle = 1;
  }

  reset() {
    this.pos.copy(this.home);
    this.target.copy(this.home);
    this.rest = 0;
  }

  update(dt: number, time: number) {
    const speed = this.kind === 'urchin' ? 0.02 + 0.04 * this.night : 0.035;
    this.rest -= dt;
    if (this.rest <= 0) {
      const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
      if (d < 0.08) {
        const next = seabedSpot(this.ctx, [], 1.6, this.home, 2.4);
        if (next) this.target.copy(next);
        this.rest = this.kind === 'urchin' ? rand(8, 25) * (1 - 0.6 * this.night) : rand(4, 12);
      } else {
        const step = Math.min(d, speed * dt);
        const dx = (this.target.x - this.pos.x) / d,
          dz = (this.target.z - this.pos.z) / d;
        this.pos.x += dx * step;
        this.pos.z += dz * step;
        const want = Math.atan2(-dz, dx);
        let dy = want - this.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += dy * Math.min(1, dt * 0.8);
      }
    }
    this.pos.y = this.ctx.terrain.heightAt(this.pos.x, this.pos.z);
    // stay wet: if the tide uncovered the spot, head back home (deeper)
    if (this.ctx.water.level - this.pos.y < 0.35) this.target.copy(this.home);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.bristle = Math.max(0, this.bristle - dt * 0.35);
    const b = Math.sin(Math.min(1, this.bristle * 1.5) * Math.PI * 0.5);
    if (this.kind === 'cucumber') {
      const moving = this.rest <= 0 ? 1 : 0.15;
      const k = Math.sin(time * 1.4 + this.phase) * 0.08 * moving;
      // poked: it pulls itself short and plump for a while
      this.mesh.scale.set((1 + k) * (1 - 0.3 * b), (1 - k * 0.6) * (1 + 0.15 * b), (1 - k * 0.4) * (1 + 0.15 * b));
    } else this.mesh.scale.setScalar(1 + 0.12 * b); // spines raised
  }
}

function cucumberGeometry(seed: number) {
  const L = rand(0.45, 0.6),
    R = 0.07;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-L / 2, R * 0.8, 0),
    new THREE.Vector3(-L * 0.15, R * 0.95, 0.02),
    new THREE.Vector3(L * 0.2, R * 0.9, -0.02),
    new THREE.Vector3(L / 2, R * 0.75, 0),
  ]);
  const g = taperedTube(curve, 24, 10, (t) => R * (0.65 + 0.4 * Math.sin(Math.PI * t)), 1, true);
  // papillae bumps
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const b = Math.pow(Math.max(0, fbm3(x * 40 + seed, y * 40, z * 40, 1)), 2) * 0.03 * (y > R * 0.6 ? 1 : 0.2);
    pos.setXYZ(i, x + nor.getX(i) * b, Math.max(0.005, y + nor.getY(i) * b), z + nor.getZ(i) * b);
  }
  g.computeVertexNormals();
  const top = new THREE.Color([0x6a4a2a, 0x3a3a2a, 0x8a5a3a][seed % 3]),
    belly = new THREE.Color(0xc8b090);
  paint(g, (p, _n, c) => {
    c.copy(belly)
      .lerp(top, clamp((p.y - 0.02) / (R * 1.2), 0, 1))
      .multiplyScalar(0.8 + 0.3 * fbm3(p.x * 25 + seed, p.y * 25, p.z * 25, 2));
  });
  return g;
}

// ============================================================================ shrimp

/**
 * Cleaner shrimp: tiny red-and-white shrimp that sit beside the patch reefs waving their long
 * white antennae, now and then hopping to a new spot. A poke sends them backwards with a tail flip.
 */
export class Shrimp {
  readonly group = new THREE.Group();
  active = true;
  readonly pos = new THREE.Vector3();
  readonly radius = 0.15;
  private home: THREE.Vector3;
  private hop: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null = null;
  private wait = rand(2, 6);
  private yaw = rand(0, Math.PI * 2);
  private antennae: THREE.Mesh[] = [];
  private phase = rand(0, 6);

  constructor(private ctx: WorldContext, seed: number) {
    const spot = seabedSpot(ctx, ['lagoonReef'], 1.7) ?? new THREE.Vector3(-37, ctx.terrain.heightAt(-37, -10), -10);
    this.home = spot.clone();
    this.pos.copy(spot);
    const body = new THREE.Mesh(shrimpGeometry(seed), patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, transparent: true, opacity: 0.95 }), { caustics: true, key: 'shrimp' }));
    body.castShadow = true;
    this.group.add(body);
    const antMat = new THREE.MeshBasicMaterial({ color: 0xf6f2ea });
    for (const s of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.12, 0.06, s * 0.03),
        new THREE.Vector3(0.28, 0.1, s * 0.09),
        new THREE.Vector3(0.42, 0.08, s * 0.16),
      ]);
      const a = new THREE.Mesh(taperedTube(curve, 10, 3, (t) => 0.003 * (1 - 0.6 * t), 1, false), antMat);
      a.position.set(0.1, 0.05, 0);
      this.group.add(a);
      this.antennae.push(a);
    }
    this.group.position.copy(this.pos);
  }

  get label() {
    return this.hop ? 'hopping' : 'waiting for a fish to clean';
  }

  poke(from: THREE.Vector3) {
    // tail flip: shoot backwards away from the poke
    const away = tmp.copy(this.pos).sub(from).setY(0);
    if (away.lengthSq() < 1e-4) away.set(rand(-1, 1), 0, rand(-1, 1));
    away.normalize().multiplyScalar(rand(0.6, 0.9));
    const to = this.pos.clone().add(away);
    to.z = clamp(to.z, CONFIG.world.zBack + 0.6, CONFIG.world.zFront - 0.5);
    to.y = this.ctx.terrain.heightAt(to.x, to.z);
    if (this.ctx.water.level - to.y < 0.5) return;
    this.hop = { from: this.pos.clone(), to, t: 0, dur: 0.35 };
  }

  reset() {
    this.pos.copy(this.home);
    this.hop = null;
  }

  update(dt: number, time: number) {
    if (this.hop) {
      const h = this.hop;
      h.t += dt;
      const k = Math.min(1, h.t / h.dur);
      this.pos.lerpVectors(h.from, h.to, k);
      this.pos.y += Math.sin(Math.PI * k) * 0.18;
      if (k >= 1) {
        this.hop = null;
        this.wait = rand(3, 9);
      }
    } else {
      this.wait -= dt;
      if (this.wait <= 0) {
        const next = seabedSpot(this.ctx, [], 1.5, this.home, 1.2);
        if (next) {
          this.yaw = Math.atan2(-(next.z - this.pos.z), next.x - this.pos.x);
          this.hop = { from: this.pos.clone(), to: next, t: 0, dur: rand(0.5, 0.8) };
        } else this.wait = 3;
      }
      this.pos.y = this.ctx.terrain.heightAt(this.pos.x, this.pos.z);
    }
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.antennae.forEach((a, i) => {
      a.rotation.y = Math.sin(time * 2.3 + this.phase + i * 1.7) * 0.35;
      a.rotation.z = Math.sin(time * 1.7 + this.phase + i) * 0.15;
    });
  }
}

function shrimpGeometry(seed: number) {
  // curved abdomen along an arc, a carapace, a fan tail and thin walking legs
  const arc = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.12, 0.06, 0),
    new THREE.Vector3(0.0, 0.08, 0),
    new THREE.Vector3(-0.1, 0.07, 0),
    new THREE.Vector3(-0.16, 0.04, 0),
  ]);
  const body = taperedTube(arc, 14, 8, (t) => 0.032 * (1 - 0.55 * t), 1, true);
  const head = new THREE.SphereGeometry(0.035, 10, 8).scale(1.4, 0.9, 0.9).translate(0.12, 0.065, 0);
  const tail = new THREE.ConeGeometry(0.04, 0.06, 6, 1).rotateZ(Math.PI / 2).scale(1, 1, 0.25).translate(-0.19, 0.035, 0);
  const legs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++)
    for (const s of [-1, 1]) {
      const x = 0.1 - i * 0.04;
      legs.push(new THREE.CylinderGeometry(0.003, 0.003, 0.07, 3).rotateX(s * 0.5).translate(x, 0.03, s * 0.02));
    }
  const g = merge([body, head, tail, ...legs]);
  const red = new THREE.Color(0xd8302a),
    white = new THREE.Color(0xfaf6f0);
  paint(g, (p, _n, c) => {
    // a white stripe down the back, red flanks, pale legs
    if (p.y < 0.04 && Math.abs(p.z) > 0.012) c.copy(white).multiplyScalar(0.9);
    else c.copy(Math.abs(p.z) < 0.009 && p.y > 0.07 ? white : red).multiplyScalar(0.9 + 0.15 * Math.sin(p.x * 120 + seed));
  });
  return g;
}

/** Re-export for the tooltip text of the crawlers. */
export function crawlerName(kind: 'urchin' | 'cucumber') {
  return kind === 'urchin' ? 'Sea urchin' : 'Sea cucumber';
}


