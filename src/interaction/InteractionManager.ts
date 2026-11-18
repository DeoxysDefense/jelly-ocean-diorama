import * as THREE from 'three';
import { CONFIG, depthToZ, zClamp } from '../config';
import { clamp, lerp, rand } from '../util/math';
import type { App } from '../core/App';
import { GroundMarker } from './GroundMarker';
import type { PlaceType } from '../world/Reef';

/** Footprint radius used to validate placement of new objects. */
const PLACE_RADIUS: Record<PlaceType, number> = { anemone: 0.85, cave: 1.6, shell: 0.45, branching: 0.95, brain: 0.8, fan: 0.7, seagrass: 0.5, rock: 0.65 };

interface WaterHit {
  x: number;
  z: number;
  /** Signed vertical distance of the pointer from the surface (Front View), 0 on the top face. */
  dy: number;
  onTop: boolean;
  overWater: boolean;
}

/**
 * Routes pointer input to the active tool, in either camera view.
 *
 * Pointer → world mapping (the core of the 3D upgrade):
 *  - Top View: the pointer ray is intersected with the real geometry — seabed heightfield,
 *    water plane, or a mid-water plane — so a click picks an exact (x, z).
 *  - Front View: depth is ambiguous from a side view, so tools use the Depth control: the ray
 *    is intersected with the plane z = depth (mouse wheel adjusts it), and a ring on the
 *    seabed shows where along the depth the brush acts.
 * Rules: only canvas events reach the scene (the UI panel never does); pointer capture is
 * released on up / cancel / blur, so no operation can get stuck.
 *
 * Input priority (V3): 1. UI controls (DOM, never reach the canvas) → 2. an active mini game
 * (captures every press / drag / wheel) → 3. Magnifier pin, Ocean Mail bottle, coconuts / palms
 * → 4. the current tool → 5. ambient hover. One press is routed to exactly one layer.
 */
export class InteractionManager {
  private ndc = new THREE.Vector2(9, 9);
  private inside = false;
  private down = false;
  private downTime = 0;
  private lastPx = new THREE.Vector2();
  private movedPx = 0;
  private pointerId = -1;
  private hoverWorld = new THREE.Vector3();
  private prevHover = new THREE.Vector3();
  private hoverVel = 0;
  private hoverValid = false;
  private grabbing = false;
  private grab = { x: 0, z: 0, startY: 0, target: 0 };
  private editOp: { before: Float32Array; changed: boolean; label: string } | null = null;
  private sandAcc = 0;
  private bubbleAcc = 0;
  private notifyT = 0;
  private currentPrev: THREE.Vector3 | null = null;
  private currentT = 0;
  private dragZ = 0;
  private pokedOnDown = false;
  readonly brush: GroundMarker;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private lastHoverNotify = 0;
  private rippleT = 0;
  private inspectT = 0;
  private prevWater: THREE.Vector3 | null = null;
  /** Which layer owns the current press. */
  private captured: 'none' | 'game' | 'feature' = 'none';
  private hoverPointer = false;
  private clientPx = new THREE.Vector2();

  /** True while a world-editing stroke is in progress (surprises / mail wait). */
  get editing() {
    const t = this.app.tools.tool;
    return this.down && (t === 'sand' || t === 'place' || t === 'select' || t === 'current' || t === 'bubbles');
  }

  constructor(private app: App, private el: HTMLElement) {
    this.brush = new GroundMarker(app.terrain, 0xffe6b0);
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', this.onCancel);
  }

  // ------------------------------------------------------------------ helpers
  private get top() {
    return this.app.cam.isTop;
  }
  private depthZ() {
    return depthToZ(this.app.tools.brush.depth);
  }
  brushRadius() {
    return lerp(CONFIG.sand.brushMin, CONFIG.sand.brushMax, this.app.tools.brush.size);
  }
  private islandRadius() {
    return lerp(1.5, 4.2, this.app.tools.brush.size);
  }

  /** Seabed point under the brush (Top: real raycast; Front: column at the depth plane). */
  seabedPoint(out = this.tmp): THREE.Vector3 | null {
    const app = this.app;
    if (this.top) return app.terrain.raycast(app.cam.ray(this.ndc.x, this.ndc.y), out);
    const z = this.depthZ();
    const p = app.cam.onPlaneZ(this.ndc.x, this.ndc.y, z, out);
    if (p.x < CONFIG.world.xMin + 1 || p.x > CONFIG.world.xMax - 1) return null;
    return p.set(p.x, app.terrain.heightAt(p.x, z), z);
  }

  /** A point inside the water volume under the pointer (Current Brush, creature hover). */
  waterPoint(out = this.tmp2): THREE.Vector3 | null {
    const app = this.app;
    let p: THREE.Vector3 | null;
    if (this.top) p = app.cam.onPlaneY(this.ndc.x, this.ndc.y, app.sim.level - 2.6, out);
    else p = app.cam.onPlaneZ(this.ndc.x, this.ndc.y, this.depthZ(), out);
    if (!p) return null;
    if (p.z < CONFIG.world.zBack || p.z > CONFIG.world.zFront) return null;
    const ground = app.terrain.heightAt(p.x, p.z);
    const surf = app.sim.heightAt(p.x, p.z);
    if (ground > surf - 0.3) return null; // land
    if (!this.top && (p.y > surf + 0.6 || p.y < ground - 0.6)) return null;
    p.y = clamp(p.y, ground + 0.25, surf - 0.15);
    return p;
  }

  /** Water surface point under the pointer. */
  private waterHit(): WaterHit {
    const cam = this.app.cam;
    const W = CONFIG.world;
    const level = this.app.sim.level;
    const top = cam.onPlaneY(this.ndc.x, this.ndc.y, level);
    let x: number, z: number, dy: number, onTop: boolean;
    if (top && top.z <= W.zFront - 0.05 && top.z >= W.zBack + 0.05) {
      x = top.x;
      z = top.z;
      dy = 0;
      onTop = true;
    } else if (this.top) {
      return { x: 0, z: 0, dy: 99, onTop: false, overWater: false };
    } else {
      const front = cam.onPlaneZ(this.ndc.x, this.ndc.y, W.zFront, this.tmp);
      x = front.x;
      z = W.zFront - 0.45;
      dy = front.y - this.app.sim.heightAt(x, z);
      onTop = false;
    }
    const ground = this.app.terrain.heightAt(x, z);
    return { x, z, dy, onTop, overWater: ground < level - 0.05 };
  }

  private frontY() {
    return this.app.cam.onPlaneZ(this.ndc.x, this.ndc.y, CONFIG.world.zFront, this.tmp).y;
  }

  // ------------------------------------------------------------------ events
  private setNdc(e: PointerEvent | WheelEvent) {
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.lastPx.set(e.clientX, e.clientY);
    this.clientPx.set(e.clientX, e.clientY);
    this.app.magnifier?.pointer(this.ndc, true);
  }

  private onWheel = (e: WheelEvent) => {
    const app = this.app;
    if (app.tools.mode !== 'play') return;
    e.preventDefault();
    if (app.games.active) {
      app.games.active.wheel(e.deltaY);
      return;
    }
    const step = Math.sign(e.deltaY) * 0.05;
    if (app.selection.dragging && !this.top) {
      // Front View: the wheel pushes the dragged object deeper / closer
      this.dragZ = clamp(this.dragZ - step * 12 * 0.5, CONFIG.world.zBack + 0.5, CONFIG.world.zFront - 0.5);
      return;
    }
    if (e.shiftKey || this.top) app.tools.setBrush({ size: app.tools.brush.size - step });
    else app.tools.setBrush({ depth: app.tools.brush.depth + step });
  };

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.setNdc(e);
    this.inside = true;
    this.down = true;
    this.downTime = performance.now();
    this.movedPx = 0;
    this.pointerId = e.pointerId;
    this.pokedOnDown = false;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const app = this.app;
    const tools = app.tools;
    this.captured = 'none';
    // 2. mini game owns the pointer
    if (app.games.active && tools.mode === 'play') {
      this.captured = 'game';
      app.games.active.pointerDown(this.ndc, this.clientPx);
      return;
    }
    // 3. magnifier pin, drifting bottle, coconuts / palms
    if (tools.mode === 'play' && tools.tool === 'magnify') {
      this.captured = 'feature';
      app.magnifier.togglePin();
      return;
    }
    if (tools.mode === 'ambient' || tools.tool === 'default') {
      const rc = app.cam.raycaster3(this.ndc.x, this.ndc.y);
      if (app.mail.tryClick(rc) || app.coconuts.tryClick(rc)) {
        this.captured = 'feature';
        return;
      }
    }
    if (tools.mode === 'ambient') {
      const h = this.waterHit();
      if (h.overWater && h.dy < 0.5) {
        app.sim.disturb(h.x, h.z, -CONFIG.water.clickImpulse * 0.5, 0.45);
        app.creatures.ripple(h.x, h.z, 0.5);
      }
      return;
    }
    switch (tools.tool) {
      case 'default': {
        // creatures first (Creature Interaction), then the water surface
        const pick = app.creatures.pick(app.cam.raycaster3(this.ndc.x, this.ndc.y));
        const h = this.waterHit();
        const nearSurface = h.overWater && (h.onTop || (h.dy < 1.0 && h.dy > -1.6));
        if (pick && !(nearSurface && !this.top)) {
          app.creatures.poke(pick);
          app.bubbles.emit(pick.point.x, pick.point.y, pick.point.z, 3, 0.1, 0.6);
          this.pokedOnDown = true;
          break;
        }
        if (nearSurface) {
          this.grabbing = true;
          this.grab.x = h.x;
          this.grab.z = h.z;
          this.grab.startY = this.frontY();
          this.grab.target = app.sim.simHeight(h.x, h.z);
        }
        break;
      }
      case 'feed': {
        let x: number, z: number;
        if (this.top) {
          const p = app.cam.onPlaneY(this.ndc.x, this.ndc.y, app.sim.level, this.tmp);
          if (!p) break;
          x = p.x;
          z = p.z;
        } else {
          z = this.depthZ();
          x = app.cam.onPlaneZ(this.ndc.x, this.ndc.y, z, this.tmp).x;
        }
        if (z < CONFIG.world.zBack + 0.3 || z > CONFIG.world.zFront - 0.3) break;
        const surf = app.sim.heightAt(x, z);
        if (app.terrain.heightAt(x, z) > surf - 0.1) {
          app.ui?.toast('Drop food over the water');
          break;
        }
        const n = Math.round(3 + tools.brush.amount * 13);
        app.creatures.food.spawn(x, z, surf + 1.3, n);
        break;
      }
      case 'current':
        this.currentPrev = null;
        this.currentT = 0;
        break;
      case 'bubbles':
        this.bubbleAcc = 1;
        break;
      case 'sand': {
        if (tools.sandMode === 'island') {
          const p = this.seabedPoint();
          if (!p) break;
          const before = app.terrain.snapshot();
          const added = app.terrain.stampIsland(p.x, p.z, this.islandRadius());
          if (added > 0) {
            app.history.push({ kind: 'sediment', label: 'Island stamp', before });
            for (let i = 0; i < 24; i++) {
              const a = rand(0, Math.PI * 2),
                r = rand(0.5, this.islandRadius());
              const x = p.x + Math.cos(a) * r,
                z = p.z + Math.sin(a) * r;
              app.sediment.emitDust(x, app.terrain.heightAt(x, z), z, 2, 0.8);
            }
            app.bubbles.emit(p.x, -2, p.z, 14, 1.2);
            app.sim.disturb(p.x, zClamp(p.z, 0.5), -1.4, 1.6);
            app.creatures.seabedDisturbance(p.x, p.z, 1.6);
            app.ui?.toast('New sand bar — shape it with Add, Smooth or Erase');
          } else app.ui?.toast('Already land here');
          break;
        }
        this.editOp = {
          before: app.terrain.snapshot(),
          changed: false,
          label: { add: 'Add sand', remove: 'Erase sand', smooth: 'Smooth sand', island: 'Island' }[tools.sandMode],
        };
        this.sandAcc = 0;
        break;
      }
      case 'place': {
        const p = this.seabedPoint();
        const type = tools.placeType;
        if (!p || !app.selection.canPlace(p.x, p.z, PLACE_RADIUS[type], app.cam.visibleX(0))) {
          app.ui?.toast("Can't place there — pick open, flat seabed under water");
          break;
        }
        const sel = app.reef.createObject(type, p.x, p.z);
        app.history.push({ kind: 'add', label: `Place ${sel.label}`, sel });
        app.sediment.emitDust(p.x, p.y, p.z, 12, 0.6);
        app.bubbles.emit(p.x, p.y + 0.3, p.z, 5, 0.3);
        app.creatures.seabedDisturbance(p.x, p.z, 0.6);
        break;
      }
      case 'select': {
        const sel = app.selection.pick(app.cam.raycaster3(this.ndc.x, this.ndc.y));
        if (sel && tools.objectMode === 'remove') {
          app.selection.setHover(null);
          app.reef.detach(sel);
          app.history.push({ kind: 'remove', label: `Remove ${sel.label}`, sel });
          const o = sel.object.position;
          app.sediment.emitDust(o.x, o.y, o.z, 12, 0.6);
          app.creatures.seabedDisturbance(o.x, o.z, 0.8);
          break;
        }
        if (sel) {
          app.selection.begin(sel);
          this.dragZ = sel.object.position.z;
          this.el.style.cursor = 'grabbing';
        }
        break;
      }
    }
  };

  private onMove = (e: PointerEvent) => {
    const prev = this.lastPx.clone();
    this.setNdc(e);
    this.inside = true;
    if (this.down) this.movedPx += prev.distanceTo(this.lastPx);
    if (this.captured === 'game' || (this.app.games.active && !this.down)) this.app.games.active?.pointerMove(this.ndc, this.clientPx);
  };

  private onUp = (e: PointerEvent) => {
    if (!this.down || (this.pointerId !== -1 && e.pointerId !== this.pointerId)) return;
    this.setNdc(e);
    this.release(true);
  };

  private onCancel = () => {
    if (this.down) this.release(false);
  };

  private onLeave = () => {
    if (!this.down) {
      this.inside = false;
      this.hoverValid = false;
      this.app.magnifier.pointer(this.ndc, false);
    }
  };

  /** Ends every pointer-held operation. */
  private release(isUp: boolean) {
    const app = this.app;
    const held = performance.now() - this.downTime;
    const isClick = isUp && held < 320 && this.movedPx < 8;
    if (this.captured !== 'none') {
      if (this.captured === 'game' && isUp) app.games.active?.pointerUp(this.ndc, this.clientPx);
      this.captured = 'none';
      this.down = false;
      try {
        if (this.pointerId !== -1) this.el.releasePointerCapture(this.pointerId);
      } catch {
        /* ignore */
      }
      this.pointerId = -1;
      return;
    }
    if (this.grabbing) {
      this.grabbing = false;
      if (isClick) {
        app.sim.disturb(this.grab.x, this.grab.z, -CONFIG.water.clickImpulse, 0.5);
        app.creatures.ripple(this.grab.x, this.grab.z, 1);
        app.bubbles.emit(this.grab.x, app.sim.heightAt(this.grab.x, this.grab.z) - 0.2, this.grab.z, 6, 0.25);
      }
    } else if (isClick && !this.pokedOnDown && app.tools.mode === 'play' && app.tools.tool === 'default') {
      const h = this.waterHit();
      if (h.overWater) {
        app.sim.disturb(h.x, h.z, -CONFIG.water.clickImpulse * 0.6, 0.5);
        app.creatures.ripple(h.x, h.z, 0.6);
      }
    }
    if (this.editOp) {
      if (this.editOp.changed) app.history.push({ kind: 'sediment', label: this.editOp.label, before: this.editOp.before });
      this.editOp = null;
    }
    this.currentPrev = null;
    if (app.selection.dragging) {
      const rec = app.selection.end(app.cam.visibleX(0));
      if (rec) {
        app.history.push({ kind: 'move', label: `Move ${rec.sel.label}`, object: rec.sel.object, from: rec.from, to: rec.to, rotFrom: rec.rotFrom, rotTo: rec.rotTo });
        app.sediment.emitDust(rec.to.x, rec.to.y, rec.to.z, 14, 0.5);
        app.creatures.seabedDisturbance(rec.to.x, rec.to.z, 1);
      } else app.ui?.toast("Can't place there — returned to its spot");
      this.el.style.cursor = '';
    }
    this.down = false;
    try {
      if (this.pointerId !== -1) this.el.releasePointerCapture(this.pointerId);
    } catch {
      /* ignore */
    }
    this.pointerId = -1;
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number, time: number) {
    const app = this.app;
    const tools = app.tools;
    const ambient = tools.mode === 'ambient';

    // ---- hover over the water surface (all tools; gentler outside the Water tool)
    if (this.inside && !app.cam.transitioning) {
      const h = this.waterHit();
      const hoverK = ambient ? 0.45 : tools.tool === 'default' ? 1 : 0.35;
      if (h.overWater && h.dy < 1.1 && h.dy > -1.6) {
        this.hoverWorld.set(h.x, 0, h.z);
        if (this.hoverValid) {
          const d = this.hoverWorld.distanceTo(this.prevHover);
          this.hoverVel += (d / Math.max(dt, 1e-3) - this.hoverVel) * Math.min(1, dt * 10);
        }
        this.prevHover.copy(this.hoverWorld);
        this.hoverValid = true;
        const prox = 1 - Math.min(1, Math.abs(h.dy) / 1.4);
        if (!this.grabbing) {
          const lift = (h.onTop ? 0.1 : h.dy > 0 ? 0.24 : -0.08) * prox * hoverK * CONFIG.water.hoverStrength;
          app.sim.pull(h.x, h.z, lift, 6 * hoverK, 0.6, dt);
          const sp = Math.min(this.hoverVel, 25);
          if (sp > 0.5) app.sim.disturb(h.x, h.z, -sp * 0.0054 * prox * hoverK * dt * 60, 0.45);
          // micro ripples trail a sweeping pointer
          this.rippleT -= dt;
          if (sp > 1.2 && this.rippleT <= 0 && prox > 0.25) {
            this.rippleT = 0.07;
            app.sim.addRipple(h.x, h.z, Math.min(0.05, sp * 0.004) * prox * (0.5 + hoverK * 0.5));
          }
        }
        if (time - this.lastHoverNotify > 0.15 && prox > 0.3) {
          this.lastHoverNotify = time;
          app.creatures.surfaceHover(this.tmp.set(h.x, app.sim.heightAt(h.x, h.z) - 0.3, h.z));
        }
      } else this.hoverValid = false;
      const wp = this.waterPoint();
      if (wp) {
        if (!ambient && !app.games.active && (tools.tool === 'default' || tools.tool === 'current')) app.creatures.hoverAt(wp);
        // night: sweeping through the water stirs glowing plankton
        if (this.prevWater) {
          const mv = wp.distanceTo(this.prevWater) / Math.max(dt, 1e-3);
          if (mv > 0.6) app.plankton.excite(wp.x, wp.y, wp.z, this.top ? 0.9 : 0.6, Math.min(1, mv * 0.08));
        }
        (this.prevWater ??= new THREE.Vector3()).copy(wp);
      } else this.prevWater = null;
    }

    if (ambient) {
      this.el.style.cursor = '';
      this.brush.hide();
      this.brush.update(dt, time);
      return;
    }

    // a mini game owns the scene: no tool brushes, no creature inspector (no spoilers)
    if (app.games.active) {
      this.el.style.cursor = this.down ? 'grabbing' : 'crosshair';
      this.brush.hide();
      this.brush.update(dt, time);
      app.ui?.hideTip();
      app.selection.setHover(null);
      return;
    }

    // ---- water drag (Front: lift / press by vertical motion; Top: press and plough)
    if (this.grabbing) {
      const maxH = CONFIG.water.maxDragHeight;
      if (this.top) {
        const p = app.cam.onPlaneY(this.ndc.x, this.ndc.y, app.sim.level, this.tmp);
        if (p) {
          this.grab.x += (p.x - this.grab.x) * Math.min(1, dt * 10);
          this.grab.z += (zClamp(p.z, 0.4) - this.grab.z) * Math.min(1, dt * 10);
        }
        this.grab.target += (-maxH * 0.6 - this.grab.target) * Math.min(1, dt * 8);
      } else {
        const fy = this.frontY();
        const fx = this.tmp.x;
        const target = clamp((fy - this.grab.startY) * 0.75, -maxH, maxH);
        this.grab.target += (target - this.grab.target) * Math.min(1, dt * 10);
        this.grab.x += (fx - this.grab.x) * Math.min(1, dt * 8);
      }
      app.sim.pull(this.grab.x, this.grab.z, this.grab.target, CONFIG.water.dragStiffness, CONFIG.water.dragRadius, dt);
    }

    // ---- hover inspector: what is this creature doing?
    this.inspectT -= dt;
    if (this.inspectT <= 0) {
      this.inspectT = 0.15;
      let text = '';
      if (this.inside && !this.down && tools.tool !== 'select' && tools.tool !== 'place') {
        const r = app.creatures.pick(app.cam.raycaster3(this.ndc.x, this.ndc.y));
        if (r) text = app.creatures.describe(r);
      }
      if (text) app.ui?.showTip(text, this.lastPx.x, this.lastPx.y);
      else app.ui?.hideTip();
      // something clickable under the pointer (bottle, coconut, palm)?
      this.hoverPointer = false;
      if (this.inside && !this.down && tools.tool === 'default') {
        const rc = app.cam.raycaster3(this.ndc.x, this.ndc.y);
        this.hoverPointer = app.mail.hover(rc) || app.coconuts.hoverTarget(rc);
      }
    }

    const brushTools = tools.tool === 'sand' || tools.tool === 'bubbles' || tools.tool === 'feed' || tools.tool === 'current' || tools.tool === 'place';
    let markerShown = false;
    const amount = tools.brush.amount;

    // ---- sand brushes
    if (tools.tool === 'sand' && this.inside) {
      const R = tools.sandMode === 'island' ? this.islandRadius() : this.brushRadius();
      const p = this.seabedPoint();
      if (p) {
        this.brush.setColor(tools.sandMode === 'remove' ? 0xffb0a0 : tools.sandMode === 'island' ? 0xfff0a8 : tools.sandMode === 'smooth' ? 0xc8f0ff : 0xffe6b0);
        this.brush.show(p.x, p.z, R, R);
        markerShown = true;
        if (this.editOp && this.down) this.applySand(p, R, amount, dt);
      }
    }

    // ---- bubbles: hold on the seabed for a rising stream
    if (tools.tool === 'bubbles' && this.inside) {
      const p = this.seabedPoint();
      if (p) {
        this.brush.setColor(0xc8f6ff);
        this.brush.show(p.x, p.z, 0.35, 0.35);
        markerShown = true;
        if (this.down && app.terrain.heightAt(p.x, p.z) < app.sim.heightAt(p.x, p.z) - 0.4) {
          this.bubbleAcc += dt * (8 + amount * 40);
          const n = Math.floor(this.bubbleAcc);
          if (n > 0) {
            this.bubbleAcc -= n;
            app.bubbles.emit(p.x, p.y + 0.1, p.z, n, 0.08 + tools.brush.size * 0.3, 0.8 + amount * 0.8);
          }
        }
      }
    }

    // ---- current brush: drag through the water to paint a local flow
    if (tools.tool === 'current' && this.inside) {
      const wp = this.waterPoint();
      if (wp) {
        const R = lerp(0.9, 2.8, tools.brush.size);
        if (!this.top) {
          this.brush.setColor(0xa8e8ff);
          this.brush.show(wp.x, wp.z, R * 0.5, R * 0.5);
          markerShown = true;
        }
        if (this.down) {
          this.currentT += dt;
          if (!this.currentPrev) this.currentPrev = wp.clone();
          const d = wp.clone().sub(this.currentPrev);
          if (d.length() > 0.18 || this.currentT > 0.12) {
            if (d.length() > 0.02) {
              const v = d.divideScalar(Math.max(this.currentT, 1 / 60)).multiplyScalar(0.5 + amount * 0.9);
              app.flow.add(wp, v, R, this.top ? 2.0 : 1.0);
              app.streaks.spawn(wp, R * 0.5, 4);
              if (Math.random() < 0.6) app.bubbles.emit(wp.x, wp.y, wp.z, 2, R * 0.35, 0.8);
              if (wp.y > -1.2) app.sim.disturb(wp.x, zClamp(wp.z, 0.4), -v.length() * 0.03, 0.5);
              this.notifyT -= this.currentT;
              if (this.notifyT <= 0 && v.length() > 1.5) {
                this.notifyT = 0.6;
                app.creatures.currentDisturbance(wp, R);
              }
            }
            this.currentPrev.copy(wp);
            this.currentT = 0;
          }
        }
      }
    }

    // ---- place: footprint preview (green = valid, red = not)
    if (tools.tool === 'place' && this.inside) {
      const p = this.seabedPoint();
      if (p) {
        const r = PLACE_RADIUS[tools.placeType];
        this.brush.setColor(app.selection.canPlace(p.x, p.z, r, app.cam.visibleX(0)) ? 0xb8ffd8 : 0xff9a9a);
        this.brush.show(p.x, p.z, r * 0.75, r * 0.75);
        markerShown = true;
      }
    }

    // ---- feed: in Front View show where along the depth the food will drop
    if (tools.tool === 'feed' && this.inside && !this.top) {
      const p = this.seabedPoint();
      if (p) {
        this.brush.setColor(0xffd9a0);
        this.brush.show(p.x, p.z, 0.6, 0.6);
        markerShown = true;
      }
    }
    if (!brushTools || !markerShown) this.brush.hide();

    // ---- select
    if (tools.tool === 'select') {
      const sel = app.selection;
      if (sel.dragging) {
        const o = sel.dragging.object;
        let tx = o.position.x,
          tz = this.dragZ;
        if (this.top) {
          const p = app.cam.onPlaneY(this.ndc.x, this.ndc.y, o.position.y, this.tmp);
          if (p) {
            tx = p.x;
            tz = p.z;
          }
        } else tx = app.cam.onPlaneZ(this.ndc.x, this.ndc.y, o.position.z, this.tmp).x;
        sel.dragTo(tx, tz, app.cam.visibleX(0), dt);
        if (Math.random() < dt * 6) app.sediment.emitDust(o.position.x, o.position.y - 0.3, o.position.z, 1, 0.4);
        if (Math.random() < dt * 4) app.bubbles.emit(o.position.x, o.position.y, o.position.z, 1, 0.2, 0.7);
        this.notifyT -= dt;
        if (this.notifyT <= 0) {
          this.notifyT = 0.5;
          app.creatures.seabedDisturbance(o.position.x, o.position.z, 1);
        }
      } else if (this.inside && !this.down) {
        const h = sel.pick(app.cam.raycaster3(this.ndc.x, this.ndc.y));
        sel.setHover(h);
        this.el.style.cursor = h ? (tools.objectMode === 'remove' ? 'not-allowed' : 'grab') : '';
      }
    } else {
      app.selection.setHover(null);
      this.el.style.cursor =
        tools.tool === 'feed' ? 'copy' : tools.tool === 'default' ? (this.hoverPointer ? 'pointer' : '') : tools.tool === 'magnify' ? 'zoom-in' : tools.tool === 'place' ? 'cell' : 'crosshair';
    }
    this.brush.update(dt, time);
  }

  private applySand(p: THREE.Vector3, R: number, amount: number, dt: number) {
    const app = this.app;
    const op = this.editOp!;
    const mode = app.tools.sandMode;
    if (mode === 'add') {
      this.sandAcc += CONFIG.sand.maxSpawnRate * (0.06 + 0.94 * amount * amount) * dt;
      const n = Math.floor(this.sandAcc);
      if (n <= 0) return;
      this.sandAcc -= n;
      const surf = app.sim.heightAt(p.x, p.z);
      let y: number;
      if (this.top) y = Math.min(surf - 0.2, p.y + 2.6);
      else {
        // Front View: pour from the pointer height on the depth plane
        const fp = app.cam.onPlaneZ(this.ndc.x, this.ndc.y, p.z, this.tmp2);
        y = Math.max(p.y + 0.15, Math.min(fp.y, surf + 3.5));
      }
      const spread = R * 0.55;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2,
          r = Math.sqrt(Math.random()) * spread;
        app.sediment.emitSand(p.x + Math.cos(a) * r, y + rand(-0.05, 0.05), zClamp(p.z + Math.sin(a) * r, 0.2), 1);
      }
      op.changed = true;
    } else if (mode === 'remove') {
      const removed = app.terrain.removeSediment(p.x, p.z, R, R, CONFIG.sand.removeRate * (0.25 + amount) * dt);
      if (removed > 0) {
        op.changed = true;
        app.sediment.emitDust(p.x, p.y, p.z, Math.min(8, 1 + Math.floor(removed * 300)), 1.2);
        if (Math.random() < 0.3) app.bubbles.emit(p.x, p.y + 0.1, p.z, 1, 0.2, 0.6);
        this.notifyT -= dt;
        if (this.notifyT <= 0) {
          this.notifyT = 0.4;
          app.creatures.seabedDisturbance(p.x, p.z, 0.8);
        }
      }
    } else if (mode === 'smooth') {
      const changed = app.terrain.smoothSediment(p.x, p.z, R, Math.min(1, dt * (2 + amount * 10)));
      if (changed > 1e-4) {
        op.changed = true;
        if (Math.random() < dt * 10) app.sediment.emitDust(p.x + rand(-R, R) * 0.5, p.y, p.z + rand(-R, R) * 0.5, 1, 0.5);
      }
    }
  }

  /** Called on tool switch: abort anything in progress cleanly. */
  cancelAll() {
    if (this.down) this.release(false);
    this.grabbing = false;
    this.brush.hide();
  }
}
