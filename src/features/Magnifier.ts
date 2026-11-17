import * as THREE from 'three';
import type { App } from '../core/App';
import { RenderPipeline } from '../core/RenderPipeline';
import { pointScale } from '../world/Particles';

/**
 * Ocean Magnifying Glass. A real second render of the live scene — not a screenshot — through
 * a narrowed orthographic frustum centred on the pointer, so the lens shows the exact spot under
 * it at 1.5× / 2× / 3× with full detail (crabs' legs, shell spirals, coral polyps, sand grains).
 *
 * How: the lens has its own small RenderPipeline (scene colour + depth target) and a small HDR
 * output target; the jelly water's refraction uniforms are pointed at the lens buffers for that
 * one render and restored right after. The result is drawn onto the canvas inside a circle with
 * tone mapping applied, after the main frame — the lens is never part of either scene, so it can
 * never see itself. Pinning keeps the lens on one spot and it stays live (fish keep swimming).
 * Buffers are created on first use and released a few seconds after the lens is put away.
 */
export class Magnifier {
  /** Lens diameter in CSS pixels. */
  sizePx = 250;
  pinned = false;
  private pinNdc = new THREE.Vector2();
  private ndc = new THREE.Vector2();
  private inside = false;
  private byTool = false;
  private byGame = false;
  private pipe: RenderPipeline | null = null;
  private out: THREE.WebGLRenderTarget | null = null;
  private cam = new THREE.OrthographicCamera();
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private idle = 0;
  private frame = 0;
  readonly el: HTMLElement;
  private pinEl: HTMLElement;

  constructor(private app: App, host: HTMLElement) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, uPinned: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform float uPinned; varying vec2 vUv;
        void main(){
          vec2 c = vUv - 0.5;
          float r = length(c) * 2.0;
          if (r > 1.0) discard;
          // a whisper of barrel distortion near the rim, like real glass
          vec2 uv = 0.5 + c * (1.0 - 0.06 * r * r);
          vec3 col = texture2D(tColor, uv).rgb;
          // glass: soft inner vignette + a curved highlight
          col *= 1.0 - 0.18 * smoothstep(0.75, 1.0, r);
          float hl = smoothstep(0.55, 0.0, length(c - vec2(-0.2, 0.22))) * 0.08;
          col += hl;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    q.frustumCulled = false;
    this.quadScene.add(q);
    this.el = document.createElement('div');
    this.el.className = 'lens';
    this.el.innerHTML = `<div class="lens-pin" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z"/></svg></div><div class="lens-zoom"></div>`;
    host.appendChild(this.el);
    this.pinEl = this.el.querySelector('.lens-pin')!;
  }

  get zoom() {
    return this.app.prefs.data.magnifierZoom;
  }
  setZoom(z: number) {
    this.app.prefs.data.magnifierZoom = z;
    this.app.prefs.changed();
  }

  /** Tool on/off (Interact → Magnifier). */
  setTool(on: boolean) {
    this.byTool = on;
    if (!on && !this.byGame) this.pinned = false;
  }
  /** Mini games can show the lens without changing the tool. Returns the previous state. */
  setGame(on: boolean) {
    const prev = this.byGame;
    this.byGame = on;
    if (!on && !this.byTool) this.pinned = false;
    return prev;
  }
  get enabled() {
    return this.byTool || this.byGame;
  }
  get visible() {
    return this.enabled && (this.pinned || this.inside) && this.app.tools.mode === 'play';
  }

  pointer(ndc: THREE.Vector2, inside: boolean) {
    this.ndc.copy(ndc);
    this.inside = inside;
  }

  /** Click with the Magnifier tool: pin at the pointer / unpin. */
  togglePin() {
    if (this.pinned) this.pinned = false;
    else {
      this.pinned = true;
      this.pinNdc.copy(this.ndc);
    }
  }
  unpin() {
    this.pinned = false;
  }

  /** Called after the main frame was drawn. */
  render(dt: number) {
    const app = this.app;
    const r = app.renderer;
    if (!this.visible) {
      this.el.classList.remove('show');
      if (this.pipe) {
        this.idle += dt;
        if (this.idle > 4) this.release();
      }
      return;
    }
    this.idle = 0;
    this.frame++;
    const canvas = r.domElement;
    const cssW = canvas.clientWidth || 1,
      cssH = canvas.clientHeight || 1;
    const pr = r.getPixelRatio();
    const size = Math.min(this.sizePx, Math.min(cssW, cssH) * 0.42);
    const px = Math.max(64, Math.round(size * pr));
    if (!this.pipe) {
      this.pipe = new RenderPipeline(r);
      this.out = new THREE.WebGLRenderTarget(px, px, { type: THREE.HalfFloatType, depthBuffer: false });
    }
    this.pipe.setPixelSize(px, px);
    if (this.out!.width !== px) this.out!.setSize(px, px);
    const c = this.pinned ? this.pinNdc : this.ndc;
    // lens frustum: the region under the lens, shrunk by the zoom factor (no distortion)
    const main = app.cam.camera;
    const W = main.right - main.left,
      H = main.top - main.bottom;
    const cx = main.left + ((c.x + 1) / 2) * W,
      cy = main.bottom + ((c.y + 1) / 2) * H;
    const hw = ((size / 2) / cssW) * W / this.zoom;
    const hh = ((size / 2) / cssH) * H / this.zoom;
    const cam = this.cam;
    cam.position.copy(main.position);
    cam.quaternion.copy(main.quaternion);
    cam.near = main.near;
    cam.far = main.far;
    cam.left = cx - hw;
    cam.right = cx + hw;
    cam.top = cy + hh;
    cam.bottom = cy - hh;
    cam.zoom = 1;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // point the water refraction at the lens buffers for this render
    const u = app.ocean.material.uniforms;
    const saved = { c: u.uSceneColor.value, d: u.uSceneDepth.value, r: u.uResolution.value, ps: pointScale.value };
    u.uSceneColor.value = this.pipe.rtScene.texture;
    u.uSceneDepth.value = this.pipe.rtScene.depthTexture;
    u.uResolution.value = this.pipe.resolution;
    pointScale.value = px / (2 * hh);
    const sm = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    this.pipe.render(app.world, app.waterScene, cam, this.out);
    r.shadowMap.autoUpdate = sm;
    u.uSceneColor.value = saved.c;
    u.uSceneDepth.value = saved.d;
    u.uResolution.value = saved.r;
    pointScale.value = saved.ps;
    // composite the circle onto the canvas
    const sx = ((c.x + 1) / 2) * cssW,
      sy = ((c.y + 1) / 2) * cssH; // from the bottom
    r.setRenderTarget(null);
    r.setViewport(sx - size / 2, sy - size / 2, size, size);
    r.setScissor(sx - size / 2, sy - size / 2, size, size);
    r.setScissorTest(true);
    this.mat.uniforms.tColor.value = this.out!.texture;
    r.render(this.quadScene, this.quadCam);
    r.setScissorTest(false);
    r.setViewport(0, 0, cssW, cssH);
    // DOM frame (crisp ring, pin badge)
    const left = sx - size / 2,
      top = cssH - sy - size / 2;
    this.el.style.width = this.el.style.height = `${size}px`;
    this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    this.el.classList.add('show');
    this.el.classList.toggle('pinned', this.pinned);
    (this.el.querySelector('.lens-zoom') as HTMLElement).textContent = `${this.zoom}×`;
    void this.pinEl;
  }

  release() {
    this.pipe?.dispose();
    this.out?.dispose();
    this.pipe = null;
    this.out = null;
    this.idle = 0;
  }
}
