import * as THREE from 'three';
import { CONFIG, randZ, zClamp } from '../config';
import { clamp, rand } from '../util/math';
import { taperedTube } from '../util/geometry';
import { GLSL_NOISE, shared } from '../util/shaders';
import type { WorldContext } from './types';
import { depthAt, towardDeep } from './shallows';

/**
 * Blue-spotted stingray: flat disc body with travelling wing undulation (vertex shader),
 * whip tail, slow graceful gliding between waypoints, occasionally leaving the view.
 */
export class Stingray {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3(6, -3.8, -0.8);
  private vel = new THREE.Vector3(0.6, 0, 0);
  private fwd = new THREE.Vector3(1, 0, 0);
  private target = new THREE.Vector3();
  private timer = 0;
  private away = 0;
  private phase = 0;
  private bank = 0;
  private fv = new THREE.Vector3();

  /** Poked / startled: bank away and glide off toward the other side. */
  /** The pointer rests on it: it veers off a little (no hurry). */
  nudge(from: THREE.Vector3) {
    const away = this.sTmp.copy(this.pos).sub(from).setY(0);
    if (away.lengthSq() < 1e-4) return;
    away.normalize();
    this.target.copy(this.pos).addScaledVector(away, 3.5);
    this.target.z = zClamp(this.target.z, 2);
    if (!this.placeTargetInBand(this.target)) this.pickTarget();
    this.timer = Math.max(this.timer, 6);
  }

  poke(from: THREE.Vector3) {
    const away = this.pos.clone().sub(from).setY(0).normalize();
    this.target.copy(this.pos).addScaledVector(away, 7);
    this.target.z = zClamp(this.target.z, 2);
    if (!this.placeTargetInBand(this.target)) this.pickTarget();
    this.timer = 10;
    this.vel.addScaledVector(away, 0.5);
  }

  /** Vertical swim band at (x, z): above the seabed, safely below the (wavy) surface. */
  private band(x: number, z: number) {
    const floor = this.ctx.terrain.heightAt(x, z) + 0.35;
    const ceil = this.ctx.water.heightAt(x, z) - 0.75;
    return { floor, ceil, deep: ceil - floor > 0.5 };
  }

  /** Puts target.y inside the swim band; returns false if the water there is too shallow. */
  private placeTargetInBand(t: THREE.Vector3) {
    const b = this.band(t.x, t.z);
    if (!b.deep) return false;
    t.y = clamp(b.floor + rand(0.3, 1.6), b.floor, b.ceil - 0.2);
    return true;
  }
  private uniforms = { uPhase: { value: 0 }, uAmp: { value: 0.06 } };
  private esc = { x: 0, z: 0, dist: 0 };
  private sDesired = new THREE.Vector3();
  private sAhead = new THREE.Vector3();
  private sPush = new THREE.Vector3();
  private sTmp = new THREE.Vector3();
  private sPrev = new THREE.Vector3();
  readonly radius = 0.75;
  private L = 1.35;
  private S = 0.95;

  constructor(private ctx: WorldContext) {
    const mesh = new THREE.Mesh(this.buildGeometry(), this.buildMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.pickTarget();
  }

  reset() {
    this.pos.set(6, -3.8, -0.8);
    this.vel.set(0.6, 0, 0);
    this.fwd.set(1, 0, 0);
    this.away = 0;
    this.pickTarget();
  }

  private buildGeometry() {
    const L = this.L,
      S = this.S;
    const nu = 44,
      nv = 34;
    const pos: number[] = [],
      uv: number[] = [],
      idx: number[] = [];
    // rounded-rhombic disc: blunt rounded snout, widest a little behind the eyes, soft wingtips
    const half = (u: number) => {
      const a = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.72);
      return S * a * (1 - 0.18 * u) + 0.015;
    };
    const thick = (u: number, v: number) => {
      const body = Math.pow(Math.max(0, 1 - v * v), 1.6);
      const ridge = 0.035 * L * Math.exp(-Math.pow(v / 0.18, 2)) * Math.sin(Math.PI * Math.min(1, u * 1.1));
      return 0.1 * L * body * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02)), 0.55) + ridge;
    };
    for (const side of [1, -1]) {
      const base = pos.length / 3;
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const x = L * (0.5 - u);
        const w = half(u) * (u < 0.06 ? Math.sqrt(u / 0.06) : 1);
        for (let j = 0; j <= nv; j++) {
          const v = -1 + (2 * j) / nv;
          const z = v * w;
          // slightly drooping wing margins
          const droop = -0.025 * L * Math.pow(Math.abs(v), 3);
          const y = (side > 0 ? thick(u, v) : -thick(u, v) * 0.35) + droop;
          pos.push(x, y, z);
          uv.push(side > 0 ? u * 0.9 : 0.97, side > 0 ? (v + 1) / 2 : 0.5);
        }
      }
      for (let i = 0; i < nu; i++)
        for (let j = 0; j < nv; j++) {
          const a2 = base + i * (nv + 1) + j,
            b2 = a2 + nv + 1;
          if (side > 0) idx.push(a2, b2, a2 + 1, a2 + 1, b2, b2 + 1);
          else idx.push(a2, a2 + 1, b2, a2 + 1, b2 + 1, b2);
        }
    }
    const body = new THREE.BufferGeometry();
    body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    body.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    body.setIndex(idx);
    body.computeVertexNormals();
    // tail: thick base tapering to a whip, with a small dorsal sting
    const tailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-L * 0.42, 0.03, 0),
      new THREE.Vector3(-L * 0.8, 0.015, 0),
      new THREE.Vector3(-L * 1.2, -0.005, 0),
      new THREE.Vector3(-L * 1.65, 0.0, 0),
    ]);
    const tail = taperedTube(tailCurve, 36, 8, (t) => 0.045 * Math.pow(1 - t, 1.6) + 0.0025, 1, true);
    tail.scale(1, 0.8, 1);
    const tUv = tail.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < tUv.count; i++) tUv.setXY(i, 0.93, 0.15 + (tUv.getX(i) > 0.5 ? 0.5 : 0) + 0.2);
    const sting = new THREE.ConeGeometry(0.008, 0.16, 5);
    sting.rotateZ(Math.PI / 2 + 0.25);
    sting.translate(-L * 0.95, 0.04, 0);
    const sUv = sting.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < sUv.count; i++) sUv.setXY(i, 0.95, 0.95);
    // pelvic fins: small lobes either side of the tail base
    const pelvics: THREE.BufferGeometry[] = [];
    for (const sd of [-1, 1]) {
      const pg = new THREE.CircleGeometry(0.11, 10, 0, Math.PI);
      pg.rotateX(-Math.PI / 2);
      pg.scale(1.3, 1, 0.7);
      pg.rotateY(sd > 0 ? -0.4 : Math.PI + 0.4);
      pg.translate(-L * 0.42, 0.0, sd * 0.07);
      const pu = pg.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < pu.count; i++) pu.setXY(i, 0.86, 0.5 + sd * 0.1);
      pelvics.push(pg);
    }
    // raised eyes and spiracles behind them
    const eyes: THREE.BufferGeometry[] = [];
    for (const sd of [-1, 1]) {
      const e = new THREE.SphereGeometry(0.05, 12, 10);
      e.scale(1.25, 0.75, 1);
      e.translate(L * 0.27, 0.085, sd * 0.11);
      const eu = e.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < eu.count; i++) eu.setXY(i, 0.995, 0.95);
      eyes.push(e);
      const sp = new THREE.SphereGeometry(0.03, 10, 8);
      sp.scale(1.3, 0.35, 1);
      sp.translate(L * 0.19, 0.088, sd * 0.13);
      const su = sp.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < su.count; i++) su.setXY(i, 0.995, 0.95);
      eyes.push(sp);
    }
    const parts = [body, tail, sting, ...pelvics, ...eyes].map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      if (!n.attributes.normal) n.computeVertexNormals();
      return n;
    });
    return mergeSimple(parts);
  }

  private buildMaterial() {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 512;
    const g = c.getContext('2d')!;
    // dorsal: warm olive-tan with darker margin and a darker spine line
    const W = 920;
    const grd = g.createRadialGradient(W * 0.42, 256, 20, W * 0.45, 256, 480);
    grd.addColorStop(0, '#b29a66');
    grd.addColorStop(0.55, '#9a8252');
    grd.addColorStop(1, '#5a4828');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, 512);
    g.fillStyle = 'rgba(60,45,25,0.35)';
    g.fillRect(0, 246, W, 20);
    // electric-blue spots with dark halos, denser toward the edges
    for (let i = 0; i < 360; i++) {
      const x = rand(40, W - 20),
        y = rand(14, 498);
      const edge = Math.abs(y - 256) / 256;
      if (Math.random() > 0.35 + edge * 0.65) continue;
      const r = rand(4, 11) * (1 - edge * 0.3);
      g.fillStyle = 'rgba(20,40,70,0.5)';
      g.beginPath();
      g.arc(x, y, r + 2.5, 0, Math.PI * 2);
      g.fill();
      const sg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      sg.addColorStop(0, '#9fe4ff');
      sg.addColorStop(0.5, '#2fa8f0');
      sg.addColorStop(1, '#1868c0');
      g.fillStyle = sg;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // fine mottling
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,30,15' : '200,180,140'},${rand(0.04, 0.1)})`;
      g.fillRect(rand(0, W), rand(0, 512), 3, 3);
    }
    // belly (cream), tail with two blue stripes, pelvic fins, eyes / sting
    g.fillStyle = '#efe9dc';
    g.fillRect(970, 0, 54, 512);
    g.fillStyle = '#5a4628';
    g.fillRect(930, 0, 30, 512);
    g.fillStyle = '#2f9fe8';
    g.fillRect(930, 300, 30, 40);
    g.fillRect(930, 400, 30, 40);
    g.fillStyle = '#8a7448';
    g.fillRect(870, 0, 30, 512);
    g.fillStyle = '#121212';
    g.fillRect(1010, 0, 14, 40);
    g.fillStyle = '#d8d0b8';
    g.fillRect(960, 470, 50, 42);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.4, side: THREE.DoubleSide });
    const L = this.L,
      S = this.S;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared, this.uniforms, { uL: { value: L }, uS: { value: S } });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uPhase; uniform float uAmp; uniform float uL; uniform float uS; varying vec3 vWPos;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            float u = clamp((uL * 0.5 - position.x) / uL, 0.0, 1.0);
            float span = clamp(abs(position.z) / uS, 0.0, 1.0);
            float wing = sin(uPhase - u * 4.2) * pow(span, 1.35);
            transformed.y += wing * uAmp * uS * 1.6;
            transformed.y += sin(uPhase * 0.5) * uAmp * 0.3 * pow(span, 2.0);
            if (position.x < -uL * 0.42) {
              float tt = (-position.x - uL * 0.42) / (uL * 1.25);
              transformed.z += sin(uPhase * 0.6 - tt * 4.0) * 0.06 * tt;
              transformed.y += sin(uPhase * 0.6 - tt * 3.0) * 0.03 * tt;
            }
          }`,
        )
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nvarying vec3 vWPos; uniform float uTime; uniform float uWaterLevel; uniform float uCausticStrength; uniform vec3 uCausticColor;\n${GLSL_NOISE}`,
        )
        .replace(
          '#include <opaque_fragment>',
          `{ vec3 nW = inverseTransformDirection(normal, viewMatrix);
             float uw = uWaterLevel - vWPos.y;
             float c = jCaustics(vWPos.xz * 0.95, uTime * 0.9);
             outgoingLight += uCausticColor * c * clamp(nW.y, 0.0, 1.0) * exp(-uw * 0.12) * uCausticStrength * diffuseColor.rgb;
           }
           #include <opaque_fragment>`,
        );
    };
    mat.customProgramCacheKey = () => 'stingray2';
    return mat;
  }

  get label() {
    return this.away > 0 ? 'Out of view' : 'Gliding';
  }
  active = true;

  private pickTarget() {
    const vis = this.ctx.visibleX;
    if (Math.random() < 0.22) {
      // V2: an excursion out of the home frame. The tray is visible beyond it now (panned Focus,
      // Full View), so the ray really glides out over the open sand / quiet water and comes back
      // instead of vanishing at the frame edge.
      const side = this.pos.x < 4 ? -1 : 1;
      const far = Math.min(CONFIG.world.xMax - 5, Math.max(-vis.min, vis.max) + rand(6, 20));
      this.target.set(side * far, 0, randZ(2, 1.2));
      if (side < 0 || !this.placeTargetInBand(this.target)) {
        // the left is the shallow lagoon: go right instead
        this.target.x = far;
        if (!this.placeTargetInBand(this.target)) this.target.y = this.ctx.water.level - 2.5;
      }
      this.timer = 55; // long enough to actually glide out of view
      return;
    }
    for (let i = 0; i < 16; i++) {
      this.target.set(rand(-1, 16), 0, randZ(1.8, 1.2));
      // needs real depth for a ray: skip the lagoon shelf and shallows
      if (this.ctx.water.level - this.ctx.terrain.heightAt(this.target.x, this.target.z) < 2.2) continue;
      if (this.placeTargetInBand(this.target)) {
        this.timer = rand(9, 18);
        return;
      }
    }
    this.target.set(rand(3, 11), this.ctx.water.level - 3, rand(-3, 3));
    this.placeTargetInBand(this.target);
    this.timer = rand(9, 18);
  }

  update(dt: number, time: number) {
    const vis = this.ctx.visibleX;
    if (this.away > 0) {
      this.away -= dt;
      if (this.away <= 0) {
        this.pickTarget();
        // re-enter from the edge it left, at a depth that is safe right there
        const b = this.band(this.pos.x, this.pos.z);
        this.pos.y = clamp(this.pos.y, b.floor, Math.max(b.floor, b.ceil));
        this.timer = 16;
      } else return;
    }
    this.timer -= dt;
    if (this.timer <= 0 || this.pos.distanceTo(this.target) < 1.0) this.pickTarget();
    void vis;
    const cruise = 0.62;
    // the tide may have made the current target unsafe
    if (!this.band(this.target.x, this.target.z).deep) this.pickTarget();
    // (scratch vectors: this runs every frame)
    const desired = this.sDesired.copy(this.target).sub(this.pos).normalize().multiplyScalar(cruise);
    // obstacles: one bounded steering push (mostly sideways, only a little upward)
    const ahead = this.sAhead.copy(this.pos).addScaledVector(this.fwd, 1.4);
    const push = this.sPush.set(0, 0, 0);
    for (const o of this.ctx.obstacles()) {
      const d = ahead.distanceTo(o.center);
      const r = o.radius + 1.0;
      if (d < r) push.add(this.sTmp.copy(ahead).sub(o.center).setY(0).normalize().multiplyScalar((r - d) / r));
    }
    if (push.lengthSq() > 0) {
      push.clampLength(0, 1).multiplyScalar(0.6);
      desired.add(push);
      desired.y += 0.15 * push.length();
    }
    // shallow water ahead (island slope, lagoon, low tide): turn back toward deep water
    const here = this.band(this.pos.x, this.pos.z);
    const front = this.band(ahead.x, ahead.z);
    if (!front.deep) {
      const e = 0.6;
      const gx = this.ctx.terrain.heightAt(ahead.x + e, ahead.z) - this.ctx.terrain.heightAt(ahead.x - e, ahead.z);
      const gz = this.ctx.terrain.heightAt(ahead.x, ahead.z + e) - this.ctx.terrain.heightAt(ahead.x, ahead.z - e);
      desired.x -= gx * 2 + this.fwd.x * 0.8;
      desired.z -= gz * 2;
      if (!this.band(this.target.x, this.target.z).deep || this.target.distanceTo(this.pos) < 4) this.pickTarget();
    }
    // keep inside the vertical band: soft push near the floor and (stronger) near the surface
    const floor = Math.max(here.floor, front.floor);
    const ceil = Math.min(here.ceil, front.ceil);
    if (this.pos.y < floor + 0.35) desired.y += Math.min(0.5, (floor + 0.35 - this.pos.y) * 1.5);
    if (this.pos.y > ceil - 0.5) desired.y -= 0.4 + (this.pos.y - (ceil - 0.5)) * 2.5;
    desired.z -= this.pos.z * 0.02;
    if (this.ctx.flow.active) {
      const fl = this.ctx.flow.velocityAt(this.pos.x, this.pos.y, this.pos.z, this.fv);
      desired.x += fl.x * 0.9;
      desired.z += fl.z * 0.9;
      desired.y += fl.y * 0.3;
    }
    // rays glide nearly level: limit climb / dive rate
    desired.y = clamp(desired.y, -0.45, 0.3);
    // slow turning
    this.vel.lerp(desired, Math.min(1, dt * 0.55));
    const sp = this.vel.length();
    if (sp > 1e-3) {
      const want = this.sTmp.copy(this.vel).divideScalar(sp);
      const prev = this.sPrev.copy(this.fwd);
      const ang = this.fwd.angleTo(want);
      const maxA = 0.55 * dt;
      if (ang > maxA) this.fwd.lerp(want, maxA / ang).normalize();
      else this.fwd.copy(want);
      const yawRate = (prev.x * this.fwd.z - prev.z * this.fwd.x) / Math.max(dt, 1e-3);
      this.bank += (clamp(-yawRate * 0.9, -0.5, 0.5) - this.bank) * Math.min(1, dt * 2);
    }
    this.pos.addScaledVector(this.fwd, Math.max(0.3, sp) * dt);
    this.pos.z = zClamp(this.pos.z, 1.2);
    // the water got too shallow here (sea level / tide dropped): glide off toward deep water
    if (depthAt(this.ctx, this.pos.x, this.pos.z) < 0.7 && towardDeep(this.ctx, this.pos.x, this.pos.z, 1.4, this.esc)) {
      const e = this.esc;
      const step = depthAt(this.ctx, this.pos.x, this.pos.z) < 0.1 ? e.dist : Math.min(e.dist, 1.6 * dt);
      this.pos.x += e.x * step;
      this.pos.z += e.z * step;
      this.fwd.lerp(this.fv.set(e.x, 0, e.z), Math.min(1, dt * 1.5)).normalize();
      if (!this.band(this.target.x, this.target.z).deep) this.pickTarget();
    }
    // hard limits: never above the surface band (wins over the floor in very shallow water)
    const b = this.band(this.pos.x, this.pos.z);
    if (this.pos.y < b.floor - 0.1) this.pos.y = b.floor - 0.1;
    if (this.pos.y > b.ceil) {
      this.pos.y = b.ceil;
      if (this.fwd.y > 0) {
        this.fwd.setY(0);
        if (this.fwd.lengthSq() < 0.01) this.fwd.set(1, 0, 0);
        this.fwd.normalize();
      }
      if (this.vel.y > 0) this.vel.y = 0;
    }
    // glide: wing beat strength cycles
    const beat = 0.6 + 0.4 * Math.sin(time * 0.35);
    this.phase += dt * (2.2 + beat * 1.2);
    this.uniforms.uPhase.value = this.phase;
    this.uniforms.uAmp.value = 0.05 + beat * 0.035;
    // orientation
    const X = this.fwd.clone();
    X.y *= 0.5;
    X.normalize();
    const Z = new THREE.Vector3().crossVectors(X, new THREE.Vector3(0, 1, 0)).normalize();
    const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
    const m = new THREE.Matrix4().makeBasis(X, Y, Z);
    this.group.quaternion.setFromRotationMatrix(m);
    this.group.rotateX(this.bank);
    this.group.position.copy(this.pos);
    this.group.visible = this.away <= 0;
  }
}

function mergeSimple(parts: THREE.BufferGeometry[]) {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3),
    nor = new Float32Array(n * 3),
    uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    uv.set(p.attributes.uv.array as Float32Array, o * 2);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

export { mergeSimple };
