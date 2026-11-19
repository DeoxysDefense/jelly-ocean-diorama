import * as THREE from 'three';
import { CONFIG } from '../config';
import { WaterSurfaceSimulation } from './WaterSurfaceSimulation';
import { WaveField, WAVE_COUNT } from './WaveField';
import { WaterColorController } from './WaterColor';
import type { RenderPipeline } from '../core/RenderPipeline';
import type { CameraManager } from '../core/CameraManager';
import type { AtmosphereState } from '../world/Atmosphere';

/**
 * Builds and shades the jelly water volume.
 *
 * Geometry: a grid swept along x with a cross-section profile of
 *   front face -> rounded front bevel -> top surface -> rounded back bevel -> back lip.
 * Each vertex carries a weight describing how strongly it follows the surface height, so the
 * upper part of the front face wobbles with waves like a soft resin/jelly block.
 */
export class OceanRenderer {
  readonly waterMesh: THREE.Mesh;
  readonly worldGroup = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  private backMat: THREE.ShaderMaterial;
  private rayMat: THREE.ShaderMaterial;

  constructor(
    private sim: WaterSurfaceSimulation,
    private colors: WaterColorController,
    pipeline: RenderPipeline,
    private cam: CameraManager,
  ) {
    const W = CONFIG.world;
    const r = CONFIG.water.bevelRadius;
    // V2: the east deep water goes down to about -11, so the front face reaches lower than v1's -9.8
    const geo = buildWaterGeometry(W.xMin, W.xMax, W.zBack, W.zFront, r, W.bottomY + 0.6);

    const camDir = new THREE.Vector3();
    cam.camera.getWorldDirection(camDir);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSceneColor: { value: pipeline.rtScene.texture },
        uSceneDepth: { value: pipeline.rtScene.depthTexture },
        uResolution: { value: pipeline.resolution },
        uNear: { value: cam.camera.near },
        uFar: { value: cam.camera.far },
        uHeightTex: { value: sim.texture },
        uSimMin: { value: new THREE.Vector2(sim.x0, sim.z0) },
        uSimSize: { value: new THREE.Vector2(sim.sizeX, sim.sizeZ) },
        uSimRes: { value: new THREE.Vector2(sim.nx, sim.nz) },
        uWaveA: { value: Array.from(sim.waves.amps) },
        uWaveP: { value: Array.from(sim.waves.phases) },
        uShallow: { value: colors.current.shallow },
        uDeep: { value: colors.current.deep },
        uAbsorb: { value: colors.current.absorb },
        uDepthTint: { value: colors.current.depthTint },
        uDensity: { value: 1 },
        uViewDir: { value: camDir.clone().negate() },
        uSunDir: { value: new THREE.Vector3(-0.38, 0.78, 0.5).normalize() },
        uSunColor: { value: new THREE.Color(1.0, 0.96, 0.88) },
        uSkyTop: { value: new THREE.Color('#5aa9e6') },
        uSkyHorizon: { value: new THREE.Color('#d9eef7') },
        uRefract: { value: CONFIG.water.refraction },
        uTime: { value: 0 },
        uTopBlend: { value: 0 },
        uLight: { value: 1 },
        uLevel: { value: 0 },
        uSimTime: { value: 0 },
        uRip: { value: Array.from({ length: WaterSurfaceSimulation.RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0)) },
      },
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      side: THREE.FrontSide,
    });
    this.waterMesh = new THREE.Mesh(geo, this.material);
    this.waterMesh.frustumCulled = false;
    this.waterMesh.renderOrder = 10;

    // Back wall: gives the far side of the slab a controllable deep-water gradient.
    this.backMat = new THREE.ShaderMaterial({
      uniforms: {
        uShallow: { value: colors.current.shallow },
        uDeep: { value: colors.current.deep },
        uTime: { value: 0 },
        uLight: { value: 1 },
      },
      vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uShallow; uniform vec3 uDeep; uniform float uTime; uniform float uLight; varying vec3 vP;
        void main(){
          float t = clamp(-vP.y / 8.0, 0.0, 1.0);
          vec3 c = mix(uShallow * 0.95, uDeep * 0.55, pow(t, 0.7));
          float rays = 0.0;
          for (int i = 0; i < 3; i++){
            float fi = float(i);
            rays += pow(0.5 + 0.5 * sin(vP.x * (0.35 + fi * 0.21) + vP.y * 0.28 + uTime * (0.12 + fi * 0.05) + fi * 2.1), 6.0);
          }
          c += uShallow * rays * 0.06 * (1.0 - t);
          gl_FragColor = vec4(c * uLight, 1.0);
        }`,
    });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W.xMax - W.xMin, 12), this.backMat);
    back.position.set(0, -6.05, W.zBack - 0.06);
    this.worldGroup.add(back);

    // Soft god rays inside the water (rendered in the world pass, so the water tints them).
    this.rayMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uStrength: { value: 0.11 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `varying vec2 vUv; varying float vSeed; attribute float aSeed;
        void main(){ vUv = uv; vSeed = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uStrength; varying vec2 vUv; varying float vSeed;
        void main(){
          float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
          float fall = pow(vUv.y, 1.6);
          float flick = 0.55 + 0.45 * sin(uTime * (0.35 + vSeed * 0.3) + vSeed * 12.0);
          float a = edge * fall * flick * uStrength;
          gl_FragColor = vec4(vec3(0.85, 1.0, 0.95) * a, 1.0);
        }`,
    });
    const rays = new THREE.Group();
    const rayDefs = [
      [-1.5, 1.6, -2.4],
      [2.6, 1.1, 1.5],
      [6.2, 1.9, -3.5],
      [10.5, 1.3, 0.5],
      [-13.5, 1.2, -1.4],
      [14.5, 1.6, -4.0],
      [4.5, 1.4, 3.6],
    ];
    rayDefs.forEach(([x, w, z], i) => {
      const g = new THREE.PlaneGeometry(w, 7.5, 1, 1);
      g.translate(0, -3.75, 0);
      const seed = new Float32Array(4).fill(i / rayDefs.length);
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      const m = new THREE.Mesh(g, this.rayMat);
      m.position.set(x, -0.1, z);
      m.rotation.z = 0.32;
      m.renderOrder = 5;
      rays.add(m);
    });
    this.worldGroup.add(rays);
  }

  /** Day / night and tide: sky reflection colours, light level, sea level offset. */
  applyAtmosphere(atm: AtmosphereState, level: number) {
    const u = this.material.uniforms;
    u.uSkyTop.value.copy(atm.skyTop);
    u.uSkyHorizon.value.copy(atm.skyHorizon);
    u.uSunColor.value.copy(atm.lightColor).multiplyScalar(Math.min(1, atm.lightIntensity / 2.7) * (1 - atm.rain * 0.6) + 0.15 * atm.night);
    u.uSunDir.value.copy(atm.lightDir);
    u.uLight.value = atm.light;
    u.uLevel.value = level;
    this.backMat.uniforms.uLight.value = atm.light;
    this.waterMesh.position.y = level;
    this.worldGroup.position.y = level;
    this.dayFactor = atm.day * (1 - atm.rain * 0.7);
  }
  private dayFactor = 1;

  update(dt: number, time: number, ambient: boolean, topBlend = 0) {
    const u = this.material.uniforms;
    u.uSimTime.value = this.sim.time;
    const R = this.sim.ripples;
    const rip = u.uRip.value as THREE.Vector4[];
    for (let i = 0; i < rip.length; i++) rip[i].set(R[i * 4], R[i * 4 + 1], R[i * 4 + 2], R[i * 4 + 3]);
    this.cam.camera.getWorldDirection(u.uViewDir.value).negate();
    const amps = u.uWaveA.value as number[];
    const phs = u.uWaveP.value as number[];
    for (let i = 0; i < WAVE_COUNT; i++) {
      amps[i] = this.sim.waves.amps[i];
      phs[i] = this.sim.waves.phases[i];
    }
    u.uDensity.value = this.colors.current.density;
    u.uTime.value = time;
    u.uTopBlend.value = topBlend;
    this.backMat.uniforms.uTime.value = time;
    this.rayMat.uniforms.uTime.value = time;
    this.rayMat.uniforms.uStrength.value = (ambient ? 0.08 : 0.11) * (1 - topBlend) * this.dayFactor;
  }
}

function buildWaterGeometry(x0: number, x1: number, zB: number, zF: number, r: number, yBottom: number) {
  type P = { y: number; z: number; ny: number; nz: number; w: number; kind: number; depth: number };
  const prof: P[] = [];
  // Front face: denser rows near the surface.
  const frontYs = [yBottom, -9.8, -7.5, -5.5, -4, -3, -2.4, -2.0, -1.7, -1.45, -1.25, -1.08, -0.94, -0.82];
  for (const y of frontYs) {
    prof.push({ y, z: zF, ny: 0, nz: 1, w: Math.exp((y + r) / 1.35), kind: 0, depth: -y });
  }
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 0.5;
    prof.push({
      y: -r + r * Math.sin(a),
      z: zF - r + r * Math.cos(a),
      ny: Math.sin(a),
      nz: Math.cos(a),
      w: 1,
      kind: 1,
      depth: Math.max(0, r - r * Math.sin(a)),
    });
  }
  const topSteps = Math.round((zF - zB) / 0.26);
  for (let i = 1; i < topSteps; i++) {
    const z = zF - r - (i / topSteps) * (zF - zB - 2 * r);
    prof.push({ y: 0, z, ny: 1, nz: 0, w: 1, kind: 2, depth: 0 });
  }
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI * 0.5 + (i / 6) * Math.PI * 0.5;
    prof.push({ y: -r + r * Math.sin(a), z: zB + r + r * Math.cos(a), ny: Math.sin(a), nz: Math.cos(a), w: 1, kind: 2, depth: 0 });
  }
  prof.push({ y: -1.6, z: zB, ny: 0, nz: -1, w: 0.2, kind: 2, depth: 0 });

  // Columns along x: the straight body plus rounded end caps. Near each end the profile is
  // eroded along its own normal by r·(1 − cos a) while x follows a quarter circle, so the block
  // closes with the same soft bevel as the front edge (seen in Full / Top View).
  const body = Math.round((x1 - x0 - 2 * r) * 6);
  const capSteps = 8;
  const cols: { x: number; a: number; side: number }[] = [];
  for (let i = capSteps; i >= 1; i--) cols.push({ x: x0 + r - r * Math.sin((i / capSteps) * Math.PI * 0.5), a: (i / capSteps) * Math.PI * 0.5, side: -1 });
  for (let i = 0; i <= body; i++) cols.push({ x: x0 + r + (i / body) * (x1 - x0 - 2 * r), a: 0, side: 0 });
  for (let i = 1; i <= capSteps; i++) cols.push({ x: x1 - r + r * Math.sin((i / capSteps) * Math.PI * 0.5), a: (i / capSteps) * Math.PI * 0.5, side: 1 });
  const NX = cols.length;
  const P = prof.length;
  const pos = new Float32Array(NX * P * 3);
  const nor = new Float32Array(NX * P * 3);
  const wgt = new Float32Array(NX * P);
  const kind = new Float32Array(NX * P);
  const dep = new Float32Array(NX * P);
  for (let i = 0; i < NX; i++) {
    const c = cols[i];
    const d = r * (1 - Math.cos(c.a)),
      ca = Math.cos(c.a),
      sa = Math.sin(c.a) * c.side;
    for (let j = 0; j < P; j++) {
      const k = i * P + j;
      const p = prof[j];
      pos.set([c.x, p.y - p.ny * d, p.z - p.nz * d], k * 3);
      nor.set([sa, p.ny * ca, p.nz * ca], k * 3);
      wgt[k] = p.w;
      kind[k] = p.kind;
      dep[k] = p.depth + p.ny * d;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < NX - 1; i++)
    for (let j = 0; j < P - 1; j++) {
      const a = i * P + j,
        b = (i + 1) * P + j,
        c = a + 1,
        d = b + 1;
      idx.push(a, b, c, c, b, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aWeight', new THREE.BufferAttribute(wgt, 1));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  g.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
  g.setIndex(idx);
  return g;
}

/** Micro-ripple ring packets (must match WaterSurfaceSimulation.rippleHeight). Returns h, dh/dx, dh/dz. */
const RIPPLE_GLSL = /* glsl */ `
vec3 ripples(vec2 p){
  vec3 o = vec3(0.0);
  for (int i = 0; i < ${WaterSurfaceSimulation.RIPPLES}; i++){
    vec4 r = uRip[i];
    float age = uSimTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 2.6) continue;
    vec2 d = p - r.xy;
    float dist = length(d) + 1e-4;
    float f = dist - 1.5 * age;
    if (f * f > 0.6) continue;
    float env = r.w * exp(-age * 1.5) * exp(-(f * f) / 0.09);
    float h = env * cos(f * 13.0);
    float dh = env * (-2.0 * f / 0.09 * cos(f * 13.0) - 13.0 * sin(f * 13.0));
    o += vec3(h, dh * d / dist);
  }
  return o;
}`;

const WATER_VERT = /* glsl */ `
attribute float aWeight;
attribute float aKind;
attribute float aDepth;
uniform sampler2D uHeightTex;
uniform vec2 uSimMin, uSimSize, uSimRes;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vDepthBelow;
varying float vKind;
varying float vSurfH;
uniform vec4 uRip[${WaterSurfaceSimulation.RIPPLES}];
uniform float uSimTime;
${WaveField.glsl()}
${RIPPLE_GLSL}
float simH(vec2 p){
  vec2 uv = clamp((p - uSimMin) / uSimSize, 0.0, 1.0);
  uv = (uv * (uSimRes - 1.0) + 0.5) / uSimRes;
  return texture2D(uHeightTex, uv).r;
}
void main(){
  vec3 p = position;
  vec2 sp = vec2(p.x, clamp(p.z, uSimMin.y, uSimMin.y + uSimSize.y));
  vec3 wf = waveField(sp);
  float e = 0.16;
  float hs = simH(sp);
  float hx = (simH(sp + vec2(e, 0.0)) - simH(sp - vec2(e, 0.0))) / (2.0 * e) + wf.y;
  float hz = (simH(sp + vec2(0.0, e)) - simH(sp - vec2(0.0, e))) / (2.0 * e) + wf.z;
  vec3 rp = ripples(sp);
  float h = hs + wf.x + rp.x;
  hx += rp.y; hz += rp.z;
  p.y += h * aWeight;
  vec3 n = normalize(normal + vec3(-hx, 0.0, -hz) * aWeight * 1.5);
  vNormalW = n;
  vDepthBelow = aDepth;
  vKind = aKind;
  vSurfH = h;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const WATER_FRAG = /* glsl */ `
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform vec2 uResolution;
uniform float uNear, uFar;
uniform vec3 uShallow, uDeep, uAbsorb, uDepthTint;
uniform float uDensity;
uniform vec3 uViewDir, uSunDir, uSunColor, uSkyTop, uSkyHorizon;
uniform float uRefract, uTime, uTopBlend, uLight;
uniform vec4 uRip[${WaterSurfaceSimulation.RIPPLES}];
uniform float uSimTime;
${RIPPLE_GLSL}
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vDepthBelow;
varying float vKind;
varying float vSurfH;

// fine capillary ripples (analytic gradient of two scrolling wave sets)
vec2 microGrad(vec2 p, float t){
  vec2 g = vec2(0.0);
  g += vec2(1.0, 0.35) * cos(dot(p, vec2(3.1, 1.1)) + t * 1.7) * 0.5;
  g += vec2(-0.4, 1.0) * cos(dot(p, vec2(-1.3, 3.7)) + t * 1.3) * 0.4;
  g += vec2(0.8, -0.9) * cos(dot(p, vec2(5.3, -4.9)) - t * 2.3) * 0.25;
  g += vec2(0.2, 1.0) * cos(dot(p, vec2(0.9, 7.3)) + t * 2.9) * 0.18;
  return g;
}

float viewZ(float d){ return d * (uNear - uFar) - uNear; }

void main(){
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 N = normalize(vNormalW);
  float surfaceK = step(0.5, vKind);
  vec2 mg = microGrad(vWorldPos.xz, uTime);
  vec3 rg = ripples(vWorldPos.xz);
  N = normalize(N + vec3(mg.x * 0.06 - rg.y, 0.0, mg.y * 0.06 - rg.z) * surfaceK * N.y);
  vec3 V = normalize(uViewDir);
  float fragZ = viewZ(gl_FragCoord.z);

  // --- Refraction (screen-space, rejects samples in front of the water) ---
  vec3 nV = normalize((viewMatrix * vec4(N, 0.0)).xyz);
  float sceneZ0 = viewZ(texture2D(uSceneDepth, uv).r);
  float thick0 = clamp(fragZ - sceneZ0, 0.0, 9.0);
  float wob = sin(vWorldPos.x * 1.3 + uTime * 0.7) * sin(vWorldPos.y * 1.1 - uTime * 0.5);
  vec2 off = (nV.xy * uRefract + vec2(wob, -wob) * 0.0012) * clamp(thick0 * 0.6, 0.0, 1.0);
  vec2 ruv = clamp(uv - off, vec2(0.001), vec2(0.999));
  float rz = viewZ(texture2D(uSceneDepth, ruv).r);
  if (rz > fragZ - 0.02) { ruv = uv; rz = sceneZ0; }
  float thick = clamp(fragZ - rz, 0.0, 9.0);
  vec3 behind = texture2D(uSceneColor, ruv).rgb;

  // --- Absorption & in-scattering (Beer–Lambert over real thickness) ---
  float depthF = clamp(vDepthBelow / 7.2, 0.0, 1.0);
  vec3 T = exp(-uAbsorb * uDensity * thick * mix(1.0, 0.5, uTopBlend));
  vec3 scatter = mix(uShallow, uDeep, pow(depthF, 0.75)) * uLight;
  vec3 lightAtt = mix(vec3(1.0), uDepthTint, smoothstep(0.0, 1.0, depthF) * 0.6);
  vec3 col = behind * T * lightAtt + scatter * (1.0 - T);
  // slight resin body tint
  col = mix(col, scatter, (0.05 + 0.06 * depthF) * (1.0 - 0.6 * uTopBlend));

  // --- Fresnel reflection of the sky ---
  float NdV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.035 + 0.965 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSkyHorizon, uSkyTop, clamp(R.y * 1.3, 0.0, 1.0));
  // softer reflection on the top face so the water reads as a clear jelly, not a lid
  col = mix(col, sky, clamp(F, 0.0, 0.9) * mix(0.85, 0.5, surfaceK));

  // --- Sun specular (sharp glint + soft sheen) ---
  vec3 H = normalize(uSunDir + V);
  float NdH = max(dot(N, H), 0.0);
  col += uSunColor * (pow(NdH, 260.0) * 2.2 + pow(NdH, 40.0) * 0.12);

  // --- Jelly rim: soft inner glow just under the surface line on the front face ---
  float isFront = 1.0 - step(0.5, vKind);
  float rim = exp(-vDepthBelow * 4.0);
  col += (uShallow * 0.45 + vec3(0.06)) * rim * 0.38 * (isFront + step(0.5, vKind) * (1.0 - step(1.5, vKind)));
  // thin bright lip where the bevel meets the top
  float lip = (1.0 - step(1.5, vKind)) * step(0.5, vKind) * pow(1.0 - abs(N.y - 0.7) / 0.7, 6.0);
  col += vec3(0.9, 1.0, 1.0) * lip * 0.08;
  // crest highlight when the surface is lifted
  col += uShallow * clamp(vSurfH * 0.6, 0.0, 0.25) * (1.0 - isFront * (1.0 - rim));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
