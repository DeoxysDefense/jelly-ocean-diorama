import * as THREE from 'three';
import { rand } from '../util/math';
import { fbm3 } from '../util/noise';
import type { App } from '../core/App';
import { MAIL_INTERVAL, Prefs } from './Prefs';
import { pickMessage, type OceanMessage, messageById } from '../content/messages';
import { floatStep, type FloatBody, disposeTree } from './fx';

type BottleState = 'drift' | 'open' | 'leaving';

interface Bottle extends FloatBody {
  group: THREE.Group;
  proxy: THREE.Mesh;
  glass: THREE.MeshPhysicalMaterial;
  glow: THREE.Sprite;
  state: BottleState;
  age: number;
  fade: number;
  roll: number;
  dir: number;
}

/**
 * Ocean Mail: now and then a corked glass bottle with a rolled note drifts in from the edge of
 * the sea, riding the same waves, wind and currents as everything else. Clicking it unrolls a
 * small parchment note (an ocean fact, a fortune or a gentle thought, in 中文 or English).
 * Never opens by itself, never makes a sound; if ignored it simply drifts away.
 *
 * Scheduling uses active simulation time (the clock does not run while the page is hidden or the
 * wallpaper is paused), so a long absence never queues up a pile of bottles.
 */
export class OceanMail {
  readonly group = new THREE.Group();
  private bottle: Bottle | null = null;
  private saveT = 0;
  /** Message currently shown on the open note. */
  current: OceanMessage | null = null;
  onOpen: ((m: OceanMessage) => void) | null = null;

  constructor(private app: App, private prefs: Prefs) {}

  get active() {
    return !!this.bottle;
  }
  get bottlePosition() {
    return this.bottle?.pos ?? null;
  }

  /** Restarts the countdown (used when the frequency changes). */
  reschedule() {
    this.prefs.data.mail.nextIn = Prefs.randIn(MAIL_INTERVAL[this.prefs.data.mail.freq]);
    this.prefs.changed(false);
  }

  /** Dev / test helper: spawn a bottle right away (not exposed in the UI). */
  spawnTest() {
    if (this.bottle) this.remove();
    this.spawn(true);
  }

  private spawn(near = false) {
    const app = this.app;
    const vis = app.cam.visibleX(0);
    const g = new THREE.Group();
    const parts = buildBottle();
    g.add(parts.root);
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.name = 'bottle-proxy';
    g.add(proxy);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff2c8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(1.4);
    g.add(glow);
    // enter with the prevailing drift: from the left, along open water in front of or behind the island
    const lane = Math.random() < 0.65 ? rand(3.4, 5.0) : rand(-11.5, -6.8);
    const x = near ? vis.min + 7 : vis.min - 1.2;
    const pos = new THREE.Vector3(x, app.sim.level, lane);
    const b: Bottle = {
      group: g,
      proxy,
      glass: parts.glass,
      glow,
      pos,
      vel: new THREE.Vector3(0.15, 0, 0),
      draft: 0.035,
      yaw: rand(-0.4, 0.4),
      spin: rand(-0.05, 0.05),
      tilt: 0.8,
      state: 'drift',
      age: 0,
      fade: near ? 1 : 0,
      roll: rand(0, 6),
      dir: 1,
    };
    g.position.copy(pos);
    this.group.add(g);
    this.bottle = b;
  }

  private remove() {
    const b = this.bottle;
    if (!b) return;
    this.group.remove(b.group);
    disposeTree(b.group);
    (b.glow.material as THREE.SpriteMaterial).dispose();
    this.bottle = null;
  }

  /** Pointer ray test; returns true if the bottle was clicked (and opens it). */
  tryClick(rc: THREE.Raycaster): boolean {
    const b = this.bottle;
    if (!b || b.state !== 'drift') return false;
    if (!rc.intersectObject(b.proxy, false).length) return false;
    this.open();
    return true;
  }

  hover(rc: THREE.Raycaster): boolean {
    const b = this.bottle;
    return !!b && b.state === 'drift' && rc.intersectObject(b.proxy, false).length > 0;
  }

  private open() {
    const b = this.bottle!;
    b.state = 'open';
    const m = pickMessage(this.prefs.data.mail.recent);
    this.prefs.data.mail.recent = [...this.prefs.data.mail.recent, m.id].slice(-40);
    this.prefs.changed(false);
    this.current = m;
    const app = this.app;
    app.sim.addRipple(b.pos.x, b.pos.z, 0.05);
    app.bubbles.emit(b.pos.x, b.pos.y - 0.1, b.pos.z, 4, 0.15, 0.4);
    this.onOpen?.(m);
  }

  /** Re-open the last message (e.g. after reload it is gone; used by tests). */
  show(id: string) {
    const m = messageById(id);
    if (m) {
      this.current = m;
      this.onOpen?.(m);
    }
  }

  /** The note was closed: the bottle sinks out of sight with a few bubbles. */
  closed() {
    this.current = null;
    if (this.bottle && this.bottle.state === 'open') this.bottle.state = 'leaving';
  }

  update(dt: number, wind: number, busy: boolean) {
    const mail = this.prefs.data.mail;
    if (mail.on && !this.bottle && !busy) {
      mail.nextIn -= dt;
      if (mail.nextIn <= 0) {
        this.spawn();
        this.reschedule();
      }
    }
    this.saveT -= dt;
    if (this.saveT <= 0) {
      this.saveT = 30;
      this.prefs.changed(false);
    }
    const b = this.bottle;
    if (!b) return;
    const app = this.app;
    b.age += dt;
    const vis = app.cam.visibleX(0);
    // a gentle steady drift so it crosses the scene even on a windless day
    if (b.state === 'drift') b.vel.x += (0.16 - b.vel.x) * Math.min(1, dt * 0.2) * 0.5;
    if (b.state === 'open') b.vel.multiplyScalar(Math.exp(-dt * 2));
    floatStep(b, app.sim, app.terrain, app.flow, dt, b.state === 'open' ? 0 : wind, b.group, 0.12);
    // bottles roll a little around their long axis
    b.roll += dt;
    b.group.children[0].rotation.x = Math.sin(b.roll * 0.9) * 0.18;
    // glow when hovered / opened
    const gm = b.glow.material as THREE.SpriteMaterial;
    const glowT = b.state === 'open' ? 0.55 + 0.15 * Math.sin(b.age * 4) : b.state === 'drift' && app.night > 0.5 ? 0.12 : 0;
    gm.opacity += (glowT - gm.opacity) * Math.min(1, dt * 4);
    if (b.state === 'leaving') {
      b.fade -= dt * 0.5;
      b.draft += dt * 0.2;
      if (Math.random() < dt * 6) app.bubbles.emit(b.pos.x, b.pos.y - 0.05, b.pos.z, 1, 0.1, 0.4);
    } else b.fade = Math.min(1, b.fade + dt * 0.5);
    const s = Math.max(0.001, b.fade);
    b.group.children[0].scale.setScalar(s);
    b.glass.opacity = 0.4 * s;
    if (b.fade <= 0 || b.pos.x > vis.max + 2 || b.age > 900) this.remove();
  }

  /** Drops any bottle (world reset). The schedule continues. */
  clear() {
    this.remove();
    this.current = null;
  }
}

// ------------------------------------------------------------------ model
function buildBottle() {
  const root = new THREE.Group();
  // glass: lathe profile (r, y) from base to lip, then laid on its side along +x
  const prof: [number, number][] = [
    [0.0, 0.0],
    [0.082, 0.0],
    [0.098, 0.012],
    [0.102, 0.05],
    [0.102, 0.3],
    [0.096, 0.345],
    [0.07, 0.395],
    [0.042, 0.43],
    [0.034, 0.47],
    [0.034, 0.535],
    [0.043, 0.545],
    [0.043, 0.565],
    [0.03, 0.57],
  ];
  const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
  const glassGeo = new THREE.LatheGeometry(pts, 28);
  glassGeo.translate(0, -0.29, 0).rotateZ(-Math.PI / 2);
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xc8f0dc,
    roughness: 0.04,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    specularIntensity: 1,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    side: THREE.DoubleSide,
    sheen: 0.4,
    sheenColor: new THREE.Color(0xd8fff0),
  });
  const glassMesh = new THREE.Mesh(glassGeo, glass);
  glassMesh.renderOrder = 6;
  // rolled parchment note inside, tied with twine
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xeedcb0, roughness: 0.85, map: paperTexture() });
  const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.27, 18, 1, false).rotateZ(Math.PI / 2), paperMat);
  paper.position.set(-0.06, -0.035, 0);
  const curl = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.006, 6, 20, Math.PI * 1.5).rotateY(Math.PI / 2), paperMat);
  curl.position.set(0.075, -0.035, 0);
  const twine = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.004, 6, 22).rotateY(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa04a32, roughness: 0.8 }));
  twine.position.set(-0.06, -0.035, 0);
  // cork
  const corkGeo = new THREE.CylinderGeometry(0.036, 0.031, 0.075, 16, 2);
  const cp = corkGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) {
    const k = 1 + 0.06 * fbm3(cp.getX(i) * 60, cp.getY(i) * 60, cp.getZ(i) * 60, 2);
    cp.setXYZ(i, cp.getX(i) * k, cp.getY(i), cp.getZ(i) * k);
  }
  corkGeo.computeVertexNormals();
  corkGeo.rotateZ(-Math.PI / 2);
  const cork = new THREE.Mesh(corkGeo, new THREE.MeshStandardMaterial({ color: 0xa8784a, roughness: 0.95 }));
  cork.position.set(0.275, 0, 0);
  for (const m of [glassMesh, paper, cork]) m.castShadow = true;
  root.add(paper, curl, twine, cork, glassMesh);
  root.scale.setScalar(1.45);
  return { root, glass };
}

let paperTex: THREE.Texture | null = null;
function paperTexture() {
  if (paperTex) return paperTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#efdfb6';
  g.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 9; i++) {
    g.fillStyle = 'rgba(90,70,40,0.25)';
    g.fillRect(10, 8 + i * 6, 70 + Math.random() * 40, 1.2);
  }
  paperTex = new THREE.CanvasTexture(c);
  paperTex.colorSpace = THREE.SRGBColorSpace;
  return paperTex;
}

let glowTex: THREE.Texture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,250,225,0.9)');
  grd.addColorStop(0.4, 'rgba(255,235,180,0.35)');
  grd.addColorStop(1, 'rgba(255,220,150,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
