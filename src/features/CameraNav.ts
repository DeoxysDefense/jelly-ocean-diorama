import * as THREE from 'three';
import { CONFIG } from '../config';
import type { App } from '../core/App';

/**
 * V2 (P1) camera navigation for the three views.
 *
 *  Focus View — right / middle drag or Space + drag pans along x, ← → keys, double-click
 *               centres a spot, optional very slow auto drift.
 *  Full View  — look + normal clicks; double-click glides into Focus View at that spot.
 *  Top View   — wheel zoom (InteractionManager), right / middle / Space drag pans in x–z,
 *               arrow keys, double-click centres.
 *
 * Panning presses are taken in the capture phase on the host element, so they never reach the
 * tools (a pan never also paints sand). Double-click focus only answers the default tool or
 * Ambient mode, so editing strokes are never hijacked.
 */
export class CameraNav {
  /** Very slow automatic drift in Focus View (off by default; wallpaper property too). */
  drift = false;
  /** Show the minimap dock (Play mode only). */
  minimap = true;
  private pan: { id: number; x: number; y: number } | null = null;
  private space = false;
  private keys = new Set<string>();
  /** Seconds since the user last touched the camera or the scene. */
  private idle = 0;
  private driftDir = 1;
  private ray = new THREE.Vector3();

  constructor(private app: App, private host: HTMLElement, saved?: { drift?: boolean; minimap?: boolean }) {
    if (saved) {
      if (typeof saved.drift === 'boolean') this.drift = saved.drift;
      if (typeof saved.minimap === 'boolean') this.minimap = saved.minimap;
    }
    const canvas = app.renderer.domElement;
    host.addEventListener('pointerdown', this.onDown, { capture: true });
    host.addEventListener('pointermove', this.onMove, { capture: true });
    host.addEventListener('pointerup', this.onUp, { capture: true });
    host.addEventListener('pointercancel', this.onUp, { capture: true });
    // stop the browser's middle-click autoscroll
    host.addEventListener('mousedown', (e) => {
      if (e.button === 1 && e.target === canvas) e.preventDefault();
    });
    canvas.addEventListener('dblclick', this.onDblClick);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.space = false;
      this.endPan();
    });
  }

  state() {
    return { drift: this.drift, minimap: this.minimap };
  }
  setDrift(on: boolean) {
    this.drift = on;
    this.idle = 0;
    this.app.saveSettings();
  }
  setMinimap(on: boolean) {
    this.minimap = on;
    this.app.saveSettings();
  }

  get panning() {
    return !!this.pan;
  }

  // ------------------------------------------------------------------ pointer
  private onDown = (e: PointerEvent) => {
    this.idle = 0;
    const app = this.app;
    if (e.target !== app.renderer.domElement) return;
    if (app.games.active) return;
    const view = app.cam.view;
    const wantsPan = e.button === 1 || e.button === 2 || (e.button === 0 && this.space);
    if (!wantsPan || view === 'full') return;
    e.preventDefault();
    e.stopPropagation();
    app.interaction.cancelAll();
    this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try {
      app.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.host.classList.add('panning');
  };

  private onMove = (e: PointerEvent) => {
    if (e.target === this.app.renderer.domElement) this.idle = 0;
    if (!this.pan || e.pointerId !== this.pan.id) return;
    e.stopPropagation();
    const cam = this.app.cam;
    const el = this.app.renderer.domElement;
    const dx = e.clientX - this.pan.x,
      dy = e.clientY - this.pan.y;
    this.pan.x = e.clientX;
    this.pan.y = e.clientY;
    const wx = -(dx / Math.max(1, el.clientWidth)) * cam.viewW;
    // Top View: screen up is −z, so dragging down moves the camera toward −z
    const wz = -(dy / Math.max(1, el.clientHeight)) * cam.viewH;
    cam.panBy(wx, cam.view === 'top' ? wz : 0);
    this.idle = 0;
  };

  private onUp = (e: PointerEvent) => {
    if (!this.pan || e.pointerId !== this.pan.id) return;
    e.stopPropagation();
    this.endPan();
  };

  private endPan() {
    if (!this.pan) return;
    try {
      this.app.renderer.domElement.releasePointerCapture(this.pan.id);
    } catch {
      /* ignore */
    }
    this.pan = null;
    this.host.classList.remove('panning');
  }

  private onDblClick = (e: MouseEvent) => {
    const app = this.app;
    if (app.games.active) return;
    if (app.tools.mode === 'play' && app.tools.tool !== 'default') return;
    const r = app.renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1,
      ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    const p = this.pickXZ(nx, ny);
    if (!p) return;
    app.cam.focusOn(p.x, p.z);
    this.idle = 0;
  };

  /** World (x, z) under a screen point: the water plane, else the vertical mid plane. */
  pickXZ(nx: number, ny: number): { x: number; z: number } | null {
    const app = this.app;
    const W = CONFIG.world;
    const cam = app.cam;
    if (cam.view === 'focus' && !cam.transitioning) {
      const p = cam.onPlaneZ(nx, ny, 0, this.ray);
      return { x: p.x, z: 0 };
    }
    const p = cam.onPlaneY(nx, ny, app.sim.level, this.ray);
    if (p && p.z <= W.zFront + 0.5 && p.z >= W.zBack - 0.5) return { x: p.x, z: p.z };
    const q = cam.onPlaneZ(nx, ny, (W.zFront + W.zBack) / 2, this.ray);
    if (q.x < W.xMin - 2 || q.x > W.xMax + 2) return null;
    return { x: q.x, z: q.z };
  }

  // ------------------------------------------------------------------ keys
  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') {
      // Space only means "hold to pan" when no button has keyboard focus
      if (t && t.tagName === 'BUTTON') return;
      this.space = true;
      e.preventDefault();
      return;
    }
    if (e.key.startsWith('Arrow') && !this.app.games.active) {
      if (t && t.closest && t.closest('.panel')) return; // sliders / panel use their own arrows
      this.keys.add(e.key);
      this.idle = 0;
      e.preventDefault();
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') this.space = false;
    this.keys.delete(e.key);
  };

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    const cam = this.app.cam;
    this.idle += dt;
    if (this.keys.size) {
      const speed = cam.viewW * 0.45 * dt;
      let dx = 0,
        dz = 0;
      if (this.keys.has('ArrowLeft')) dx -= speed;
      if (this.keys.has('ArrowRight')) dx += speed;
      if (this.keys.has('ArrowUp')) dz -= speed;
      if (this.keys.has('ArrowDown')) dz += speed;
      if (cam.view === 'focus') cam.panBy(dx, 0);
      else if (cam.view === 'top') cam.panBy(dx, dz);
      this.idle = 0;
    }
    // very slow drift back and forth across the archipelago when nobody is around
    if (this.drift && cam.view === 'focus' && !cam.transitioning && !this.pan && this.idle > 12 && !this.app.busy) {
      const r = cam.focusRange();
      const edge = Math.min(cam.focusX - r.min, r.max - cam.focusX);
      // ease into the turn near the ends
      const k = Math.min(1, 0.25 + edge / 6);
      const next = cam.focusX + this.driftDir * CONFIG.camera.driftSpeed * k * dt;
      if (next >= r.max - 0.01) this.driftDir = -1;
      else if (next <= r.min + 0.01) this.driftDir = 1;
      cam.focusX = cam.clampFocus(next);
    }
  }
}
