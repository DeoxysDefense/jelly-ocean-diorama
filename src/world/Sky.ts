import * as THREE from 'three';
import { GLSL_NOISE } from '../util/shaders';
import type { AtmosphereState } from './Atmosphere';

/**
 * Screen-space sky backdrop driven by the atmosphere: gradient, sun / moon glow (the discs are
 * never drawn), thin drifting clouds kept away from the hut, twinkling stars at night, a
 * grey overcast when it rains, and a light studio backdrop in Top View.
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private cloudOffset = 0;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uAspect: { value: 16 / 9 },
        uCloud: { value: 0 },
        uTime: { value: 0 },
        uTop: { value: 0 },
        uTopC: { value: new THREE.Color() },
        uMidC: { value: new THREE.Color() },
        uHorC: { value: new THREE.Color() },
        uGlowC: { value: new THREE.Color() },
        uGlowX: { value: 0.1 },
        uNight: { value: 0 },
        uDusk: { value: 0 },
        uDay: { value: 1 },
        uRain: { value: 0 },
        uHut: { value: new THREE.Vector3(0.24, 0.62, 1) },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.99999, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uAspect, uCloud, uTime, uTop, uGlowX, uNight, uDusk, uDay, uRain;
        uniform vec3 uTopC, uMidC, uHorC, uGlowC;
        uniform vec3 uHut;
        ${GLSL_NOISE}
        vec3 s2l(vec3 c){ return pow(c, vec3(2.2)); }
        void main(){
          vec2 uv = vUv;
          vec3 col = mix(uHorC, uMidC, smoothstep(0.42, 0.72, uv.y));
          col = mix(col, uTopC, smoothstep(0.7, 1.05, uv.y));
          // sun / moon glow (off-screen disc)
          vec2 sp = vec2((uv.x - uGlowX) * uAspect, uv.y - 1.05);
          float glow = exp(-dot(sp, sp) * mix(1.6, 3.5, uNight));
          col += uGlowC * glow * (0.22 + 0.25 * uDusk) * (1.0 - uRain * 0.7);
          // dusk band near the horizon
          col += s2l(vec3(1.0, 0.55, 0.35)) * uDusk * 0.18 * exp(-pow((uv.y - 0.5) / 0.12, 2.0));
          // stars
          if (uNight > 0.01) {
            vec2 st = uv * vec2(uAspect, 1.0) * 140.0;
            vec2 id = floor(st);
            vec2 f = fract(st) - 0.5 - (jHash22(id) - 0.5) * 0.6;
            float h = jHash12(id);
            float star = step(0.985, h) * smoothstep(0.12, 0.0, length(f));
            float tw = 0.6 + 0.4 * sin(uTime * (1.5 + h * 4.0) + h * 40.0);
            col += vec3(0.9, 0.95, 1.0) * star * tw * uNight * smoothstep(0.5, 0.75, uv.y) * (1.0 - uRain);
          }
          // clouds (denser and greyer with rain)
          vec2 p = vec2(uv.x * uAspect * 1.6 + uCloud, uv.y * 6.0);
          float n = jFbm(p * vec2(0.55, 0.9) + vec2(0.0, 3.0));
          n += 0.35 * jFbm(p * vec2(1.6, 2.4) + vec2(uCloud * 0.5, 7.0)) - 0.17;
          float band = smoothstep(0.66 - uRain * 0.25, 0.8 - uRain * 0.2, uv.y) * (1.0 - smoothstep(0.92 + uRain * 0.1, 1.0 + uRain * 0.1, uv.y));
          float hutMask = 1.0 - 0.85 * uHut.z * exp(-pow((uv.x - uHut.x) / 0.13, 2.0) - pow((uv.y - uHut.y) / 0.14, 2.0)) * (1.0 - uRain);
          float c = smoothstep(0.5 - uRain * 0.25, 0.78 - uRain * 0.2, n) * band * hutMask;
          vec3 lit = mix(s2l(vec3(0.86, 0.9, 0.95)), vec3(1.0), smoothstep(0.55, 0.85, n));
          lit = mix(lit, s2l(vec3(1.0, 0.72, 0.6)), uDusk * 0.6);
          lit = mix(lit, s2l(vec3(0.62, 0.66, 0.7)), uRain * 0.8);
          lit *= mix(0.12, 1.0, uDay);
          col = mix(col, lit, c * (0.75 + uRain * 0.2));
          col = mix(col, uHorC, (1.0 - smoothstep(0.38, 0.6, uv.y)) * 0.35);
          // Top / Full View: light studio backdrop (dimmed at night)
          vec2 q = (uv - 0.5) * vec2(uAspect, 1.0);
          vec3 studio = mix(s2l(vec3(0.90, 0.94, 0.95)), s2l(vec3(0.66, 0.76, 0.80)), smoothstep(0.2, 1.1, length(q)));
          studio *= (0.97 + 0.03 * jNoise(uv * vec2(uAspect, 1.0) * 220.0)) * mix(0.25, 1.0, uDay);
          col = mix(col, studio, uTop);
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  /** Keeps clouds from drifting across the hut: its screen position (uv) and visibility weight. */
  setHut(u: number, v: number, weight: number) {
    this.material.uniforms.uHut.value.set(u, v, weight);
  }

  update(dt: number, time: number, wind: number, aspect: number, top: number, atm: AtmosphereState) {
    const u = this.material.uniforms;
    u.uTop.value = top;
    this.cloudOffset += dt * (0.006 + wind * 0.05 + atm.rain * 0.02);
    u.uCloud.value = this.cloudOffset;
    u.uAspect.value = aspect;
    u.uTime.value = time;
    u.uTopC.value.copy(atm.skyTop);
    u.uMidC.value.copy(atm.skyMid);
    u.uHorC.value.copy(atm.skyHorizon);
    u.uGlowC.value.copy(atm.glowColor);
    u.uGlowX.value = atm.glowX;
    u.uNight.value = atm.night;
    u.uDusk.value = atm.dusk;
    u.uDay.value = atm.day;
    u.uRain.value = atm.rain;
  }
}
