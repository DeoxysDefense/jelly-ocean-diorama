import * as THREE from 'three';
import type { App } from '../core/App';
import { RenderPipeline } from '../core/RenderPipeline';
import { pointScale } from '../world/Particles';
import { PAGES } from '../content/notebook';

/**
 * V2 (P3) Field Notebook: a page for every species or behaviour *you* have observed.
 *
 *  - Creatures: hovering ≈ 1 s or clicking counts as observing (InteractionManager).
 *  - Behaviours (a hermit crab changing shells, a turtle coming up for air …) count when they
 *    happen on screen, the page is visible and someone used the mouse / keyboard recently.
 *
 * On the first observation the live scene is sketched: a small second render framed on the
 * animal (the Magnifier's trick), tone mapped and turned into a soft ink-and-wash drawing on
 * paper. Pages are ordered by discovery. There is no total, no silhouette, no completion.
 */
export class FieldNotebook {
  private pipe: RenderPipeline | null = null;
  private out: THREE.WebGLRenderTarget | null = null;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200);
  private lastInput = -Infinity;
  private releaseT = 0;
  static readonly W = 240;
  static readonly H = 180;

  constructor(private app: App) {
    const mark = () => (this.lastInput = performance.now());
    window.addEventListener('pointermove', mark, { passive: true });
    window.addEventListener('pointerdown', mark, { passive: true });
    window.addEventListener('keydown', mark);
    window.addEventListener('wheel', mark, { passive: true });
  }

  /** A creature (or visitor) was watched / clicked. */
  observe(key: string, point?: THREE.Vector3, size = 1.1) {
    if (!PAGES[key]) return;
    const mem = this.app.memory;
    const first = mem.observe(key);
    this.app.visitors?.noticed(key);
    if (point && (first || !mem.data.sketches[key])) this.sketch(key, point, size);
  }

  /** Something worth noting happened at `pos` — noted only if someone was watching. */
  behaviour(kind: string, pos: THREE.Vector3) {
    const key = `b:${kind}`;
    if (!PAGES[key] || this.app.memory.hasObserved(key)) return;
    if (!this.watching(pos)) return;
    this.observe(key, pos, 1.4);
  }

  /** On screen, page visible, and a person used the computer in the last three minutes. */
  watching(pos: THREE.Vector3) {
    if (typeof document !== 'undefined' && document.hidden) return false;
    if (this.app.wallpaper?.paused) return false;
    if (performance.now() - this.lastInput > 180_000) return false;
    const p = pos.clone().project(this.app.cam.camera);
    return Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95;
  }

  /** Pages in the order they were discovered. */
  pages() {
    const mem = this.app.memory.data;
    return Object.entries(mem.observed)
      .filter(([k]) => !!PAGES[k])
      .sort((a, b) => a[1] - b[1])
      .map(([key, t]) => ({ key, t, h: mem.observedH[key], img: mem.sketches[key] }));
  }

  update(dt: number) {
    // the sketch buffers are only kept for a little while after use
    if (this.pipe) {
      this.releaseT -= dt;
      if (this.releaseT <= 0) {
        this.pipe.dispose();
        this.out?.dispose();
        this.pipe = null;
        this.out = null;
      }
    }
  }

  // ------------------------------------------------------------------ sketch
  private sketch(key: string, point: THREE.Vector3, size: number) {
    try {
      const img = this.capture(point, size);
      if (img) {
        this.app.memory.data.sketches[key] = img;
        this.app.memory.changed();
      }
    } catch {
      /* no WebGL float read-back: the page simply has no drawing */
    }
  }

  private capture(point: THREE.Vector3, size: number): string | null {
    const app = this.app;
    const r = app.renderer;
    const W = FieldNotebook.W,
      H = FieldNotebook.H;
    if (!this.pipe) {
      this.pipe = new RenderPipeline(r);
      this.out = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, depthBuffer: false });
    }
    this.releaseT = 5;
    this.pipe.setPixelSize(W, H);
    // frame the animal with the main camera's orientation
    const main = app.cam.camera;
    main.updateMatrixWorld();
    const local = point.clone().applyMatrix4(main.matrixWorldInverse);
    const hh = size * 0.62,
      hw = (hh * W) / H;
    const cam = this.cam;
    cam.position.copy(main.position);
    cam.quaternion.copy(main.quaternion);
    cam.near = main.near;
    cam.far = main.far;
    cam.left = local.x - hw;
    cam.right = local.x + hw;
    cam.top = local.y + hh;
    cam.bottom = local.y - hh;
    cam.zoom = 1;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const u = app.ocean.material.uniforms;
    const saved = { c: u.uSceneColor.value, d: u.uSceneDepth.value, res: u.uResolution.value, ps: pointScale.value };
    u.uSceneColor.value = this.pipe.rtScene.texture;
    u.uSceneDepth.value = this.pipe.rtScene.depthTexture;
    u.uResolution.value = this.pipe.resolution;
    pointScale.value = H / (2 * hh);
    const sm = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    const prevTarget = r.getRenderTarget();
    this.pipe.render(app.world, app.waterScene, cam, this.out);
    const buf = new Float32Array(W * H * 4);
    r.readRenderTargetPixels(this.out!, 0, 0, W, H, buf);
    r.setRenderTarget(prevTarget);
    r.shadowMap.autoUpdate = sm;
    u.uSceneColor.value = saved.c;
    u.uSceneDepth.value = saved.d;
    u.uResolution.value = saved.res;
    pointScale.value = saved.ps;
    return sketchFromHDR(buf, W, H, r.toneMappingExposure);
  }
}

// ------------------------------------------------------------------ the drawing

/** Khronos PBR Neutral tone mapping (as the renderer uses), then sRGB. */
function neutral(c: number[]) {
  const start = 0.8 - 0.04,
    desat = 0.15;
  const x = Math.min(c[0], c[1], c[2]);
  const off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  for (let i = 0; i < 3; i++) c[i] -= off;
  const peak = Math.max(c[0], c[1], c[2]);
  if (peak >= start) {
    const d = 1 - start;
    const np = 1 - (d * d) / (peak + d - start);
    for (let i = 0; i < 3; i++) c[i] *= np / peak;
    const g = 1 - 1 / (desat * (peak - np) + 1);
    for (let i = 0; i < 3; i++) c[i] = c[i] * (1 - g) + np * g;
  }
  return c.map((v) => {
    v = Math.max(0, Math.min(1, v));
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  });
}

/**
 * Turns a linear HDR capture into a field sketch: muted watercolour wash on warm paper, brown ink
 * on the edges, soft vignette into the page. Returns a small JPEG data URL.
 */
export function sketchFromHDR(buf: Float32Array, W: number, H: number, exposure = 1): string | null {
  if (typeof document === 'undefined') return null;
  const lum = new Float32Array(W * H);
  const rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const si = ((H - 1 - y) * W + x) * 4; // flip: GL rows start at the bottom
      const c = neutral([buf[si] * exposure, buf[si + 1] * exposure, buf[si + 2] * exposure]);
      const k = y * W + x;
      rgb.set(c, k * 3);
      lum[k] = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const paper = [246, 238, 216],
    ink = [78, 56, 34];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      const L = (dx: number, dy: number) => lum[Math.min(H - 1, Math.max(0, y + dy)) * W + Math.min(W - 1, Math.max(0, x + dx))];
      const gx = L(1, -1) + 2 * L(1, 0) + L(1, 1) - L(-1, -1) - 2 * L(-1, 0) - L(-1, 1);
      const gy = L(-1, 1) + 2 * L(0, 1) + L(1, 1) - L(-1, -1) - 2 * L(0, -1) - L(1, -1);
      const edge = Math.min(1, Math.max(0, Math.hypot(gx, gy) * 2.2 - 0.12));
      // watercolour wash: desaturated, lighter, warmed toward the paper
      const r = rgb[k * 3],
        g = rgb[k * 3 + 1],
        b = rgb[k * 3 + 2];
      const grey = 0.3 * r + 0.59 * g + 0.11 * b;
      const wash = [0, 1, 2].map((i) => {
        const v = [r, g, b][i] * 0.55 + grey * 0.45;
        return paper[i] * (0.35 + 0.65 * v) * 0.98 + 4;
      });
      // vignette: the drawing fades into the page
      const vx = (x / W - 0.5) * 2,
        vy = (y / H - 0.5) * 2;
      const fade = Math.min(1, Math.max(0, (Math.hypot(vx * 0.9, vy) - 0.72) / 0.3));
      const grain = 1 + (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1) * 0.03;
      for (let i = 0; i < 3; i++) {
        let v = wash[i] * (1 - edge * 0.85) + ink[i] * edge * 0.85;
        v = v * (1 - fade) + paper[i] * fade;
        img.data[k * 4 + i] = Math.max(0, Math.min(255, v * grain));
      }
      img.data[k * 4 + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.78);
}
