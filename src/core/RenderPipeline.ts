import * as THREE from 'three';
import { CONFIG } from '../config';

/**
 * Three-pass pipeline that makes the jelly water both refractive and correctly sorted:
 *
 *  1. Opaque + transparent world (everything except water) -> HDR render target with depth.
 *  2. Fullscreen composite of that target to the canvas, also restoring its depth buffer.
 *  3. Water meshes rendered last with depth testing. They sample the scene colour/depth
 *     to compute refraction, Beer–Lambert absorption over the real water thickness,
 *     fresnel reflection and specular. Water outputs opaque colour, so there are no
 *     transparency sorting issues between the water front face, surface and creatures.
 */
export class RenderPipeline {
  readonly rtScene: THREE.WebGLRenderTarget;
  private compositeScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly resolution = new THREE.Vector2(1, 1);
  private size = new THREE.Vector2();

  constructor(private renderer: THREE.WebGLRenderer) {
    const depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    depthTexture.format = THREE.DepthFormat;
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: CONFIG.performance.msaaSamples,
      depthTexture,
      depthBuffer: true,
    });
    this.rtScene.texture.minFilter = THREE.LinearFilter;
    this.rtScene.texture.magFilter = THREE.LinearFilter;
    this.rtScene.texture.generateMipmaps = false;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rtScene.texture },
        tDepth: { value: depthTexture },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tDepth; varying vec2 vUv;
        void main(){
          gl_FragColor = vec4(texture2D(tColor, vUv).rgb, 1.0);
          gl_FragDepth = texture2D(tDepth, vUv).r;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    this.compositeScene.add(quad);
  }

  setSize(width: number, height: number) {
    this.renderer.getDrawingBufferSize(this.size);
    this.setPixelSize(this.size.x, this.size.y);
    void width;
    void height;
  }

  /** MSAA samples of the scene target (quality ladder); re-allocates only when it changes. */
  setSamples(n: number) {
    if (this.rtScene.samples === n) return;
    this.rtScene.samples = n;
    this.rtScene.dispose();
  }

  /** Explicit render-target size in device pixels (used by the Magnifier's own pipeline). */
  setPixelSize(w: number, h: number) {
    if (this.resolution.x === w && this.resolution.y === h) return;
    this.rtScene.setSize(w, h);
    this.resolution.set(w, h);
  }

  /** Renders world + water; `target` = null draws to the canvas (tone mapped). */
  render(world: THREE.Scene, water: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget | null = null) {
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.clear(true, true, true);
    r.render(world, camera);

    r.setRenderTarget(target);
    r.clear(true, true, true);
    // Shadow maps were already rendered in pass 1.
    const sm = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.render(this.compositeScene, this.quadCam);
    r.render(water, camera);
    r.shadowMap.autoUpdate = sm;
  }

  dispose() {
    this.rtScene.dispose();
  }
}
