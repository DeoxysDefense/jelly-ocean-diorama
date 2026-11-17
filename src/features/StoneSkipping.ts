import * as THREE from 'three';
import { CONFIG, zClamp } from '../config';
import { clamp, rand } from '../util/math';
import { fbm3 } from '../util/noise';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { App } from '../core/App';
import type { MiniGame, MiniGameManager } from './MiniGames';
import { makeSoftDot } from '../util/textures';

const G = 9.8;
/** Steepest water entry (radians) that still skips. */
const SKIP_ANGLE = 0.5;
/** Slowest horizontal speed that still skips. */
const SKIP_SPEED = 2.0;
const MAX_SPEED = 16;
const MAX_STONES = 4;

interface Stone {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: number;
  phase: 'fly' | 'sink' | 'rest' | 'fade';
  skips: number;
  t: number;
}

/**
 * Stone Skipping. Stand on the island's beach, pull back (slingshot style) and release: the
 * stone flies on a real 3D ballistic path and, each time it meets the shared water surface,
 * either skips — if it comes in flat and fast enough — or plunges in. Each contact pushes the
 * water simulation, so the rings are real waves in both views; strong hits make nearby fish dart.
 *
 * Front View: horizontal drag = power and left/right, vertical drag = launch angle, mouse wheel
 * turns the throw into / out of the scene (shown by the aim arc). Top View: the drag direction
 * on the water is the heading, wheel sets the launch angle.
 */
export class StoneSkippingGame implements MiniGame {
  readonly id = 'skip' as const;
  private stones: Stone[] = [];
  private held: THREE.Mesh;
  private origin = new THREE.Vector3();
  private aiming = false;
  private startPx = new THREE.Vector2();
  private startW = new THREE.Vector3();
  private aimVel = new THREE.Vector3();
  private power = 0;
  private yaw = 0.2;
  private elevTop = 0.14;
  private preview: THREE.Points;
  private previewPos = new Float32Array(64 * 3);
  private group = new THREE.Group();
  private lastSkips = -1;
  private flying: Stone | null = null;
  private stoneMats: THREE.MeshStandardMaterial[];

  constructor(private app: App, private mgr: MiniGameManager) {
    this.stoneMats = [0x8a8478, 0x6f6a62, 0x9a8a72, 0x7a7f80].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.62, metalness: 0.02 }));
    this.held = new THREE.Mesh(stoneGeometry(Math.random() * 100), this.stoneMats[0]);
    this.held.castShadow = true;
    // dotted aim arc (constant pixel size so it stays readable at any zoom)
    const pm = new THREE.PointsMaterial({ color: 0xffffff, size: 7, sizeAttenuation: false, map: makeSoftDot(), transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.previewPos, 3));
    this.preview = new THREE.Points(pg, pm);
    this.preview.frustumCulled = false;
    this.preview.renderOrder = 20;
    this.preview.visible = false;
    this.group.add(this.held, this.preview);
  }

  start() {
    this.app.world.add(this.group);
    this.findOrigin();
    this.refresh();
  }

  /**
   * The thrower stands at the island's waterline on the front-right beach (facing the open sea),
   * clear of the palm trunks so the stone in hand is always visible.
   */
  private findOrigin() {
    const app = this.app;
    const I = CONFIG.island;
    const level = app.sim.level;
    for (const ang of [0.8, 0.65, 0.95, 0.5, 1.1]) {
      const dx = Math.cos(ang),
        dz = Math.sin(ang);
      let r = 1;
      for (; r < 10; r += 0.05) if (app.terrain.heightAt(I.x + dx * r, I.z + dz * r * 0.87) < level - 0.02) break;
      r -= 0.35;
      const x = I.x + dx * r,
        z = zClamp(I.z + dz * r * 0.87, 1);
      const y = Math.max(app.terrain.heightAt(x, z), level) + 0.45;
      this.origin.set(x, y, z);
      const clear = app.island.palms.every((p) => p.spine.every((q) => Math.hypot(q.x - x, q.z - z) > 0.7 || Math.abs(q.y - y) > 0.8));
      if (clear) return;
    }
  }

  private get top() {
    return this.app.cam.isTop;
  }

  refresh() {
    const t = (k: Parameters<MiniGameManager['t']>[0]) => this.mgr.t(k);
    const best = this.app.prefs.data.bestSkips;
    const skips = Math.max(0, this.lastSkips);
    this.mgr.setHud(t('skip.title'), `${skips} ${skips === 1 ? t('skip.skip1') : t('skip.skips')} · ${t('skip.best')} ${best}`, this.top ? t('skip.helpTop') : t('skip.help'), [
      { id: 'exit', label: `${t('game.exit')} (Esc)`, onClick: () => this.mgr.exit() },
    ]);
  }

  // ---------------------------------------------------------------- input
  pointerDown(_ndc: THREE.Vector2, px: THREE.Vector2) {
    if (this.flying) return; // one stone in the air at a time
    this.findOrigin();
    this.aiming = true;
    this.startPx.copy(px);
    if (this.top) {
      const p = this.app.cam.onPlaneY(_ndc.x, _ndc.y, this.app.sim.level);
      if (p) this.startW.copy(p);
    }
    this.power = 0;
  }

  pointerMove(ndc: THREE.Vector2, px: THREE.Vector2) {
    if (!this.aiming) return;
    const app = this.app;
    const v = this.aimVel;
    if (this.top) {
      const p = app.cam.onPlaneY(ndc.x, ndc.y, app.sim.level);
      if (!p) return;
      const tx = this.startW.x - p.x,
        tz = this.startW.z - p.z;
      const L = Math.hypot(tx, tz);
      this.power = clamp(L / 5, 0, 1);
      const sp = 3 + this.power * (MAX_SPEED - 3);
      const ca = Math.cos(this.elevTop),
        sa = Math.sin(this.elevTop);
      v.set((tx / (L || 1)) * ca * sp, sa * sp, (tz / (L || 1)) * ca * sp);
    } else {
      // slingshot: pull left/down to throw right/up
      const tx = this.startPx.x - px.x,
        ty = px.y - this.startPx.y;
      const L = Math.hypot(tx, ty);
      this.power = clamp(L / 220, 0, 1);
      const sp = 3 + this.power * (MAX_SPEED - 3);
      const elev = clamp(Math.atan2(ty, Math.abs(tx) + 1e-3), -0.2, 1.1);
      const side = tx >= 0 ? 1 : -1;
      const ca = Math.cos(elev);
      v.set(side * Math.cos(this.yaw) * ca * sp, Math.sin(elev) * sp, -Math.sin(this.yaw) * ca * sp);
    }
    this.updatePreview();
    this.mgr.setStatus(`${this.mgr.t('skip.power')} ${Math.round(this.power * 100)}%`);
  }

  pointerUp() {
    if (!this.aiming) return;
    this.aiming = false;
    this.preview.visible = false;
    if (this.power < 0.08) {
      this.refresh();
      return;
    }
    this.throwStone(this.aimVel.clone());
  }

  wheel(delta: number) {
    if (this.top) this.elevTop = clamp(this.elevTop - Math.sign(delta) * 0.03, 0, 0.7);
    else this.yaw = clamp(this.yaw + Math.sign(delta) * 0.06, -0.8, 1.0);
    if (this.aiming) this.updatePreview();
  }

  /** Dashed arc of the throw until it first meets the water (or land). */
  private updatePreview() {
    const app = this.app;
    const p = this.origin.clone(),
      v = this.aimVel.clone();
    const dt = 0.005;
    let n = 0,
      acc = 0.3;
    for (let i = 0; i < 2000 && n < 64; i++) {
      v.y -= G * dt;
      const step = v.length() * dt;
      p.addScaledVector(v, dt);
      acc += step;
      const end = p.y <= app.sim.heightAt(p.x, p.z) || p.y <= app.terrain.heightAt(p.x, p.z);
      if (acc >= 0.32 || end) {
        acc = 0;
        this.previewPos.set([p.x, p.y, p.z], n * 3);
        n++;
      }
      if (end) break;
    }
    const g = this.preview.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, n);
    this.preview.visible = true;
  }

  // ---------------------------------------------------------------- physics
  /** Public for tests: throw with an explicit velocity from the beach. */
  throwStone(vel: THREE.Vector3) {
    if (this.flying) return null;
    if (this.stones.length >= MAX_STONES) this.removeStone(this.stones[0]);
    if (vel.length() > MAX_SPEED) vel.setLength(MAX_SPEED);
    const mesh = new THREE.Mesh(stoneGeometry(Math.random() * 100), this.stoneMats[Math.floor(Math.random() * this.stoneMats.length)]);
    mesh.castShadow = true;
    const s: Stone = { mesh, pos: this.origin.clone(), vel, spin: rand(18, 30), phase: 'fly', skips: 0, t: 0 };
    mesh.position.copy(s.pos);
    this.group.add(mesh);
    this.stones.push(s);
    this.flying = s;
    this.lastSkips = 0;
    this.mgr.setStatus(`0 ${this.mgr.t('skip.skips')}`);
    return s;
  }

  private contact(s: Stone, surf: number) {
    const app = this.app;
    const h = Math.hypot(s.vel.x, s.vel.z);
    const theta = Math.atan2(-s.vel.y, h) + rand(-0.03, 0.03);
    const impact = clamp(-s.vel.y / 6, 0, 1);
    if (h > SKIP_SPEED && theta < SKIP_ANGLE) {
      // skip: lose energy — steeper hits lose more — and bounce back up
      s.skips++;
      s.vel.y = Math.max(-s.vel.y * 0.78, h > 2.6 ? 0.45 : 0);
      const keep = 0.86 - 0.45 * theta;
      s.vel.x *= keep;
      s.vel.z *= keep;
      // tiny random deviation, like a real stone catching the water unevenly
      const a = rand(-0.05, 0.05);
      const c = Math.cos(a),
        sn = Math.sin(a);
      const vx = s.vel.x * c - s.vel.z * sn;
      s.vel.z = s.vel.x * sn + s.vel.z * c;
      s.vel.x = vx;
      s.pos.y = surf + 0.005;
      app.sim.disturb(s.pos.x, s.pos.z, -(0.25 + impact * 0.6), 0.3);
      app.sim.addRipple(s.pos.x, s.pos.z, 0.03 + impact * 0.04);
      app.spray.burst(s.pos.x, surf, s.pos.z, 0.15 + impact * 0.4, s.vel.x * 0.15, s.vel.z * 0.15);
      if (impact > 0.35) app.creatures.ripple(s.pos.x, s.pos.z, 0.4 + impact * 0.4);
      this.lastSkips = s.skips;
      this.mgr.setStatus(`${s.skips} ${s.skips === 1 ? this.mgr.t('skip.skip1') : this.mgr.t('skip.skips')}`);
      if (s.vel.y <= 0.01) this.plunge(s, surf, impact);
    } else this.plunge(s, surf, impact);
  }

  private plunge(s: Stone, surf: number, impact: number) {
    const app = this.app;
    s.phase = 'sink';
    s.vel.multiplyScalar(0.25);
    s.pos.y = surf - 0.05;
    app.sim.disturb(s.pos.x, s.pos.z, -(0.8 + impact * 1.2), 0.4);
    app.sim.addRipple(s.pos.x, s.pos.z, 0.06 + impact * 0.03);
    app.spray.burst(s.pos.x, surf, s.pos.z, 0.5 + impact * 0.5);
    app.bubbles.emit(s.pos.x, surf - 0.3, s.pos.z, 6, 0.12, 0.6);
    app.creatures.ripple(s.pos.x, s.pos.z, 0.8);
    this.finishThrow(s);
  }

  private finishThrow(s: Stone) {
    if (this.flying !== s) return;
    this.flying = null;
    const prefs = this.app.prefs;
    const t = this.mgr.t.bind(this.mgr);
    if (s.skips > prefs.data.bestSkips) {
      prefs.data.bestSkips = s.skips;
      prefs.changed();
      this.mgr.flash(`${s.skips} ${s.skips === 1 ? t('skip.skip1') : t('skip.skips')} · ${t('skip.new')}`, 2.4);
    } else this.mgr.flash(s.skips === 0 ? t('skip.sank') : `${s.skips} ${s.skips === 1 ? t('skip.skip1') : t('skip.skips')}!`);
    this.lastSkips = s.skips;
    this.refresh();
  }

  update(dt: number, time: number) {
    const app = this.app;
    // the stone in hand bobs gently at the beach
    this.held.visible = !this.flying;
    if (this.held.visible) {
      this.held.position.copy(this.origin).add(new THREE.Vector3(0, Math.sin(time * 2) * 0.03, 0));
      this.held.rotation.y += dt * 0.6;
    }
    const W = CONFIG.world;
    for (let i = this.stones.length - 1; i >= 0; i--) {
      const s = this.stones[i];
      s.t += dt;
      if (s.phase === 'fly') {
        const n = 6;
        const h = dt / n;
        for (let k = 0; k < n && s.phase === 'fly'; k++) {
          s.vel.y -= G * h;
          s.pos.addScaledVector(s.vel, h);
          const surf = app.sim.heightAt(s.pos.x, s.pos.z);
          const ground = app.terrain.heightAt(s.pos.x, s.pos.z);
          if (ground > surf - 0.04 && s.pos.y <= ground + 0.03) {
            // landed on sand: a soft thud, no skipping off land
            s.pos.y = ground + 0.03;
            s.phase = 'rest';
            s.t = 0;
            app.sediment.emitDust(s.pos.x, ground, s.pos.z, 4, 0.3);
            this.finishThrow(s);
          } else if (s.vel.y < 0 && s.pos.y <= surf) this.contact(s, surf);
        }
        if (s.phase === 'fly' && (s.pos.x > W.xMax - 0.5 || s.pos.x < W.xMin + 0.5 || s.pos.z > W.zFront - 0.2 || s.pos.z < W.zBack + 0.2 || s.t > 15)) {
          // left the diorama: count what it achieved
          this.finishThrow(s);
          s.phase = 'fade';
        }
        // flat spin around its own axis, nose slightly up
        s.mesh.rotation.set(0.15, s.mesh.rotation.y + s.spin * dt, 0);
      } else if (s.phase === 'sink') {
        // tumbles slowly to the bottom
        s.vel.x *= Math.exp(-dt * 3);
        s.vel.z *= Math.exp(-dt * 3);
        s.vel.y += (-0.6 - s.vel.y) * Math.min(1, dt * 3);
        s.pos.addScaledVector(s.vel, dt);
        s.mesh.rotation.x += dt * 1.5;
        const ground = app.terrain.heightAt(s.pos.x, s.pos.z) + 0.03;
        if (s.pos.y <= ground) {
          s.pos.y = ground;
          s.phase = 'rest';
          s.t = 0;
          app.sediment.emitDust(s.pos.x, ground, s.pos.z, 3, 0.25);
        }
      } else if (s.phase === 'rest') {
        s.mesh.rotation.x *= Math.exp(-dt * 4);
        if (s.t > 6) s.phase = 'fade';
      } else {
        const sc = s.mesh.scale.x - dt * 0.6;
        if (sc <= 0.02) {
          this.removeStone(s);
          continue;
        }
        s.mesh.scale.setScalar(sc);
      }
      s.mesh.position.copy(s.pos);
    }
  }

  private removeStone(s: Stone) {
    this.group.remove(s.mesh);
    s.mesh.geometry.dispose();
    const i = this.stones.indexOf(s);
    if (i >= 0) this.stones.splice(i, 1);
    if (this.flying === s) this.flying = null;
  }

  get stoneCount() {
    return this.stones.length;
  }

  exit() {
    for (const s of [...this.stones]) this.removeStone(s);
    this.app.world.remove(this.group);
    this.held.geometry.dispose();
    this.preview.geometry.dispose();
    const pm = this.preview.material as THREE.PointsMaterial;
    pm.map?.dispose();
    pm.dispose();
    for (const m of this.stoneMats) m.dispose();
  }
}

/** A flat, irregular beach pebble — not a sphere. */
function stoneGeometry(seed: number) {
  const ico = new THREE.IcosahedronGeometry(0.1, 3);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = mergeVertices(ico);
  ico.dispose();
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const k = 1 + 0.12 * fbm3(x * 9 + seed, y * 9, z * 9, 2);
    p.setXYZ(i, x * k * 1.0, y * k * 0.3, z * k * 0.8);
  }
  g.computeVertexNormals();
  return g;
}
