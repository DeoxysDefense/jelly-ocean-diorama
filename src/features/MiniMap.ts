import { CONFIG } from '../config';
import type { App } from '../core/App';
import type { ViewMode } from '../core/CameraManager';
import type { StringKey } from './i18n';

const ICON = {
  full: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="8" width="19" height="9" rx="2.5"/><path d="M6 8c1.5-2 3-2 4.5 0M13 8c1.2-3 3.5-3 5 0"/><path d="M4 20h16"/></svg>',
  focus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><path d="M8 14c1.5-2.5 3-2.5 4 0 1-1.6 2.6-1.6 4 0"/></svg>',
  top: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="9" cy="10" r="2.4"/><path d="M14 15.5c1-1.4 2.6-1.6 3.6-.6"/></svg>',
  drift: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c3-3 6-3 9 0s6 3 9 0"/><path d="M17 7l3 2-3 2M7 13l-3 2 3 2"/></svg>',
  map: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
};

/**
 * V2 (P1) navigation dock (bottom-left, Play mode only): the three view buttons, slow drift,
 * and a small top-down map of the archipelago with the current frame. Clicking / dragging on
 * the map moves the camera there. It is quiet by design: no markers, no counters, nothing that
 * asks to be checked — just where the islands are and where you are looking.
 */
export class MiniMap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private W = 232;
  private H: number;
  private dpr = 1;
  private terrainVersion = -1;
  private level = 99;
  private redrawT = 0;
  private overlayKey = '';
  private dragging = false;
  private root!: HTMLElement;

  constructor(private app: App, root: HTMLElement) {
    const Wd = CONFIG.world;
    this.H = Math.round((this.W * (Wd.zFront - Wd.zBack)) / (Wd.xMax - Wd.xMin));
    this.el = document.createElement('div');
    this.el.className = 'nav-dock';
    // the view buttons and toggles live in the studio's top bar; the map stays bottom-left
    const views = `
        <button data-nav-view="full">${ICON.full}<span></span></button>
        <button data-nav-view="focus">${ICON.focus}<span></span></button>
        <button data-nav-view="top">${ICON.top}<span></span></button>`;
    const toggles = `
        <button class="nav-toggle" data-nav="drift">${ICON.drift}</button>
        <button class="nav-toggle" data-nav="map">${ICON.map}</button>
        <button class="nav-toggle" data-nav="sound"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path class="snd-wave" d="M15.5 9a4 4 0 0 1 0 6"/><path class="snd-wave" d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg></button>
        <button class="nav-toggle" data-nav="journal"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5C6.5 4 9.5 4 12 5.5 14.5 4 17.5 4 20 5.5V19c-2.5-1.5-5.5-1.5-8 0-2.5-1.5-5.5-1.5-8 0z"/><path d="M12 5.5V19"/></svg></button>`;
    const vSlot = root.querySelector<HTMLElement>('[data-slot="views"]');
    const tSlot = root.querySelector<HTMLElement>('[data-slot="toggles"]');
    if (vSlot && tSlot) {
      vSlot.innerHTML = `<div class="nav-views" role="group">${views}</div>`;
      tSlot.innerHTML = `<div class="nav-views bare" role="group">${toggles}</div>`;
      this.el.innerHTML = '<canvas class="minimap"></canvas>';
    } else this.el.innerHTML = `<div class="nav-views" role="group">${views}<i class="nav-sep"></i>${toggles}</div><canvas class="minimap"></canvas>`;
    this.root = root;
    root.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.base = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.sizeCanvases();

    root.querySelectorAll<HTMLButtonElement>('[data-nav-view]').forEach((b) =>
      b.addEventListener('click', () => {
        app.cam.setView(b.dataset.navView as ViewMode);
        b.blur();
      }),
    );
    this.root.querySelector<HTMLButtonElement>('[data-nav="drift"]')!.addEventListener('click', (e) => {
      app.nav.setDrift(!app.nav.drift);
      (e.currentTarget as HTMLElement).blur();
      this.refresh();
    });
    this.root.querySelector<HTMLButtonElement>('[data-nav="map"]')!.addEventListener('click', (e) => {
      app.nav.setMinimap(!app.nav.minimap);
      (e.currentTarget as HTMLElement).blur();
      this.refresh();
    });
    this.root.querySelector<HTMLButtonElement>('[data-nav="sound"]')!.addEventListener('click', (e) => {
      app.sound.setOn(!app.sound.on);
      (e.currentTarget as HTMLElement).blur();
      this.refresh();
      app.featureUI?.refresh();
    });
    this.root.querySelector<HTMLButtonElement>('[data-nav="journal"]')!.addEventListener('click', (e) => {
      app.journal?.toggle();
      (e.currentTarget as HTMLElement).blur();
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.jump(e, true);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.jump(e, false);
    });
    const end = () => (this.dragging = false);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    app.i18n.onChange(() => this.refresh());
    app.tools.onChange(() => this.refresh());
    app.cam.onChange(() => this.refresh());
    window.addEventListener('resize', () => this.sizeCanvases());
    this.refresh();
  }

  private t(k: StringKey) {
    return this.app.i18n.t(k);
  }

  private sizeCanvases() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.canvas, this.base]) {
      c.width = Math.round(this.W * this.dpr);
      c.height = Math.round(this.H * this.dpr);
    }
    this.canvas.style.width = `${this.W}px`;
    this.canvas.style.height = `${this.H}px`;
    this.terrainVersion = -1;
  }

  /** Labels, tooltips, active states and visibility. */
  refresh() {
    const app = this.app;
    const views: [ViewMode, StringKey, StringKey][] = [
      ['full', 'view.full', 'view.fullTip'],
      ['focus', 'view.focus', 'view.focusTip'],
      ['top', 'view.top', 'view.topTip'],
    ];
    for (const [v, label, tip] of views) {
      const b = this.root.querySelector<HTMLButtonElement>(`[data-nav-view="${v}"]`)!;
      b.querySelector('span')!.textContent = this.t(label);
      b.title = this.t(tip);
      b.classList.toggle('active', app.cam.view === v);
    }
    const drift = this.root.querySelector<HTMLButtonElement>('[data-nav="drift"]')!;
    drift.title = this.t('nav.drift');
    drift.classList.toggle('active', app.nav?.drift ?? false);
    this.root.querySelector<HTMLButtonElement>('[data-nav="journal"]')!.title = this.t('journal.open');
    const snd = this.root.querySelector<HTMLButtonElement>('[data-nav="sound"]')!;
    snd.title = this.t('nav.sound');
    snd.classList.toggle('active', app.sound?.on ?? false);
    const map = this.root.querySelector<HTMLButtonElement>('[data-nav="map"]')!;
    map.title = this.t('nav.map');
    const showMap = app.nav?.minimap ?? true;
    map.classList.toggle('active', showMap);
    this.canvas.title = this.t('nav.mapTip');
    this.canvas.style.display = showMap ? '' : 'none';
    this.el.classList.toggle('hidden', app.tools.mode !== 'play');
  }

  private jump(e: PointerEvent, first: boolean) {
    const r = this.canvas.getBoundingClientRect();
    const W = CONFIG.world;
    const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      v = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const x = W.xMin + u * (W.xMax - W.xMin);
    // map: back (zBack) at the top, front glass at the bottom — same as Top View
    const z = W.zBack + v * (W.zFront - W.zBack);
    const cam = this.app.cam;
    if (first || cam.view === 'full') cam.focusOn(x, z);
    else if (cam.view === 'focus') cam.panBy(cam.clampFocus(x) - cam.focusX, 0);
    else cam.panBy(x - cam.topX, z - cam.topZ);
  }

  update(dt: number) {
    const app = this.app;
    if (app.tools.mode !== 'play' || !(app.nav?.minimap ?? true)) return;
    this.redrawT -= dt;
    const lvl = app.sim.level;
    if ((app.terrain.version !== this.terrainVersion || Math.abs(lvl - this.level) > 0.06) && this.redrawT <= 0) {
      this.terrainVersion = app.terrain.version;
      this.level = lvl;
      this.redrawT = 1.2;
      this.drawBase();
      this.overlayKey = '';
    }
    const cam = app.cam;
    const vx = cam.visibleX(0),
      vz = cam.visibleZ();
    const key = `${vx.min.toFixed(2)}|${vx.max.toFixed(2)}|${vz.min.toFixed(2)}|${vz.max.toFixed(2)}|${cam.view}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    this.drawOverlay(vx, vz);
  }

  /** Paints the archipelago once per terrain / tide change (sand, green, rock, water depth). */
  private drawBase() {
    const W = CONFIG.world;
    const w = this.base.width,
      h = this.base.height;
    const g = this.base.getContext('2d')!;
    const img = g.createImageData(w, h);
    const lvl = this.app.sim.level;
    const terrain = this.app.terrain;
    for (let j = 0; j < h; j++) {
      const z = W.zBack + ((j + 0.5) / h) * (W.zFront - W.zBack);
      for (let i = 0; i < w; i++) {
        const x = W.xMin + ((i + 0.5) / w) * (W.xMax - W.xMin);
        const y = terrain.heightAt(x, z);
        let r: number, gg: number, b: number;
        if (y > lvl + 1.3) [r, gg, b] = [92, 138, 74];
        else if (y > lvl - 0.02) [r, gg, b] = [248, 232, 190];
        else {
          const d = Math.min(1, (lvl - y) / 10);
          const s = Math.pow(d, 0.6);
          r = 128 + (14 - 128) * s;
          gg = 226 + (64 - 226) * s;
          b = 222 + (118 - 222) * s;
          if (lvl - y < 0.6) {
            // a pale rim of surf at the shoreline
            const k = 1 - (lvl - y) / 0.6;
            r += (230 - r) * k * 0.6;
            gg += (240 - gg) * k * 0.6;
            b += (236 - b) * k * 0.6;
          }
        }
        const o = (j * w + i) * 4;
        img.data[o] = r;
        img.data[o + 1] = gg;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  private drawOverlay(vx: { min: number; max: number }, vz: { min: number; max: number }) {
    const W = CONFIG.world;
    const c = this.ctx;
    const w = this.canvas.width,
      h = this.canvas.height;
    c.clearRect(0, 0, w, h);
    c.drawImage(this.base, 0, 0);
    const px = (x: number) => ((x - W.xMin) / (W.xMax - W.xMin)) * w;
    const pz = (z: number) => ((z - W.zBack) / (W.zFront - W.zBack)) * h;
    const x0 = px(vx.min),
      x1 = px(vx.max),
      y0 = pz(vz.min),
      y1 = pz(vz.max);
    c.fillStyle = 'rgba(255,255,255,0.14)';
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = 1.5 * this.dpr;
    c.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(1, x1 - x0 - 1), Math.max(1, y1 - y0 - 1));
  }
}
