import * as THREE from 'three';
import { zClamp } from '../config';
import { clamp, damp, rand } from '../util/math';
import { fbm3 } from '../util/noise';
import { lathe } from '../util/geometry';
import { GLSL_NOISE, patchMaterial, shared } from '../util/shaders';
import type { WorldContext } from './types';

export type OctoState = 'hidden' | 'peek' | 'crawl' | 'explore' | 'buried' | 'retreat';

const ARMS = 8;

/**
 * Octopus with eight procedurally bent arms (constant-curvature arcs + travelling wave,
 * evaluated in the vertex shader). Behaviour FSM:
 *   hidden (in coral / den) → peek → crawl ↔ explore → buried (camouflaged in sand)
 *   any → retreat (jet to a hiding spot, ink puff) when disturbed.
 */
export class Octopus {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  state: OctoState = 'hidden';
  private body = new THREE.Group();
  private mantle: THREE.Mesh;
  private skin: THREE.MeshStandardMaterial;
  private armUniforms = {
    uCurl: { value: new Array(ARMS).fill(3) },
    uLift: { value: new Array(ARMS).fill(0) },
    uAng: { value: new Array(ARMS).fill(0) },
    uLen: { value: new Array(ARMS).fill(0.7) },
    uWave: { value: 0.3 },
    uOT: { value: 0 },
  };
  private curl = new Float32Array(ARMS).fill(5);
  private lift = new Float32Array(ARMS).fill(0);
  private len = new Float32Array(ARMS).fill(0.5);
  private curlT = new Float32Array(ARMS);
  private liftT = new Float32Array(ARMS);
  private lenT = new Float32Array(ARMS);
  private yaw = 0;
  private yawT = 0;
  private timer = rand(6, 12);
  private target = new THREE.Vector3();
  private spot = new THREE.Vector3();
  private spotRef: THREE.Object3D | null = null;
  private spotRefPos = new THREE.Vector3();
  private exploreT = 0;
  private camo = 0;
  private annoy = 0;
  active = true;
  get label() {
    return (
      {
        hidden: this.spotRef ? 'Hiding in its cave' : 'Hiding in the den',
        peek: 'Peeking out',
        crawl: this.investigating ? 'Checking out a new cave' : 'Crawling',
        explore: 'Exploring',
        buried: 'Buried in the sand (camouflaged)',
        retreat: 'Retreating!',
      } as Record<OctoState, string>
    )[this.state];
  }
  /** Cave rocks it already knows about; new ones get explored. */
  private known = new Set<string>();
  private investigating: { ref: THREE.Object3D; p: THREE.Vector3 } | null = null;
  private exploreCheck = 3;
  private sink = 0;
  private bodyScale = 0.7;
  private ink: THREE.Points;
  private inkLife = 0;
  private inkPos: Float32Array;
  private inkVel: Float32Array;
  readonly radius = 0.5;
  private baseColor = new THREE.Color(0xb0503a);
  private sandColor = new THREE.Color(0xd8c49a);
  /** Colour it blends toward when camouflaged (sand by default; the hiding spot in a game). */
  private camoColor = this.sandColor.clone();
  /**
   * Hide & Seek override. While set, the octopus ignores pokes, exploration and caves and plays
   * the game: crawl to the chosen spot, tuck in and camouflage, peek now and then, and react
   * when found. Cleared by gameEnd(), after which normal behaviour resumes.
   */
  private game: { phase: 'go' | 'hide' | 'found'; spot: THREE.Vector3; sink: number; t: number; peekT: number; peek: number; flash: number; glimpse: number } | null = null;

  constructor(private ctx: WorldContext) {
    this.skin = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, color: this.baseColor.clone(), roughness: 0.42 }), {
      caustics: true,
      rim: 0.3,
      bump: { scale: 30, strength: 0.5 },
      key: 'octo-skin2',
    });
    // mantle (head sac): bulbous, slightly pointed, wrinkled, with papillae
    const mg = lathe(
      [
        [0.001, -0.02],
        [0.14, 0.0],
        [0.2, 0.09],
        [0.225, 0.2],
        [0.205, 0.31],
        [0.15, 0.4],
        [0.07, 0.455],
        [0.001, 0.47],
      ],
      32,
      (a, t) => 1 + 0.035 * fbm3(Math.cos(a) * 2, t * 3, Math.sin(a) * 2, 2) + 0.02 * Math.sin(t * 40 + a * 3) * t,
    );
    paintSkin(mg);
    this.mantle = new THREE.Mesh(mg, this.skin);
    this.mantle.position.set(0, 0.12, -0.08);
    this.mantle.rotation.x = -0.65;
    this.mantle.castShadow = true;
    this.body.add(this.mantle);
    // head / eye region
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14).scale(1.05, 0.8, 0.95), this.skin);
    paintSkin(head.geometry);
    head.position.set(0, 0.1, 0.03);
    head.castShadow = true;
    this.body.add(head);
    // eye turrets with golden irises and the octopus' horizontal bar pupil
    const eyeMat = new THREE.MeshPhysicalMaterial({ map: octoEyeTexture(), roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 });
    for (const s of [-1, 1]) {
      const turret = new THREE.Mesh(new THREE.SphereGeometry(0.062, 14, 10).scale(1, 0.85, 1), this.skin);
      turret.position.set(s * 0.1, 0.19, 0.06);
      this.body.add(turret);
      const eg = new THREE.SphereGeometry(0.045, 18, 12);
      const ep = eg.attributes.position as THREE.BufferAttribute;
      const eu = eg.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < ep.count; i++) eu.setXY(i, 0.5 + (ep.getX(i) / 0.045) * 0.5, 0.5 + (ep.getY(i) / 0.045) * 0.5);
      eg.rotateY(s * 0.75);
      const e = new THREE.Mesh(eg, eyeMat);
      e.position.set(s * 0.115, 0.2, 0.095);
      this.body.add(e);
      // horn-like papillae above the eyes
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 6), this.skin);
      horn.position.set(s * 0.1, 0.255, 0.07);
      horn.rotation.z = -s * 0.3;
      this.body.add(horn);
    }
    // interbrachial web connecting the arm bases, and the siphon
    const web = lathe(
      [[0.04, 0.06], [0.12, 0.03], [0.2, 0.0], [0.24, -0.015]],
      40,
      (a, t) => 1 - 0.32 * t * (0.5 + 0.5 * Math.cos(a * 8)),
    );
    paintSkin(web);
    const webMesh = new THREE.Mesh(web, this.skin);
    webMesh.position.y = 0.035;
    webMesh.castShadow = true;
    this.body.add(webMesh);
    const siphon = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.08, 10, 1, true), this.skin);
    siphon.position.set(0.13, 0.1, -0.02);
    siphon.rotation.set(0.3, 0, 1.0);
    this.body.add(siphon);
    // arms (single merged geometry, bent in the vertex shader)
    const arms = new THREE.Mesh(buildArmGeometry(), this.makeArmMaterial());
    arms.castShadow = true;
    arms.frustumCulled = false;
    arms.position.y = 0.04;
    this.body.add(arms);
    this.group.add(this.body);

    // ink puff
    const n = 60;
    this.inkPos = new Float32Array(n * 3);
    this.inkVel = new Float32Array(n * 3);
    const ig = new THREE.BufferGeometry();
    ig.setAttribute('position', new THREE.BufferAttribute(this.inkPos, 3));
    this.ink = new THREE.Points(
      ig,
      new THREE.PointsMaterial({ color: 0x1a1420, size: 0.5, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true }),
    );
    this.ink.frustumCulled = false;
    this.ink.renderOrder = 7;

    this.chooseSpot(null);
    this.pos.copy(this.spot);
  }

  get inkObject() {
    return this.ink;
  }

  private makeSkin() {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, color: this.baseColor.clone(), roughness: 0.48 });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWPos; uniform float uTime; uniform float uWaterLevel; uniform float uCausticStrength; uniform vec3 uCausticColor;\n${GLSL_NOISE}`)
        .replace(
          '#include <opaque_fragment>',
          `{ vec3 nW = inverseTransformDirection(normal, viewMatrix);
             float c = jCaustics(vWPos.xz * 0.95, uTime * 0.9);
             outgoingLight += uCausticColor * c * clamp(nW.y, 0.0, 1.0) * exp(-(uWaterLevel - vWPos.y) * 0.12) * uCausticStrength * diffuseColor.rgb;
             vec3 vdir = normalize(vViewPosition);
             outgoingLight += diffuseColor.rgb * pow(1.0 - abs(dot(normal, -vdir)), 3.0) * 0.3; }
           #include <opaque_fragment>`,
        );
    };
    m.customProgramCacheKey = () => 'octo-skin';
    return m;
  }

  private makeArmMaterial() {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, color: this.baseColor.clone(), roughness: 0.5 });
    (this as any).armMat = m;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared, this.armUniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aArm; attribute float aS;
          uniform float uCurl[${ARMS}]; uniform float uLift[${ARMS}]; uniform float uAng[${ARMS}]; uniform float uLen[${ARMS}];
          uniform float uWave; uniform float uOT;
          varying vec3 vWPos;
          float armF(float arr[${ARMS}], int i){ for(int k=0;k<${ARMS};k++){ if(k==i) return arr[k]; } return 0.0; }`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `int ai = int(aArm + 0.5);
          float L = armF(uLen, ai);
          float s = aS * L;
          float k = armF(uCurl, ai) + uWave * 1.8 * sin(uOT * 1.7 + aArm * 1.9 - aS * 6.0);
          k = abs(k) < 0.01 ? 0.01 : k;
          float th0 = armF(uLift, ai);
          float th = th0 - k * s;
          vec2 c = vec2((sin(th0) - sin(th)) / k, (cos(th) - cos(th0)) / k);
          vec2 nrm = vec2(-sin(th), cos(th));
          vec3 armPos = vec3(c.x + nrm.x * position.y, c.y + nrm.y * position.y, position.z);
          armPos.z += sin(uOT * 2.1 + aArm * 2.7 - aS * 5.0) * 0.04 * aS * uWave;
          float ang = armF(uAng, ai);
          float ca = cos(ang), sa = sin(ang);
          armPos = vec3(ca * armPos.x - sa * armPos.z, armPos.y, sa * armPos.x + ca * armPos.z);
          vec3 bn = vec3(nrm.x * normal.y, nrm.y * normal.y, normal.z);
          vec3 objectNormal = normalize(vec3(ca * bn.x - sa * bn.z, bn.y, sa * bn.x + ca * bn.z));`,
        )
        .replace('#include <begin_vertex>', 'vec3 transformed = armPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWPos; uniform float uTime; uniform float uWaterLevel; uniform float uCausticStrength; uniform vec3 uCausticColor;\n${GLSL_NOISE}`)
        .replace(
          '#include <opaque_fragment>',
          `{ vec3 nW = inverseTransformDirection(normal, viewMatrix);
             float c = jCaustics(vWPos.xz * 0.95, uTime * 0.9);
             outgoingLight += uCausticColor * c * clamp(nW.y, 0.0, 1.0) * exp(-(uWaterLevel - vWPos.y) * 0.12) * uCausticStrength * diffuseColor.rgb; }
           #include <opaque_fragment>`,
        );
    };
    m.customProgramCacheKey = () => 'octo-arms';
    return m;
  }

  /** Picks a hiding spot (den or a coral), optionally avoiding a disturbance point. */
  private chooseSpot(avoid: THREE.Vector3 | null) {
    const reef = this.ctx.reef;
    const options: { p: THREE.Vector3; ref: THREE.Object3D | null; cave?: boolean }[] = reef
      .hidingSpotsDetailed()
      .map((o) => ({ p: o.p, ref: o.ref ? o.ref.object : null, cave: o.cave }));
    let best = options[0],
      bestScore = -Infinity;
    for (const o of options) {
      if (o.p.y > this.ctx.water.heightAt(o.p.x, o.p.z) - 1.2) continue;
      const dist = o.p.distanceTo(this.pos.lengthSq() > 0 ? this.pos : o.p);
      let score = -dist * 0.4 + rand(0, 1.2);
      if (avoid) score += Math.min(6, o.p.distanceTo(avoid)) * 0.8;
      if (o.ref === null) score += 0.6; // the den is a favourite
      if (o.cave) score += 0.9; // caves beat corals
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    }
    this.spot.copy(best.p);
    this.spot.y = Math.max(this.spot.y, this.ctx.terrain.heightAt(this.spot.x, this.spot.z) + 0.05);
    this.spotRef = best.ref;
    if (best.ref) this.spotRefPos.copy(best.ref.position);
  }

  reset() {
    this.investigating = null;
    this.known.clear();
    for (const s of this.ctx.reef.selectables) if (s.habitat === 'cave') this.known.add(s.id);
    this.state = 'hidden';
    this.timer = rand(5, 10);
    this.chooseSpot(null);
    this.pos.copy(this.spot);
    this.inkLife = 0;
  }

  /**
   * Poked / gently disturbed: a hidden octopus gets curious and peeks out; repeated
   * disturbance makes it hide, and only occasionally it releases ink.
   */
  poke(p: THREE.Vector3) {
    this.annoy = Math.min(5, this.annoy + 1);
    if ((this.state === 'hidden' || this.state === 'buried') && this.annoy < 3) {
      this.state = 'peek';
      this.timer = rand(2.5, 4);
      return;
    }
    if (this.annoy >= 3 || this.state === 'crawl' || this.state === 'explore') this.startRetreat(p, Math.random() < 0.3);
  }

  /** External disturbance (sand, moved coral, click nearby). */
  disturb(p: THREE.Vector3, strength = 1) {
    const d = p.distanceTo(this.pos);
    if (d > 2.8 * strength) return;
    if (this.state === 'retreat') return;
    if (this.state === 'hidden') {
      // already safe — just tuck in
      this.timer = Math.max(this.timer, rand(6, 10));
      return;
    }
    this.startRetreat(p);
  }

  private startRetreat(from: THREE.Vector3 | null, ink = Math.random() < 0.35) {
    this.chooseSpot(from);
    this.state = 'retreat';
    this.timer = 8;
    if (ink) this.puffInk();
  }

  private puffInk() {
    const n = this.inkPos.length / 3;
    for (let i = 0; i < n; i++) {
      this.inkPos.set([this.pos.x + rand(-0.1, 0.1), this.pos.y + 0.2 + rand(-0.1, 0.1), this.pos.z + rand(-0.1, 0.1)], i * 3);
      this.inkVel.set([rand(-0.5, 0.5), rand(-0.1, 0.5), rand(-0.3, 0.3)], i * 3);
    }
    this.inkLife = 1;
  }

  // ------------------------------------------------------------------ Hide & Seek
  /** Starts hiding at `spot` (seabed point), blending toward `color`; `sink` buries it a bit. */
  gameHide(spot: THREE.Vector3, color: THREE.Color, sink: number) {
    this.game = { phase: 'go', spot: spot.clone(), sink, t: 0, peekT: rand(6, 9), peek: 0, flash: 0, glimpse: 0 };
    this.camoColor.copy(color);
    this.investigating = null;
    this.spotRef = null;
    this.inkLife = 0;
  }
  get gameArrived() {
    return !!this.game && this.game.phase !== 'go';
  }
  /** Hint 3: a brief glimpse — colour drops away and the skin glows faintly. */
  gameGlimpse() {
    if (this.game) this.game.glimpse = 1.6;
  }
  /** Found! Flash colour, uncurl the arms, a puff of bubbles. */
  gameFound() {
    if (!this.game) return;
    this.game.phase = 'found';
    this.game.t = 0;
    this.game.flash = 1;
    this.ctx.fx?.bubbles(this.pos.x, this.pos.y + 0.3, this.pos.z, 8);
  }
  /** Back to normal life (keeps its current position; nothing teleports). */
  gameEnd() {
    if (!this.game) return;
    this.game = null;
    this.camoColor.copy(this.sandColor);
    (this.skin as THREE.MeshStandardMaterial).emissive.setRGB(0, 0, 0);
    ((this as any).armMat as THREE.MeshStandardMaterial).emissive.setRGB(0, 0, 0);
    this.spot.copy(this.pos);
    this.state = 'explore';
    this.timer = rand(4, 7);
    this.exploreT = 0;
    this.annoy = 0;
  }
  get inGame() {
    return !!this.game;
  }

  private updateGame(dt: number, time: number) {
    const g = this.game!;
    const ctx = this.ctx;
    g.t += dt;
    const ground = ctx.terrain.heightAt(this.pos.x, this.pos.z);
    let wave = 0.3,
      bodyScaleT = 1,
      sinkT = 0,
      camoT = 0;
    if (g.phase === 'go') {
      // swift, low crawl straight to the spot, arms trailing
      const to = g.spot.clone().sub(this.pos);
      to.y = 0;
      const d = to.length();
      if (d > 0.05) this.yawT = Math.atan2(-to.x, -to.z);
      for (let i = 0; i < ARMS; i++) {
        this.curlT[i] = 0.5;
        this.liftT[i] = -0.2;
        this.lenT[i] = 0.85;
      }
      wave = 0.25;
      camoT = Math.min(0.6, g.t * 0.15);
      if (d < 0.12) {
        g.phase = 'hide';
        g.t = 0;
      } else this.pos.addScaledVector(to.divideScalar(d), Math.min(d, 2.1 * dt));
      // slide around obstacles (except the one it is hiding at)
      for (const o of ctx.obstacles()) {
        if (Math.hypot(o.center.x - g.spot.x, o.center.z - g.spot.z) < o.radius + 0.6) continue;
        const dx = this.pos.x - o.center.x,
          dz = this.pos.z - o.center.z;
        const dd = Math.hypot(dx, dz);
        const r = o.radius * 0.8 + 0.3;
        if (dd < r && dd > 1e-3) {
          this.pos.x += (dx / dd) * (r - dd) * Math.min(1, dt * 4);
          this.pos.z += (dz / dd) * (r - dd) * Math.min(1, dt * 4);
        }
      }
      this.pos.y = ground + 0.05;
    } else if (g.phase === 'hide') {
      this.pos.x += (g.spot.x - this.pos.x) * Math.min(1, dt * 2);
      this.pos.z += (g.spot.z - this.pos.z) * Math.min(1, dt * 2);
      this.pos.y = ctx.terrain.heightAt(this.pos.x, this.pos.z) + 0.05;
      // tucked in and camouflaged; every few seconds an eye or an arm tip moves
      g.peekT -= dt;
      if (g.peekT <= 0) {
        g.peekT = rand(7, 12);
        g.peek = 1.6;
      }
      g.peek = Math.max(0, g.peek - dt);
      const peeking = g.peek > 0;
      bodyScaleT = peeking ? 0.72 : 0.6;
      this.setArms(peeking ? 5.2 : 7.0, peeking ? 0.15 : -0.3, peeking ? 0.5 : 0.36, time, peeking ? 0.9 : 0.08);
      if (peeking) this.liftT[((Math.floor(time * 0.5) % ARMS) + ARMS) % ARMS] = 0.7; // one curious arm tip
      wave = peeking ? 0.45 : 0.06;
      sinkT = g.sink;
      camoT = peeking ? 0.88 : 0.97;
    } else {
      // found: colour floods back, arms unfurl
      bodyScaleT = 1;
      this.setArms(1.6, 0.5, 0.85, time, 0.6);
      wave = 0.7;
      camoT = 0;
      this.pos.y = ground + 0.05;
    }
    if (g.glimpse > 0) {
      g.glimpse = Math.max(0, g.glimpse - dt);
      camoT = Math.min(camoT, 0.35);
    }
    g.flash = Math.max(0, g.flash - dt * 0.6);
    const glow = Math.max(g.flash, g.glimpse > 0 ? 0.5 + 0.3 * Math.sin(time * 8) : 0);
    const em = new THREE.Color(1.0, 0.55, 0.3).multiplyScalar(glow * 0.45);
    (this.skin as THREE.MeshStandardMaterial).emissive.copy(em);
    ((this as any).armMat as THREE.MeshStandardMaterial).emissive.copy(em);
    this.state = g.phase === 'go' ? 'retreat' : g.phase === 'hide' ? 'buried' : 'explore';
    this.finish(dt, time, wave, bodyScaleT, sinkT, camoT, true);
  }

  update(dt: number, time: number) {
    if (this.game) {
      this.updateGame(dt, time);
      return;
    }
    const ctx = this.ctx;
    this.timer -= dt;
    this.annoy = Math.max(0, this.annoy - dt * 0.15);
    // discover newly placed cave rocks and go check them out
    this.exploreCheck -= dt;
    if (this.exploreCheck <= 0) {
      this.exploreCheck = 2;
      for (const s of ctx.reef.selectables) {
        if (s.habitat !== 'cave' || this.known.has(s.id)) continue;
        this.known.add(s.id);
        if (s.user && (this.state === 'explore' || this.state === 'crawl' || this.state === 'hidden' || this.state === 'buried') && Math.random() < 0.85) {
          this.investigating = { ref: s.object, p: s.object.position.clone().add(new THREE.Vector3(0, 0.3, 0.05)) };
          this.target.copy(this.investigating.p);
          this.state = 'crawl';
          this.timer = 30;
        }
      }
    }
    const ground = ctx.terrain.heightAt(this.pos.x, this.pos.z);
    // spot object moved by the user? -> relocate
    if (this.spotRef && this.spotRef.position.distanceTo(this.spotRefPos) > 0.3) {
      this.spotRef = null;
      if (this.state === 'hidden' || this.state === 'peek') this.startRetreat(this.pos.clone());
    }
    let wave = 0.3;
    let bodyScaleT = 1;
    let sinkT = 0;
    let camoT = 0;
    let moveSpeed = 0;

    switch (this.state) {
      case 'hidden': {
        this.pos.lerp(this.spot, Math.min(1, dt * 2));
        bodyScaleT = 0.62;
        this.setArms(6.5, 0.4, 0.38, time, 0.0);
        wave = 0.15;
        if (this.timer <= 0) {
          this.state = 'peek';
          this.timer = rand(2.5, 4);
        }
        break;
      }
      case 'peek': {
        this.pos.lerp(this.spot, Math.min(1, dt * 2));
        bodyScaleT = 0.8;
        this.setArms(3.5, 0.2, 0.55, time, 0.6);
        wave = 0.4;
        if (this.timer <= 0) {
          this.state = 'crawl';
          this.pickCrawlTarget();
          this.timer = rand(8, 14);
        }
        break;
      }
      case 'crawl': {
        moveSpeed = 0.32;
        const to = this.target.clone().sub(this.pos);
        to.y = 0;
        const d = to.length();
        if (d > 0.05) this.yawT = Math.atan2(to.x, to.z);
        // walking arms: alternate curl
        for (let i = 0; i < ARMS; i++) {
          const ph = time * 3.2 + i * Math.PI * 0.5;
          this.curlT[i] = 2.4 + 1.3 * Math.sin(ph);
          this.liftT[i] = -0.35 + 0.25 * Math.cos(ph);
          this.lenT[i] = 0.72;
        }
        wave = 0.35;
        if (this.investigating) {
          this.target.copy(this.investigating.ref.position).add(new THREE.Vector3(0, 0, 0.05));
          if (d < 0.6) {
            // moved in: this cave is home now
            this.spot.copy(this.investigating.p.copy(this.investigating.ref.position).add(new THREE.Vector3(0, 0.3, 0.05)));
            this.spotRef = this.investigating.ref;
            this.spotRefPos.copy(this.investigating.ref.position);
            this.investigating = null;
            this.state = 'hidden';
            this.timer = rand(14, 26);
            break;
          }
        }
        if (d < 0.3 || this.timer <= 0) {
          this.state = 'explore';
          this.timer = rand(6, 11);
          this.investigating = null;
        } else this.pos.addScaledVector(to.normalize(), moveSpeed * dt);
        this.avoidObstacles(dt);
        break;
      }
      case 'explore': {
        this.exploreT -= dt;
        if (this.exploreT <= 0) {
          this.exploreT = rand(1.2, 2.6);
          for (let i = 0; i < ARMS; i++) {
            this.curlT[i] = rand(0.6, 3.6);
            this.liftT[i] = rand(-0.4, 0.9);
            this.lenT[i] = rand(0.6, 0.85);
          }
          this.yawT += rand(-0.6, 0.6);
        }
        wave = 0.55;
        camoT = 0.25 + 0.2 * Math.sin(time * 0.8);
        if (this.timer <= 0) {
          const r = Math.random();
          if (r < 0.35) {
            this.state = 'buried';
            this.timer = rand(12, 22);
          } else if (r < 0.75) {
            this.state = 'crawl';
            this.pickCrawlTarget();
            this.timer = rand(8, 14);
          } else {
            this.chooseSpot(null);
            this.state = 'retreat';
            this.timer = 10;
          }
        }
        break;
      }
      case 'buried': {
        sinkT = 0.17;
        camoT = 1;
        this.setArms(7.5, -0.5, 0.3, time, 0);
        wave = 0.05;
        if (this.timer <= 0) {
          this.state = 'explore';
          this.timer = rand(5, 9);
          this.exploreT = 0;
        }
        break;
      }
      case 'retreat': {
        moveSpeed = 1.9;
        const to = this.spot.clone().sub(this.pos);
        const d = Math.hypot(to.x, to.z) + Math.abs(to.y) * 0.3;
        if (d > 0.05) this.yawT = Math.atan2(-to.x, -to.z); // mantle first, arms trailing
        for (let i = 0; i < ARMS; i++) {
          this.curlT[i] = 0.4;
          this.liftT[i] = -0.15;
          this.lenT[i] = 0.85;
        }
        wave = 0.2;
        if (d < 0.15 || this.timer <= 0) {
          this.state = 'hidden';
          this.timer = rand(10, 22);
        } else {
          const L = to.length() || 1;
          this.pos.addScaledVector(to.divideScalar(L), Math.min(L, moveSpeed * dt));
        }
        break;
      }
    }

    // keep on (or slightly above) the seabed outside the hiding spot
    if (this.state !== 'hidden' && this.state !== 'peek' && this.state !== 'retreat') {
      this.pos.y = ground + 0.05;
    } else if (this.state === 'retreat') {
      this.pos.y = Math.max(this.pos.y, ground + 0.05);
    }
    this.finish(dt, time, wave, bodyScaleT, sinkT, camoT, false);
  }

  /** Shared tail of the update: smoothing, colour, transforms, ink. */
  private finish(dt: number, time: number, wave: number, bodyScaleT: number, sinkT: number, camoT: number, game: boolean) {
    this.pos.z = zClamp(this.pos.z, 0.7);

    // smooth parameters
    for (let i = 0; i < ARMS; i++) {
      this.curl[i] = damp(this.curl[i], this.curlT[i], 4, dt);
      this.lift[i] = damp(this.lift[i], this.liftT[i], 4, dt);
      this.len[i] = damp(this.len[i], this.lenT[i], 3, dt);
      this.armUniforms.uCurl.value[i] = this.curl[i];
      this.armUniforms.uLift.value[i] = this.lift[i];
      this.armUniforms.uLen.value[i] = this.len[i] * 1.65;
      const spread = this.state === 'retreat' ? 0.35 : 1;
      this.armUniforms.uAng.value[i] = Math.PI / 2 + (i - 3.5) * (Math.PI * 2 / ARMS) * spread + (this.state === 'retreat' ? Math.PI : 0);
    }
    this.armUniforms.uWave.value = damp(this.armUniforms.uWave.value, wave, 3, dt);
    this.armUniforms.uOT.value = time;
    this.bodyScale = damp(this.bodyScale, bodyScaleT, 3, dt);
    this.sink = damp(this.sink, sinkT, 2, dt);
    this.camo = damp(this.camo, camoT, game && camoT < this.camo ? 4 : 1.5, dt);
    let dy = this.yawT - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 3);

    const col = this.baseColor.clone().lerp(this.camoColor, this.camo);
    this.skin.color.copy(col);
    ((this as any).armMat as THREE.MeshStandardMaterial).color.copy(col);

    this.group.position.set(this.pos.x, this.pos.y - this.sink, this.pos.z);
    this.group.rotation.y = this.yaw;
    this.group.scale.setScalar(this.bodyScale * 1.25);
    // breathing
    const breathe = 1 + Math.sin(time * 2.2) * 0.03;
    this.mantle.scale.set(breathe, 1 + (breathe - 1) * 0.5, breathe);
    this.mantle.rotation.x = -0.65 + (this.state === 'retreat' ? 0.5 : 0) + Math.sin(time * 0.9) * 0.05;

    // ink
    if (this.inkLife > 0) {
      this.inkLife -= dt * 0.35;
      const n = this.inkPos.length / 3;
      for (let i = 0; i < n; i++) {
        for (let a = 0; a < 3; a++) {
          this.inkPos[i * 3 + a] += this.inkVel[i * 3 + a] * dt;
          this.inkVel[i * 3 + a] *= Math.exp(-1.2 * dt);
        }
      }
      (this.ink.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      const m = this.ink.material as THREE.PointsMaterial;
      m.opacity = Math.max(0, this.inkLife) * 0.35;
      m.size = 0.35 + (1 - this.inkLife) * 0.6;
    }
    this.ink.visible = this.inkLife > 0;
  }

  private setArms(curl: number, lift: number, len: number, time: number, wiggle: number) {
    for (let i = 0; i < ARMS; i++) {
      this.curlT[i] = curl + Math.sin(time * 0.8 + i * 1.7) * wiggle;
      this.liftT[i] = lift + Math.sin(time * 0.6 + i) * wiggle * 0.3;
      this.lenT[i] = len * (i % 3 === 0 ? 1.1 : 1);
    }
  }

  private pickCrawlTarget() {
    for (let tries = 0; tries < 10; tries++) {
      const x = clamp(this.pos.x + rand(-4, 4), -1.5, 16);
      const z = rand(-7.5, 4.5);
      if (this.ctx.terrain.heightAt(x, z) < -2.5) {
        this.target.set(x, 0, z);
        return;
      }
    }
    this.target.set(rand(2, 10), 0, rand(-2, 4));
  }

  private avoidObstacles(dt: number) {
    const goal = this.investigating?.ref.position;
    for (const o of this.ctx.obstacles()) {
      if (goal && Math.hypot(o.center.x - goal.x, o.center.z - goal.z) < 0.8) continue; // heading into this cave
      const dx = this.pos.x - o.center.x,
        dz = this.pos.z - o.center.z;
      const d = Math.hypot(dx, dz);
      const r = o.radius * 0.8 + 0.3;
      if (d < r && d > 1e-3) {
        this.pos.x += (dx / d) * (r - d) * Math.min(1, dt * 4);
        this.pos.z += (dz / d) * (r - d) * Math.min(1, dt * 4);
      }
    }
  }
}

function buildArmGeometry() {
  const segs = 28,
    radial = 8;
  const pos: number[] = [],
    nor: number[] = [],
    col: number[] = [],
    arm: number[] = [],
    sAttr: number[] = [],
    idx: number[] = [];
  const base = new THREE.Color(1, 1, 1);
  const sucker = new THREE.Color(1.75, 1.55, 1.35);
  for (let a = 0; a < ARMS; a++) {
    const start = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const s = i / segs;
      const r = 0.062 * Math.pow(1 - s, 0.9) + 0.006;
      for (let j = 0; j <= radial; j++) {
        const th = (j / radial) * Math.PI * 2;
        const y = Math.cos(th) * r,
          z = Math.sin(th) * r;
        pos.push(0, y, z);
        nor.push(0, Math.cos(th), Math.sin(th));
        const under = Math.cos(th) < -0.25;
        const dot = under ? (i % 2 === 0 ? sucker : new THREE.Color(1.3, 1.18, 1.05)) : base;
        const m = 0.85 + 0.2 * fbm3(a * 3 + s * 6, th, 1, 2);
        col.push(dot.r * m, dot.g * m, dot.b * m);
        arm.push(a);
        sAttr.push(s);
      }
    }
    for (let i = 0; i < segs; i++)
      for (let j = 0; j < radial; j++) {
        const p0 = start + i * (radial + 1) + j,
          p1 = p0 + radial + 1;
        idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aArm', new THREE.Float32BufferAttribute(arm, 1));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(sAttr, 1));
  g.setIndex(idx);
  return g;
}

function paintSkin(g: THREE.BufferGeometry) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const n = fbm3(x * 9, y * 9, z * 9, 3);
    const spot = n > 0.12 ? 0.68 : n < -0.2 ? 1.2 : 1;
    const pale = fbm3(x * 34 + 3, y * 34, z * 34, 1) > 0.32 ? 1.45 : 1; // pale chromatophore dots
    const v = spot * pale * (0.9 + 0.15 * fbm3(x * 30, y * 30, z * 30, 1));
    col.set([v, v * 0.96, v * 0.92], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** Golden iris with the octopus' horizontal bar pupil. */
function octoEyeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a2014';
  g.fillRect(0, 0, 128, 128);
  const grd = g.createRadialGradient(64, 64, 8, 64, 64, 50);
  grd.addColorStop(0, '#f0d070');
  grd.addColorStop(0.7, '#d0a040');
  grd.addColorStop(1, '#5a4020');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(64, 64, 50, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(90,60,20,0.35)';
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * 18, 64 + Math.sin(a) * 18);
    g.lineTo(64 + Math.cos(a) * 48, 64 + Math.sin(a) * 48);
    g.stroke();
  }
  g.fillStyle = '#060606';
  g.beginPath();
  g.ellipse(64, 64, 34, 9, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.ellipse(48, 46, 8, 5, -0.5, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
