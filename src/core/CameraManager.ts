import * as THREE from 'three';
import { CONFIG, focusPose, zCentre } from '../config';

/**
 * V2 camera states:
 *  - focus: the v1 Front View scale (default, also the wallpaper default). Pans along x.
 *  - full:  the whole tray, like a resin model on a table. Look + normal clicks.
 *  - top:   straight down for editing; wheel zoom and pan in x–z.
 * `front` is accepted as an alias of `focus` (v1 URLs / saves).
 */
export type ViewMode = 'focus' | 'full' | 'top';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const DEG = Math.PI / 180;

/** One camera state: tilt, look-at target, visible height and a screen-space vertical offset. */
export interface Pose {
  tilt: number;
  tx: number;
  ty: number;
  tz: number;
  h: number;
  /** Narrow screens: shift the frame up (v1 behaviour) in screen units. */
  oy: number;
}

const copyPose = (a: Pose, b: Pose) => Object.assign(a, b);

/**
 * One orthographic camera for one shared 3D world. Switching views interpolates a pose
 * (tilt, target, framing) from a snapshot of the current pose to the live goal pose, so pans
 * during a transition still land smoothly and nothing in the scene is rebuilt.
 */
export class CameraManager {
  readonly camera: THREE.OrthographicCamera;
  view: ViewMode = 'focus';
  /** 0 = Focus tilt … 1 = Top (straight down); derived from the current tilt. */
  blend = 0;
  /** 0 … 1 weight of Full View in the current pose (studio backdrop, plinth). */
  fullness = 0;
  /** Focus View pan (world x of the frame centre). */
  focusX = 0;
  private focusGoal: number | null = null;
  /** Top View pan + zoom. */
  topX = 0;
  topZ = zCentre();
  topZoom = 1;
  private topGoal: { x: number; z: number } | null = null;
  private t = 1;
  private from: Pose = { tilt: 0, tx: 0, ty: 0, tz: 0, h: 18, oy: 0 };
  readonly pose: Pose = { tilt: 0, tx: 0, ty: 0, tz: 0, h: 18, oy: 0 };
  private goal: Pose = { tilt: 0, tx: 0, ty: 0, tz: 0, h: 18, oy: 0 };
  private aspect = 16 / 9;
  viewW = 32;
  viewH = 18;
  private raycaster = new THREE.Raycaster();
  private tmpV2 = new THREE.Vector2();
  private listeners: (() => void)[] = [];
  private moveListeners: (() => void)[] = [];
  /** Focus-view frame height (v1 Front View framing). */
  frontH = 18;
  private fp = focusPose();

  constructor() {
    this.camera = new THREE.OrthographicCamera(-16, 16, 9, -9, 1, 160);
    this.goalPose(this.view, this.pose);
    this.apply();
  }

  /** Fires when the view mode changes. */
  onChange(fn: () => void) {
    this.listeners.push(fn);
  }
  /** Fires when the user moves the camera (pan / zoom / focus) — used for persistence. */
  onMove(fn: () => void) {
    this.moveListeners.push(fn);
  }
  private moved() {
    for (const l of this.moveListeners) l();
  }

  setView(v: ViewMode | 'front', instant = false) {
    if (v === 'front') v = 'focus';
    if (v === this.view && this.t >= 1) return;
    copyPose(this.from, this.pose);
    this.view = v;
    this.t = instant ? 1 : 0;
    this.update(0);
    for (const l of this.listeners) l();
  }

  /** V key: Focus ↔ Top (Full returns to Focus). */
  toggle() {
    this.setView(this.view === 'top' ? 'focus' : 'top');
  }

  get isTop() {
    return this.blend > 0.5;
  }
  get transitioning() {
    return this.t < 1;
  }

  // ------------------------------------------------------------------ navigation
  /** Half the visible width of the Focus frame. */
  focusHalfW() {
    return (this.frontH * this.aspect) / 2;
  }
  /** Range the Focus centre may take so the frame never leaves the tray. */
  focusRange() {
    const W = CONFIG.world;
    const m = Math.max(0, W.xMax - this.focusHalfW() - 0.4);
    return { min: -m, max: m };
  }
  clampFocus(x: number) {
    const r = this.focusRange();
    return clamp(x, r.min, r.max);
  }
  /** Top View: visible half extents at the current zoom. */
  private topHalf(zoom = this.topZoom) {
    const c = CONFIG.camera;
    const h = Math.max(c.topDepth, c.topWidth / this.aspect) / zoom;
    return { hw: (h * this.aspect) / 2, hh: h / 2, h };
  }
  clampTop() {
    const W = CONFIG.world;
    const c = CONFIG.camera;
    this.topZoom = clamp(this.topZoom, this.minTopZoom(), c.topZoomMax);
    const { hw, hh } = this.topHalf();
    const pad = 1.2;
    const cx = (W.xMin + W.xMax) / 2,
      cz = zCentre();
    const mx = W.xMax - W.xMin + 2 * pad,
      mz = W.zFront - W.zBack + 2 * pad;
    this.topX = 2 * hw >= mx ? cx : clamp(this.topX, W.xMin - pad + hw, W.xMax + pad - hw);
    this.topZ = 2 * hh >= mz ? cz : clamp(this.topZ, W.zBack - pad + hh, W.zFront + pad - hh);
  }
  /** Zooming out stops once the tray's depth fills the screen (no empty space above / below). */
  private minTopZoom() {
    const W = CONFIG.world;
    const c = CONFIG.camera;
    const base = Math.max(c.topDepth, c.topWidth / this.aspect);
    return Math.max(c.topZoomMin, base / (W.zFront - W.zBack + 3));
  }

  /** Pan by a world-space offset (Focus: x only; Top: x and z). */
  panBy(dx: number, dz: number) {
    if (this.view === 'focus') {
      this.focusGoal = null;
      this.focusX = this.clampFocus(this.focusX + dx);
    } else if (this.view === 'top') {
      this.topGoal = null;
      this.topX += dx;
      this.topZ += dz;
      this.clampTop();
    } else return;
    this.moved();
  }

  /** Smoothly bring (x, z) to the centre of the current view; from Full View, glide into Focus. */
  focusOn(x: number, z?: number) {
    if (this.view === 'top') {
      this.topGoal = { x, z: z ?? this.topZ };
    } else {
      this.focusGoal = this.clampFocus(x);
      if (this.view === 'full') {
        this.focusX = this.focusGoal;
        this.focusGoal = null;
        this.setView('focus');
      }
    }
    this.moved();
  }

  /** Top View zoom around a screen point (ndc), keeping the world point under it fixed. */
  zoomAt(ndcX: number, ndcY: number, factor: number) {
    if (this.view !== 'top') return;
    const before = this.topHalf();
    this.topZoom = clamp(this.topZoom * factor, this.minTopZoom(), CONFIG.camera.topZoomMax);
    const after = this.topHalf();
    // top view: screen right = +x, screen up = -z
    this.topX += ndcX * (before.hw - after.hw);
    this.topZ -= ndcY * (before.hh - after.hh);
    this.topGoal = null;
    this.clampTop();
    this.moved();
  }

  /** Persisted camera state. */
  state() {
    return { view: this.view, focusX: this.focusX, topX: this.topX, topZ: this.topZ, topZoom: this.topZoom };
  }
  restore(s: { view?: string; focusX?: number; topX?: number; topZ?: number; topZoom?: number }) {
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    this.focusX = this.clampFocus(num(s.focusX, 0));
    this.topX = num(s.topX, 0);
    this.topZ = num(s.topZ, zCentre());
    this.topZoom = num(s.topZoom, 1);
    this.clampTop();
    const v = s.view === 'front' ? 'focus' : s.view;
    if (v === 'focus' || v === 'full' || v === 'top') this.setView(v, true);
    this.update(0);
  }

  // ------------------------------------------------------------------ poses
  /** Live goal pose for a view. */
  goalPose(v: ViewMode, out: Pose): Pose {
    const c = CONFIG.camera;
    const a = this.aspect;
    this.frontH = Math.max(c.viewHeight, c.minViewWidth / a);
    if (v === 'focus') {
      out.tilt = this.fp.tilt;
      out.tx = this.focusX;
      out.ty = this.fp.ty;
      out.tz = 0;
      out.h = this.frontH;
      out.oy = (this.frontH - c.viewHeight) * 0.35;
    } else if (v === 'top') {
      const { h } = this.topHalf();
      out.tilt = Math.PI / 2;
      out.tx = this.topX;
      out.ty = -2.6;
      out.tz = this.topZ;
      out.h = h;
      out.oy = 0;
    } else this.fullPose(out);
    return out;
  }

  /** Frames the whole tray (water block, islands and plinth) with a small margin. */
  private fullPose(out: Pose) {
    const W = CONFIG.world;
    const tilt = CONFIG.camera.fullTiltDeg * DEG;
    const s = Math.sin(tilt),
      co = Math.cos(tilt);
    // screen-vertical coordinate of a world point: y·cos(t) − z·sin(t)
    const ys = (y: number, z: number) => y * co - z * s;
    const lo = Math.min(ys(W.plinthY - 0.2, W.zFront + 0.8), ys(W.plinthY, W.zBack));
    const hi = Math.max(ys(5.2, W.zBack + 6), ys(1.2, W.zBack));
    const width = W.xMax - W.xMin + 6;
    const h = Math.max((hi - lo) * 1.12, width / this.aspect);
    const mid = (hi + lo) / 2;
    // target on the line y·co − z·s = mid (pick z = centre of the tray)
    const tz = zCentre();
    out.tilt = tilt;
    out.tx = (W.xMin + W.xMax) / 2;
    out.tz = tz;
    out.ty = (mid + tz * s) / co;
    out.h = h;
    out.oy = 0;
  }

  update(dt: number) {
    // eased pans (double-click focus, minimap jumps)
    const k = 1 - Math.exp(-dt * 3.2);
    if (this.focusGoal !== null) {
      this.focusX += (this.focusGoal - this.focusX) * k;
      if (Math.abs(this.focusGoal - this.focusX) < 0.01) {
        this.focusX = this.focusGoal;
        this.focusGoal = null;
      }
    }
    if (this.topGoal) {
      this.topX += (this.topGoal.x - this.topX) * k;
      this.topZ += (this.topGoal.z - this.topZ) * k;
      this.clampTop();
      if (Math.hypot(this.topGoal.x - this.topX, this.topGoal.z - this.topZ) < 0.01) this.topGoal = null;
    }
    this.goalPose(this.view, this.goal);
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / CONFIG.camera.transition);
      const e = ease(this.t);
      const p = this.pose,
        f = this.from,
        g = this.goal;
      p.tilt = f.tilt + (g.tilt - f.tilt) * e;
      p.tx = f.tx + (g.tx - f.tx) * e;
      p.ty = f.ty + (g.ty - f.ty) * e;
      p.tz = f.tz + (g.tz - f.tz) * e;
      p.h = Math.exp(Math.log(f.h) + (Math.log(g.h) - Math.log(f.h)) * e);
      p.oy = f.oy + (g.oy - f.oy) * e;
    } else copyPose(this.pose, this.goal);
    this.apply();
  }

  resize(width: number, height: number) {
    this.aspect = width / Math.max(1, height);
    this.focusX = this.clampFocus(this.focusX);
    this.clampTop();
    this.update(0);
  }

  private apply() {
    const p = this.pose;
    const ft = this.fp.tilt;
    this.blend = clamp((p.tilt - ft) / (Math.PI / 2 - ft), 0, 1);
    const fullT = CONFIG.camera.fullTiltDeg * DEG;
    // Full-ness: how close the pose is to the Full framing (tilt near fullTilt and zoomed out)
    const tiltK = 1 - clamp(Math.abs(p.tilt - fullT) / (fullT - ft), 0, 1);
    this.fullness = clamp(tiltK * clamp((p.h - this.frontH) / (this.frontH * 1.2), 0, 1), 0, 1);
    this.viewH = p.h;
    this.viewW = p.h * this.aspect;
    this.camera.left = -this.viewW / 2;
    this.camera.right = this.viewW / 2;
    this.camera.top = this.viewH / 2 + p.oy;
    this.camera.bottom = -this.viewH / 2 + p.oy;
    this.camera.updateProjectionMatrix();
    const target = new THREE.Vector3(p.tx, p.ty, p.tz);
    const dir = new THREE.Vector3(0, Math.sin(p.tilt), Math.cos(p.tilt));
    this.camera.position.copy(target).addScaledVector(dir, CONFIG.camera.distance);
    this.camera.up.set(0, Math.cos(p.tilt), -Math.sin(p.tilt));
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
  }

  /** Visible x-range of the current frame (with margin), clamped to the world. */
  visibleX(margin = 0) {
    const W = CONFIG.world;
    const cx = this.pose.tx;
    return { min: Math.max(W.xMin, cx - this.viewW / 2) + margin, max: Math.min(W.xMax, cx + this.viewW / 2) - margin };
  }
  /** The v1 home frame (Focus View at x = 0): creature entrances / exits keep v1 behaviour. */
  homeVisibleX() {
    const hw = this.focusHalfW();
    return { min: -hw, max: hw };
  }
  /** Approximate visible z-range (Top View exact; side views cover the whole depth). */
  visibleZ() {
    const W = CONFIG.world;
    if (this.blend < 0.98) return { min: W.zBack, max: W.zFront };
    const p = this.pose;
    return { min: Math.max(W.zBack, p.tz - this.viewH / 2), max: Math.min(W.zFront, p.tz + this.viewH / 2) };
  }

  ray(ndcX: number, ndcY: number): THREE.Ray {
    this.raycaster.setFromCamera(this.tmpV2.set(ndcX, ndcY), this.camera);
    return this.raycaster.ray;
  }

  raycaster3(ndcX: number, ndcY: number): THREE.Raycaster {
    this.raycaster.setFromCamera(this.tmpV2.set(ndcX, ndcY), this.camera);
    return this.raycaster;
  }

  /** Intersection of the pointer ray with the plane z = const (null if parallel). */
  onPlaneZ(ndcX: number, ndcY: number, z: number, out = new THREE.Vector3()) {
    const r = this.ray(ndcX, ndcY);
    if (Math.abs(r.direction.z) < 1e-4) return out.set(r.origin.x, r.origin.y, z);
    const t = (z - r.origin.z) / r.direction.z;
    return out.copy(r.origin).addScaledVector(r.direction, t);
  }

  /** Intersection with the plane y = const (null if parallel). */
  onPlaneY(ndcX: number, ndcY: number, y: number, out = new THREE.Vector3()) {
    const r = this.ray(ndcX, ndcY);
    if (Math.abs(r.direction.y) < 1e-5) return null;
    const t = (y - r.origin.y) / r.direction.y;
    return out.copy(r.origin).addScaledVector(r.direction, t);
  }
}
