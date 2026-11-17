import * as THREE from 'three';
import type { TerrainSystem } from '../world/TerrainSystem';

/**
 * Soft glowing ellipse that hugs the terrain (selection footprint / brush cursor).
 * Built as a small grid so it can follow the seabed relief.
 */
export class GroundMarker {
  readonly mesh: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private N = 24;
  private target = 0;
  private alpha = 0;

  constructor(private terrain: TerrainSystem, color = 0xd8fdff) {
    const N = this.N;
    this.geo = new THREE.PlaneGeometry(2, 2, N, N);
    this.geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAlpha; uniform float uTime; varying vec2 vUv;
        void main(){
          float r = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.72, 0.86, r) * (1.0 - smoothstep(0.88, 1.0, r));
          float fill = (1.0 - smoothstep(0.0, 0.9, r)) * 0.18;
          float pulse = 0.85 + 0.15 * sin(uTime * 4.0);
          float a = (ring * pulse + fill) * uAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.mesh.visible = false;
  }

  setColor(hex: number) {
    this.mat.uniforms.uColor.value.setHex(hex);
  }

  show(x: number, z: number, rx: number, rz: number) {
    this.target = 1;
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const base = (this.geo.userData.base ??= Float32Array.from(pos.array as Float32Array)) as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      const px = x + base[i * 3] * rx,
        pz = z + base[i * 3 + 2] * rz;
      pos.setXYZ(i, px, this.terrain.heightAt(px, Math.max(-5.95, Math.min(5.95, pz))) + 0.03, pz);
    }
    pos.needsUpdate = true;
    this.mesh.visible = true;
  }

  hide() {
    this.target = 0;
  }

  update(dt: number, time: number) {
    this.alpha += (this.target - this.alpha) * Math.min(1, dt * 10);
    this.mat.uniforms.uAlpha.value = this.alpha;
    this.mat.uniforms.uTime.value = time;
    if (this.alpha < 0.01 && this.target === 0) this.mesh.visible = false;
  }
}
