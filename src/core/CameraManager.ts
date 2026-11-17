import * as THREE from 'three';
import { CONFIG, zCentre } from '../config';

export type ViewMode = 'front' | 'top';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Dual camera for one shared 3D world.
 *  - Front View: the original wallpaper composition (orthographic, ~9.5° downward tilt).
 *  - Top View: looking straight down onto the x–z plane for precise editing.
 * Switching animates tilt, framing and target in one orthographic camera, so nothing in the
 * scene is rebuilt — sand, objects and creatures simply stay where they are.
 */
export class CameraManager {
  readonly camera: THREE.OrthographicCamera;
  view: ViewMode = 'front';
  /** 0 = front, 1 = top (animated). */
  blend = 0;
  private from = 0;
  private to = 0;
  private t = 1;
  private aspect = 16 / 9;
  viewW = 32;
  viewH = 18;
  private raycaster = new THREE.Raycaster();
  private tmpV2 = new THREE.Vector2();
  private listeners: (() => void)[] = [];
  /** Front-view frame height (used for UI / point sizing). */
  frontH = 18;

  constructor() {
    this.camera = new THREE.OrthographicCamera(-16, 16, 9, -9, 1, 160);
    this.apply();
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  setView(v: ViewMode, instant = false) {
    if (v === this.view && this.t >= 1) return;
    this.view = v;
    this.from = this.blend;
    this.to = v === 'top' ? 1 : 0;
    this.t = instant ? 1 : 0;
    if (instant) this.blend = this.to;
    this.apply();
    for (const l of this.listeners) l();
  }

  toggle() {
    this.setView(this.view === 'front' ? 'top' : 'front');
  }

  get isTop() {
    return this.blend > 0.5;
  }
  get transitioning() {
    return this.t < 1;
  }

  update(dt: number) {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / CONFIG.camera.transition);
    this.blend = this.from + (this.to - this.from) * ease(this.t);
    this.apply();
  }

  resize(width: number, height: number) {
    this.aspect = width / Math.max(1, height);
    this.apply();
  }

  private apply() {
    const c = CONFIG.camera;
    const a = this.aspect;
    const b = this.blend;
    // framing
    this.frontH = Math.max(c.viewHeight, c.minViewWidth / a);
    const topH = Math.max(c.topDepth, c.topWidth / a);
    this.viewH = this.frontH + (topH - this.frontH) * b;
    this.viewW = this.viewH * a;
    const extra = (this.frontH - c.viewHeight) * 0.35 * (1 - b);
    this.camera.left = -this.viewW / 2;
    this.camera.right = this.viewW / 2;
    this.camera.top = this.viewH / 2 + extra;
    this.camera.bottom = -this.viewH / 2 + extra;
    this.camera.updateProjectionMatrix();
    // pose: tilt from front angle to 90°, up vector stays continuous through the rotation
    const tilt = THREE.MathUtils.degToRad(c.tiltDeg + (90 - c.tiltDeg) * b);
    const target = new THREE.Vector3(0, c.centerY + (-2.6 - c.centerY) * b, zCentre() * b);
    const dir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
    this.camera.position.copy(target).addScaledVector(dir, c.distance);
    this.camera.up.set(0, Math.cos(tilt), -Math.sin(tilt));
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
  }

  /** Visible x-range (with margin). */
  visibleX(margin = 0) {
    return { min: -this.viewW / 2 + margin, max: this.viewW / 2 - margin };
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
