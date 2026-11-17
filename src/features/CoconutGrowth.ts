import * as THREE from 'three';
import { rand } from '../util/math';
import type { App } from '../core/App';
import { coconutGeometry } from '../world/Island';
import type { Prefs, TreeState } from './Prefs';
import { floatStep, type FloatBody } from './fx';

const SLOTS = 5;

interface Falling extends FloatBody {
  mesh: THREE.Mesh;
  phase: 'air' | 'roll' | 'float' | 'rest' | 'fade';
  t: number;
  life: number;
  spinAxis: THREE.Vector3;
  still: number;
}

/**
 * Coconut Growth & Harvest. Each palm grows coconuts on a real-time timer (default every 3 h,
 * user-adjustable), up to a per-tree limit. Growth is computed from wall-clock timestamps, so
 * time that passed while the wallpaper was closed still counts — capped at the limit, and
 * without replaying any drop animations.
 *
 * Click a ripe coconut to pick it, or click a palm to shake it: ripe coconuts fall with gravity,
 * bounce and roll down the beach, splash into the sea, bob on the shared wave surface for a while
 * and then sink away.
 */
export class CoconutGrowth {
  readonly group = new THREE.Group();
  private geo = coconutGeometry();
  private ripeMat = new THREE.MeshStandardMaterial({ color: 0x7a6230, roughness: 0.55 });
  private youngMat = new THREE.MeshStandardMaterial({ color: 0x6f8f2e, roughness: 0.38 });
  /** Per tree: slot meshes and which slots hold a ripe coconut. */
  private trees: { slots: THREE.Mesh[]; ripe: boolean[]; growing: THREE.Mesh }[] = [];
  private falling: Falling[] = [];
  private queue: { tree: number; slot: number; at: number }[] = [];
  private clock = 0;
  private tmp = new THREE.Vector3();

  constructor(private app: App, private prefs: Prefs) {
    for (const m of [this.ripeMat, this.youngMat]) m.userData.keep = true;
    app.island.palms.forEach((palm, ti) => {
      const slots: THREE.Mesh[] = [];
      for (let i = 0; i < SLOTS; i++) {
        // spread around the crown, biased toward the viewer so ripe nuts can be seen and clicked
        const a = Math.PI * 0.5 + (i / (SLOTS - 1) - 0.5) * Math.PI * 1.1 + ti * 0.25;
        const r = 0.22 + (i % 2) * 0.06;
        const m = new THREE.Mesh(this.geo, this.ripeMat);
        m.position.set(Math.cos(a) * r, -0.33 - (i % 2) * 0.08, Math.sin(a) * r);
        m.scale.setScalar(1.15);
        m.rotation.set(0.35 * Math.sin(a * 3), a, 0.3 * Math.cos(a * 2));
        m.castShadow = true;
        m.visible = false;
        m.userData = { coconut: true, tree: ti, slot: i };
        palm.crown.add(m);
        slots.push(m);
      }
      const growing = new THREE.Mesh(this.geo, this.youngMat.clone());
      growing.castShadow = true;
      growing.visible = false;
      palm.crown.add(growing);
      this.trees.push({ slots, ripe: new Array(SLOTS).fill(false), growing });
    });
    this.syncFromPrefs();
  }

  private get cfg() {
    return this.prefs.data.coconut;
  }
  private intervalMs() {
    return this.cfg.intervalMin * 60_000;
  }

  /** Re-reads tree state from prefs (startup / load / import) and fills slots. */
  syncFromPrefs() {
    this.catchUp(Date.now());
    this.trees.forEach((t, ti) => {
      const st = this.cfg.trees[ti];
      const n = Math.min(st?.ripe ?? 0, this.cfg.max);
      t.ripe.fill(false);
      for (let i = 0; i < n; i++) t.ripe[i] = true;
    });
  }

  /** Applies elapsed real time: whole intervals ripen coconuts, never beyond the limit. */
  private catchUp(now: number) {
    const iv = this.intervalMs();
    let changed = false;
    this.cfg.trees.forEach((st: TreeState, ti) => {
      if (!this.cfg.on) {
        st.since = now; // paused: time does not accumulate
        return;
      }
      if (st.ripe >= this.cfg.max) {
        st.since = now;
        return;
      }
      if (st.since > now) st.since = now; // clock moved backwards
      const k = Math.floor((now - st.since) / iv);
      if (k > 0) {
        const add = Math.min(k, this.cfg.max - st.ripe);
        st.ripe += add;
        st.since = st.ripe >= this.cfg.max ? now : st.since + add * iv;
        changed = true;
        const t = this.trees[ti];
        if (t) {
          let need = add;
          for (let i = 0; i < SLOTS && need > 0; i++)
            if (!t.ripe[i]) {
              t.ripe[i] = true;
              need--;
            }
        }
      }
    });
    if (changed) this.prefs.changed();
  }

  /** ms until the next coconut ripens (null = all trees full or growth paused). */
  nextIn(now = Date.now()): number | null {
    if (!this.cfg.on) return null;
    let best: number | null = null;
    for (const st of this.cfg.trees) {
      if (st.ripe >= this.cfg.max) continue;
      const left = Math.max(0, st.since + this.intervalMs() - now);
      if (best === null || left < best) best = left;
    }
    return best;
  }

  ripeTotal() {
    return this.cfg.trees.reduce((a, t) => a + t.ripe, 0);
  }

  setInterval(min: number) {
    this.cfg.intervalMin = min;
    this.prefs.changed();
  }
  setEnabled(on: boolean) {
    const now = Date.now();
    if (on && !this.cfg.on) for (const st of this.cfg.trees) st.since = now;
    this.cfg.on = on;
    this.prefs.changed();
  }
  setMax(n: number) {
    this.cfg.max = Math.max(3, Math.min(5, n));
    for (const [ti, st] of this.cfg.trees.entries()) {
      if (st.ripe > this.cfg.max) {
        st.ripe = this.cfg.max;
        const t = this.trees[ti];
        let seen = 0;
        for (let i = 0; i < SLOTS; i++) if (t.ripe[i] && ++seen > this.cfg.max) t.ripe[i] = false;
      }
    }
    this.prefs.changed();
  }

  // ---------------------------------------------------------------- input
  /** Click: a ripe coconut drops; a palm trunk / crown shakes the tree. Returns true if handled. */
  tryClick(rc: THREE.Raycaster): boolean {
    const nuts: THREE.Object3D[] = [];
    this.trees.forEach((t) => t.slots.forEach((m, i) => t.ripe[i] && nuts.push(m)));
    const hit = rc.intersectObjects(nuts, false)[0];
    if (hit) {
      const { tree, slot } = hit.object.userData as { tree: number; slot: number };
      this.drop(tree, slot, 0.4);
      this.app.island.shakePalm(tree);
      this.app.island.palms[tree].shake = 0.35;
      return true;
    }
    const ti = this.palmHit(rc);
    if (ti < 0) return false;
    this.shake(ti);
    return true;
  }

  /**
   * Index of the palm under the ray, or -1. Forgiving and cheap: distance from the ray to the
   * trunk's spine (a thin trunk is hard to hit exactly) or to the crown centre.
   */
  palmHit(rc: THREE.Raycaster): number {
    let best = -1,
      bd = Infinity;
    const ray = rc.ray;
    this.app.island.palms.forEach((p, i) => {
      let d = ray.distanceToPoint(p.crown.position) - 0.75;
      for (const s of p.spine) d = Math.min(d, ray.distanceToPoint(s) - 0.28);
      if (d < 0 && d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  hoverTarget(rc: THREE.Raycaster): boolean {
    const nuts: THREE.Object3D[] = [];
    this.trees.forEach((t) => t.slots.forEach((m, i) => t.ripe[i] && nuts.push(m)));
    return rc.intersectObjects(nuts, false).length > 0 || this.palmHit(rc) >= 0;
  }

  shake(ti: number) {
    this.app.island.shakePalm(ti);
    const t = this.trees[ti];
    let k = 0;
    t.ripe.forEach((r, i) => {
      if (r) this.queue.push({ tree: ti, slot: i, at: this.clock + 0.25 + k++ * rand(0.18, 0.35) });
    });
    if (k === 0) {
      const ms = this.nextIn();
      const ui = this.app.ui;
      if (ui) ui.toast(ms === null ? 'No ripe coconuts on this palm' : `No ripe coconuts yet — next in ${formatDuration(ms)}`);
    }
  }

  private drop(ti: number, slot: number, kick: number) {
    const t = this.trees[ti];
    if (!t.ripe[slot]) return;
    t.ripe[slot] = false;
    const st = this.cfg.trees[ti];
    if (st.ripe >= this.cfg.max) st.since = Date.now(); // the tree starts growing again
    st.ripe = Math.max(0, st.ripe - 1);
    this.prefs.changed();
    const src = t.slots[slot];
    src.updateWorldMatrix(true, false);
    const p = new THREE.Vector3().setFromMatrixPosition(src.matrixWorld);
    const mesh = new THREE.Mesh(this.geo, this.ripeMat);
    mesh.castShadow = true;
    mesh.position.copy(p);
    this.group.add(mesh);
    // fall away from the island centre so it ends up on the beach slope / in the sea
    const I = this.app.island.palms[ti].origin;
    const away = new THREE.Vector3(p.x - I.x, 0, p.z - I.z);
    if (away.lengthSq() < 1e-4) away.set(rand(-1, 1), 0, rand(-1, 1));
    away.normalize().multiplyScalar(kick + rand(0.2, 0.6));
    this.falling.push({
      mesh,
      pos: p.clone(),
      vel: new THREE.Vector3(away.x, rand(0.2, 0.8), away.z),
      draft: 0.045,
      yaw: rand(0, 6),
      spin: rand(-0.4, 0.4),
      tilt: 0.5,
      phase: 'air',
      t: 0,
      life: rand(50, 75),
      spinAxis: new THREE.Vector3(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).normalize(),
      still: 0,
    });
  }

  // ---------------------------------------------------------------- frame
  update(dt: number, wind: number) {
    this.clock += dt;
    const now = Date.now();
    this.catchUp(now);
    // shake queue
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (this.clock >= q.at) {
        this.drop(q.tree, q.slot, 0.7);
        this.queue.splice(i, 1);
      }
    }
    // hanging coconuts + the one currently growing
    const iv = this.intervalMs();
    this.trees.forEach((t, ti) => {
      t.slots.forEach((m, i) => (m.visible = t.ripe[i]));
      const st = this.cfg.trees[ti];
      const free = t.ripe.indexOf(false);
      const ripeCount = t.ripe.filter(Boolean).length;
      const growing = this.cfg.on && ripeCount < this.cfg.max && free >= 0;
      t.growing.visible = growing;
      if (growing) {
        const prog = Math.min(1, Math.max(0, (now - st.since) / iv));
        t.growing.position.copy(t.slots[free].position);
        t.growing.rotation.copy(t.slots[free].rotation);
        t.growing.scale.setScalar((0.22 + 0.78 * Math.pow(prog, 0.8)) * 1.15);
        (t.growing.material as THREE.MeshStandardMaterial).color.copy(this.youngMat.color).lerp(this.ripeMat.color, prog * prog * 0.8);
      }
    });
    this.updateFalling(dt, wind);
  }

  private updateFalling(dt: number, wind: number) {
    const app = this.app;
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      const p = f.pos;
      if (f.phase === 'air' || f.phase === 'roll') {
        f.vel.y -= 9.8 * dt;
        p.addScaledVector(f.vel, dt);
        const ground = app.terrain.heightAt(p.x, p.z) + 0.08;
        const surf = app.sim.heightAt(p.x, p.z);
        if (p.y <= surf && ground < app.sim.level - 0.1) {
          // splash into the sea
          const power = Math.min(1, Math.abs(f.vel.y) / 7);
          app.sim.disturb(p.x, p.z, -0.6 - power * 1.6, 0.45);
          app.sim.addRipple(p.x, p.z, 0.04 + power * 0.05);
          app.spray.burst(p.x, surf, p.z, 0.4 + power * 0.6);
          app.bubbles.emit(p.x, surf - 0.2, p.z, 5, 0.15, 0.6);
          app.creatures.ripple(p.x, p.z, 0.5 + power * 0.5);
          f.phase = 'float';
          f.vel.set(f.vel.x * 0.3, 0, f.vel.z * 0.3);
          p.y = surf - 0.25;
        } else if (p.y <= ground) {
          // hit the sand: bounce, then roll down the beach slope
          p.y = ground;
          if (f.vel.y < -1.2) {
            app.sediment.emitDust(p.x, ground, p.z, 3, 0.3);
            f.vel.y = -f.vel.y * 0.32;
            f.vel.x *= 0.7;
            f.vel.z *= 0.7;
          } else {
            f.vel.y = 0;
            f.phase = 'roll';
            const e = 0.2;
            const gx = (app.terrain.heightAt(p.x + e, p.z) - app.terrain.heightAt(p.x - e, p.z)) / (2 * e);
            const gz = (app.terrain.heightAt(p.x, p.z + e) - app.terrain.heightAt(p.x, p.z - e)) / (2 * e);
            f.vel.x += -gx * 6 * dt;
            f.vel.z += -gz * 6 * dt;
            f.vel.x *= Math.exp(-dt * 1.4);
            f.vel.z *= Math.exp(-dt * 1.4);
            const sp = Math.hypot(f.vel.x, f.vel.z);
            f.still = sp < 0.05 ? f.still + dt : 0;
            if (f.still > 1.5) f.phase = 'rest';
          }
        }
        // tumble while falling / rolling
        const sp = f.vel.length();
        f.mesh.rotateOnWorldAxis(f.spinAxis, sp * dt * 3);
        f.mesh.position.copy(p);
      } else if (f.phase === 'float') {
        // stranded by the receding tide / a wave trough: back to rolling on the sand
        if (app.terrain.heightAt(p.x, p.z) > app.sim.level - 0.02) {
          f.phase = 'roll';
          f.vel.set(0, 0, 0);
          p.y = app.terrain.heightAt(p.x, p.z) + 0.08;
          continue;
        }
        floatStep(f, app.sim, app.terrain, app.flow, dt, wind, f.mesh);
        // waterlogged nuts sit a little lower over time
        f.draft = 0.045 + Math.min(0.03, f.t * 0.0006);
      } else if (f.phase === 'rest') {
        f.mesh.position.y = app.terrain.heightAt(p.x, p.z) + 0.08;
        // the tide may come in and lift it off the beach
        if (app.sim.heightAt(p.x, p.z) > f.mesh.position.y + 0.04) {
          f.phase = 'float';
          p.y = f.mesh.position.y;
        }
      }
      // fade out after a while (sinks below the surface / dissolves into the sand)
      if (f.t > f.life && f.phase !== 'fade') f.phase = 'fade';
      if (f.phase === 'fade') {
        const s = f.mesh.scale.x - dt * 0.4;
        f.mesh.position.y -= dt * 0.15;
        if (s <= 0.02) {
          this.group.remove(f.mesh);
          this.falling.splice(i, 1);
          continue;
        }
        f.mesh.scale.setScalar(s);
      }
      // stray far away: clean up
      if (Math.abs(p.x) > 32 || p.y < -20) {
        this.group.remove(f.mesh);
        this.falling.splice(i, 1);
      }
    }
  }

  /** Removes all fallen coconuts (world reset). Trees keep their timers. */
  clearFallen() {
    for (const f of this.falling) this.group.remove(f.mesh);
    this.falling.length = 0;
    this.queue.length = 0;
  }

  get fallenCount() {
    return this.falling.length;
  }
  slotWorld(tree: number, slot: number, out = this.tmp) {
    const m = this.trees[tree].slots[slot];
    m.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(m.matrixWorld);
  }
}

export function formatDuration(ms: number) {
  const m = Math.ceil(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}
