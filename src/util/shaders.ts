import * as THREE from 'three';

/** Uniforms shared by every patched material (one object => one update per frame). */
export const shared = {
  uTime: { value: 0 },
  uWaterLevel: { value: 0 },
  uCausticStrength: { value: 0.5 },
  uCausticColor: { value: new THREE.Color(0.95, 1.0, 0.92) },
  /** Smoothed wind 0..1 */
  uWind: { value: 0.25 },
  /** Time integrated with wind-dependent speed; drives plant sway without phase jumps. */
  uSwayTime: { value: 0 },
  /** Current Brush: 4 strongest local flows (xyz + radius) and their velocities. */
  uFlowP: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -999, 0, 0.001)) },
  uFlowV: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
  /** Highlight tint for the selection system (per material instance overrides). */
};

export const GLSL_NOISE = /* glsl */ `
float jHash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 jHash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float jNoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(jHash12(i), jHash12(i+vec2(1,0)), u.x), mix(jHash12(i+vec2(0,1)), jHash12(i+vec2(1,1)), u.x), u.y);
}
float jHash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float jNoise3(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); vec3 u = f*f*(3.0-2.0*f);
  return mix(mix(mix(jHash13(i), jHash13(i+vec3(1,0,0)), u.x), mix(jHash13(i+vec3(0,1,0)), jHash13(i+vec3(1,1,0)), u.x), u.y),
             mix(mix(jHash13(i+vec3(0,0,1)), jHash13(i+vec3(1,0,1)), u.x), mix(jHash13(i+vec3(0,1,1)), jHash13(i+vec3(1,1,1)), u.x), u.y), u.z);
}
vec3 jNoiseGrad(vec3 p){
  const float e = 0.3;
  float n0 = jNoise3(p);
  return vec3(jNoise3(p + vec3(e,0,0)) - n0, jNoise3(p + vec3(0,e,0)) - n0, jNoise3(p + vec3(0,0,e)) - n0) / e;
}
float jFbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*jNoise(p); p*=2.03; a*=0.5; } return s; }
float jCausticLayer(vec2 p, float t){
  vec2 i = floor(p); vec2 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y=-1; y<=1; y++) for (int x=-1; x<=1; x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = jHash22(i + g);
    o = 0.5 + 0.42 * sin(t + 6.2831 * o);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return 1.0 - smoothstep(0.0, 0.16, d2 - d1);
}
float jCaustics(vec2 p, float t){
  vec2 w = p + 0.22 * vec2(sin(p.y * 1.7 + t * 0.8), cos(p.x * 1.4 - t * 0.7));
  float a = jCausticLayer(w, t * 0.9);
  float b = jCausticLayer(w * 1.6 + vec2(3.1, 1.7), t * 1.15);
  return pow(clamp(a * 0.62 + b * 0.48, 0.0, 1.2), 1.7);
}
`;

export interface PatchOptions {
  caustics?: boolean;
  /** Plant sway: displacement grows with local height (position.y / height). */
  sway?: {
    height: number;
    /** Max displacement at the top in local units. */
    amount: number;
    /** Base current motion fraction when wind = 0 (0..1). */
    base?: number;
    /** Multiplier on wind influence. */
    wind?: number;
    /** Uses per-instance attribute aPhase when true. */
    instanced?: boolean;
    speed?: number;
  };
  /** Extra emissive-like rim (fake subsurface) strength. */
  rim?: number;
  /** Procedural micro-relief (object space): polyps, pores, grain. */
  bump?: { scale: number; strength: number };
  key?: string;
}

/**
 * Patches a MeshStandardMaterial / MeshPhysicalMaterial to add underwater caustics,
 * procedural sway and a soft rim term while keeping three.js lighting and shadows.
 */
export function patchMaterial<T extends THREE.MeshStandardMaterial>(mat: T, opts: PatchOptions): T {
  const sway = opts.sway;
  const swayUniforms = sway
    ? {
        uSwayHeight: { value: sway.height },
        uSwayAmount: { value: sway.amount },
        uSwayBase: { value: sway.base ?? 0.35 },
        uSwayWindK: { value: sway.wind ?? 1.0 },
        uSwaySpeed: { value: sway.speed ?? 1.0 },
      }
    : {};
  (mat as any).userData.swayUniforms = swayUniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, swayUniforms, {
      uRim: { value: opts.rim ?? 0 },
      uBumpScale: { value: opts.bump?.scale ?? 1 },
      uBumpStrength: { value: opts.bump?.strength ?? 0 },
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vLPos;
        uniform float uTime; uniform float uWind; uniform float uSwayTime;
        ${sway ? 'uniform float uSwayHeight, uSwayAmount, uSwayBase, uSwayWindK, uSwaySpeed, uWaterLevel; uniform vec4 uFlowP[4]; uniform vec3 uFlowV[4];' : ''}
        ${sway && sway.instanced ? 'attribute float aPhase;' : ''}
        `,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vLPos = position;
        ${
          sway
            ? `{
          float hN = clamp(position.y / uSwayHeight, 0.0, 1.0);
          vec3 org = (modelMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
          float ph = dot(org.xz, vec2(0.71, 1.37)) ${sway.instanced ? '+ aPhase' : ''};
          float st = uSwayTime * uSwaySpeed;
          float s = sin(st * 1.3 + ph) * 0.62 + sin(st * 2.27 + ph * 1.9) * 0.28 + sin(st*0.53 + ph*0.7)*0.25;
          float amp = uSwayAmount * (uSwayBase + uWind * uSwayWindK);
          float bend = hN * hN;
          transformed.x += (s * amp + uWind * uSwayWindK * uSwayAmount * 0.45) * bend;
          transformed.z += cos(st * 1.1 + ph * 1.3) * amp * 0.35 * bend;
          transformed.y -= abs(s) * amp * 0.25 * bend;
          // painted currents are water currents: only plants rooted under water feel them
          // (palm trunks and island shrubs sway with the wind only)
          vec3 fl = vec3(0.0);
          if (org.y < uWaterLevel - 0.05) {
            for (int i = 0; i < 4; i++) {
              vec3 d = (org - uFlowP[i].xyz) / uFlowP[i].w;
              fl += uFlowV[i] * exp(-dot(d, d) * 1.4);
            }
          }
          transformed.x += fl.x * 0.3 * bend * uSwayHeight;
          transformed.z += fl.z * 0.3 * bend * uSwayHeight;
          transformed.y -= length(fl.xz) * 0.08 * bend * uSwayHeight;
        }`
            : ''
        }`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 jwp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            jwp = instanceMatrix * jwp;
          #endif
          vWPos = (modelMatrix * jwp).xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vLPos;
        uniform float uTime; uniform float uWaterLevel; uniform float uCausticStrength; uniform vec3 uCausticColor; uniform float uRim;
        uniform float uBumpScale; uniform float uBumpStrength;
        ${GLSL_NOISE}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        ${
          opts.bump
            ? `{
          vec3 bp = vLPos * uBumpScale;
          vec3 g = jNoiseGrad(bp) + 0.5 * jNoiseGrad(bp * 2.3 + 7.1);
          vec3 gV = (viewMatrix * vec4(g, 0.0)).xyz; // isotropic noise: object-space gradient is fine
          normal = normalize(normal - (gV - dot(gV, normal) * normal) * uBumpStrength);
        }`
            : ''
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `
        {
          vec3 nW = inverseTransformDirection(normal, viewMatrix);
          ${
            opts.caustics
              ? `
          float uwDepth = uWaterLevel - vWPos.y;
          if (uwDepth > 0.0) {
            float c = jCaustics(vWPos.xz * 0.95 + vec2(vWPos.y * 0.15), uTime * 0.9);
            float facing = clamp(nW.y * 0.75 + 0.25, 0.0, 1.0);
            float fade = exp(-uwDepth * 0.11) * smoothstep(0.0, 0.35, uwDepth);
            outgoingLight += uCausticColor * c * facing * fade * uCausticStrength * diffuseColor.rgb * 0.9;
          }`
              : ''
          }
          if (uRim > 0.0) {
            vec3 vdir = normalize(vViewPosition);
            float r = pow(1.0 - abs(dot(normal, -vdir)), 2.5);
            outgoingLight += diffuseColor.rgb * r * uRim;
          }
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () =>
    `jelly-${opts.key ?? ''}-${opts.caustics ? 1 : 0}-${sway ? (sway.instanced ? 2 : 1) : 0}-${opts.rim ? 1 : 0}-${opts.bump ? 1 : 0}`;
  return mat;
}
