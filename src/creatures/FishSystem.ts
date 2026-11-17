import * as THREE from 'three';
import { CONFIG, randZ } from '../config';
import { clamp, rand } from '../util/math';
import { GLSL_NOISE, shared } from '../util/shaders';
import { buildFish, SPECIES, type FishSpec } from './fishSpecies';
import { FoodState, type FoodSystem } from './FoodSystem';
import type { WorldContext } from './types';

type Mode = 'wander' | 'school' | 'react' | 'seek' | 'flee' | 'exit' | 'away' | 'hover' | 'rest' | 'curious';

import type { Selectable } from '../world/Reef';

/** Max instances per species (population slider range). */
export const FISH_CAP: Record<string, number> = { silverside: 90, cardinal: 40, clown: 6, tang: 8, butterfly: 8, angel: 6 };

interface Behavior {
  school: number; // -1 = solitary
  cruise: number;
  max: number;
  accel: number;
  turn: number; // rad/s
  detect: number;
  react: [number, number];
  zone: { x: [number, number]; y: [number, number] };
  home?: 'anemone';
  homeRadius?: number;
  sep: number;
  neighbor: number;
  swimFreq: number;
  exitChance: number;
}

const BEHAVIOR: Record<string, Behavior> = {
  silverside: { school: 0, cruise: 1.15, max: 2.7, accel: 2.6, turn: 3.2, detect: 4.8, react: [0.05, 0.7], zone: { x: [-4, 16], y: [-4.8, -0.8] }, sep: 0.28, neighbor: 1.25, swimFreq: 15, exitChance: 0.3 },
  cardinal: { school: 1, cruise: 0.55, max: 1.9, accel: 2.0, turn: 2.8, detect: 3.2, react: [0.2, 1.1], zone: { x: [7, 17], y: [-5.6, -2.6] }, sep: 0.26, neighbor: 0.95, swimFreq: 13, exitChance: 0.1 },
  clown: { school: -1, cruise: 0.45, max: 1.5, accel: 1.6, turn: 2.6, detect: 2.8, react: [0.4, 1.6], zone: { x: [7, 10], y: [-5.6, -3.5] }, home: 'anemone', homeRadius: 1.2, sep: 0.4, neighbor: 0, swimFreq: 11, exitChance: 0 },
  tang: { school: -1, cruise: 0.75, max: 2.0, accel: 1.6, turn: 2.0, detect: 4.0, react: [0.3, 1.4], zone: { x: [-4, 17], y: [-4.8, -1.2] }, sep: 0.55, neighbor: 0, swimFreq: 8, exitChance: 0.2 },
  butterfly: { school: -1, cruise: 0.45, max: 1.3, accel: 1.2, turn: 1.8, detect: 3.0, react: [0.9, 2.6], zone: { x: [-15, -3], y: [-2.6, -0.7] }, sep: 0.55, neighbor: 0, swimFreq: 8, exitChance: 0.12 },
  angel: { school: -1, cruise: 0.38, max: 1.2, accel: 1.0, turn: 1.4, detect: 3.4, react: [1.2, 3.0], zone: { x: [5, 16], y: [-4.6, -1.8] }, sep: 0.7, neighbor: 0, swimFreq: 6, exitChance: 0.15 },
};

export interface Fish {
  id: number;
  species: string;
  spec: FishSpec;
  b: Behavior;
  inst: number;
  /** Population system: inactive fish are hidden and skipped. */
  active?: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fwd: THREE.Vector3;
  mode: Mode;
  target: THREE.Vector3;
  timer: number;
  satiated: number;
  food: number;
  phase: number;
  bend: number;
  amp: number;
  speedMul: number;
  checkTimer: number;
  /** 0..1, grows over time; hungry fish notice food sooner and from farther away. */
  hunger: number;
  leaving: boolean;
  /** Clownfish: the anemone it currently calls home. */
  home: Selectable | null;
  homeTimer: number;
}

interface SpeciesMesh {
  mesh: THREE.InstancedMesh;
  swim: THREE.InstancedBufferAttribute;
  fish: Fish[];
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * All bony fish: two boids schools plus individual tropical fish. Lightweight steering
 * behaviours (seek/arrive, wander, separation/alignment/cohesion, obstacle/terrain/surface
 * avoidance) with a small state machine per fish: wander → react → seek → eat, flee, exit.
 */
export class FishSystem {
  readonly group = new THREE.Group();
  readonly fish: Fish[] = [];
  private meshes = new Map<string, SpeciesMesh>();
  private schoolGoals = [new THREE.Vector3(4, -2.5, 1), new THREE.Vector3(12, -4.2, 0.5)];
  private fv = new THREE.Vector3();
  private schoolTimers = [3, 5];
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private acc = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private basisY = new THREE.Vector3();
  private basisZ = new THREE.Vector3();
  private scaleV = new THREE.Vector3(1, 1, 1);
  private disturbances: { p: THREE.Vector3; r: number; s: number }[] = [];
  /** 0..1 night factor (fish slow down and rest near the reef). */
  night = 0;

  constructor(private ctx: WorldContext) {
    const C = CONFIG.creatures;
    this.addSpecies('silverside', C.schoolCount);
    this.addSpecies('cardinal', C.cardinalCount);
    this.addSpecies('clown', C.clownCount);
    this.addSpecies('tang', C.tangCount);
    this.addSpecies('butterfly', C.butterflyCount);
    this.addSpecies('angel', C.angelCount);
    this.resetBehaviors();
  }

  /** Desired population per species. */
  readonly want: Record<string, number> = {};

  private addSpecies(id: string, initial: number) {
    const count = FISH_CAP[id];
    this.want[id] = initial;
    const spec = SPECIES[id];
    const { geometry, texture, normalMap, eyeGeometry, eyeTexture } = buildFish(spec);
    const swimArr = new Float32Array(count * 4);
    const swim = new THREE.InstancedBufferAttribute(swimArr, 4);
    swim.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aSwim', swim);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    const mat = makeFishMaterial(texture, spec, bb.max.x, bb.max.x - bb.min.x, normalMap);
    const mesh = new THREE.InstancedMesh(geometry, mat, count);
    // eyes share the instance matrices and swim attribute of the body
    eyeGeometry.setAttribute('aSwim', swim);
    const eyeMat = makeFishMaterial(eyeTexture, spec, bb.max.x, bb.max.x - bb.min.x, null, true);
    const eyes = new THREE.InstancedMesh(eyeGeometry, eyeMat, count);
    eyes.instanceMatrix = mesh.instanceMatrix;
    eyes.frustumCulled = false;
    eyes.name = `fish-eyes-${id}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.name = `fish-${id}`;
    this.group.add(mesh, eyes);
    const list: Fish[] = [];
    for (let i = 0; i < count; i++) {
      const f: Fish = {
        id: this.fish.length,
        species: id,
        spec,
        b: BEHAVIOR[id],
        inst: i,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        fwd: new THREE.Vector3(1, 0, 0),
        mode: 'wander',
        target: new THREE.Vector3(),
        timer: 0,
        satiated: 0,
        food: -1,
        phase: rand(0, 100),
        bend: 0,
        amp: 1,
        speedMul: rand(0.85, 1.15),
        checkTimer: rand(0, 0.3),
        hunger: rand(0, 0.5),
        leaving: false,
        home: null,
        homeTimer: rand(10, 30),
        active: i < initial,
      };
      list.push(f);
      this.fish.push(f);
    }
    this.meshes.set(id, { mesh, swim, fish: list });
  }

  /** (Re)initialises positions and behaviour state; used on start and Reset World. */
  resetBehaviors() {
    for (const f of this.fish) {
      const z = f.b.zone;
      if (f.b.school >= 0) {
        const g = this.schoolGoals[f.b.school];
        f.pos.set(g.x + rand(-1.2, 1.2), g.y + rand(-0.5, 0.5), g.z + rand(-1.2, 1.2));
        f.mode = 'school';
      } else if (f.b.home === 'anemone') {
        const anems = this.ctx.reef.anemones();
        f.home = anems[0] ?? null;
        const a = this.homePos(f);
        f.pos.set(a.x + rand(-0.6, 0.6), a.y + rand(0, 0.4), a.z + rand(-0.4, 0.2));
        f.mode = 'hover';
      } else {
        f.pos.set(rand(z.x[0], z.x[1]), rand(z.y[0], z.y[1]), randZ(2, 1.5));
        f.mode = 'wander';
      }
      f.vel.set(rand(-1, 1), 0, rand(-0.2, 0.2)).normalize().multiplyScalar(f.b.cruise);
      f.fwd.copy(f.vel).normalize();
      f.timer = rand(0, 3);
      f.satiated = 0;
      f.food = -1;
      f.leaving = false;
      f.active = f.inst < this.want[f.species];
      this.pickWanderTarget(f);
    }
  }

  private homePos(f: Fish) {
    if (f.home) return this.tmp2.copy(f.home.object.position).add(new THREE.Vector3(0, f.home.height * 0.55, 0));
    return this.tmp2.copy(this.ctx.reef.anemonePos);
  }

  /** Population control: fish arrive from the edge of the view or swim away. */
  setCount(species: string, n: number) {
    const list = this.meshes.get(species)?.fish;
    if (!list) return;
    n = Math.max(0, Math.min(FISH_CAP[species], Math.round(n)));
    this.want[species] = n;
    const vis = this.ctx.visibleX;
    const edge = Math.max(-vis.min, vis.max) + 3;
    let active = list.filter((f) => f.active && !f.leaving).length;
    for (const f of list) {
      if (active >= n) break;
      if (f.active && f.leaving) {
        f.leaving = false;
        f.mode = f.b.school >= 0 ? 'school' : 'wander';
        active++;
      } else if (!f.active) {
        const z = f.b.zone;
        const side = Math.random() < 0.5 ? -1 : 1;
        f.pos.set(side * edge, rand(z.y[0], z.y[1]), randZ(2.5, 1.4));
        if (f.b.home === 'anemone') {
          f.home = this.ctx.reef.anemones()[0] ?? null;
          f.mode = 'hover';
        } else f.mode = f.b.school >= 0 ? 'school' : 'wander';
        f.vel.set(-side * f.b.cruise, 0, 0);
        f.fwd.set(-side, 0, 0);
        f.active = true;
        f.leaving = false;
        this.pickWanderTarget(f);
        active++;
      }
    }
    for (let i = list.length - 1; i >= 0 && active > n; i--) {
      const f = list[i];
      if (!f.active || f.leaving) continue;
      f.leaving = true;
      f.mode = 'exit';
      const side = f.pos.x < 0 ? -1 : 1;
      f.target.set(side * edge, f.pos.y, f.pos.z);
      active--;
    }
  }

  /** Readable state for the inspect tooltip. */
  moodOf(f: Fish): string {
    if (f.leaving) return 'Leaving';
    switch (f.mode) {
      case 'flee':
        return 'Startled';
      case 'react':
        return 'Noticed food';
      case 'seek':
        return 'Hungry · feeding';
      case 'rest':
        return 'Resting';
      case 'curious':
        return 'Curious';
      case 'hover':
        return f.home && f.home.user ? 'Moved into a new anemone' : 'Guarding its anemone';
      case 'exit':
      case 'away':
        return 'Wandering off';
      case 'school':
        return this.night > 0.5 ? 'Schooling slowly (night)' : f.hunger > 0.65 ? 'Hungry' : 'Schooling';
      default:
        return f.hunger > 0.65 ? 'Hungry' : 'Cruising';
    }
  }

  /** Short-lived disturbance (hover over water, moved objects): fish keep away a little. */
  addDisturbance(p: THREE.Vector3, radius: number, strength: number) {
    if (this.disturbances.length > 8) this.disturbances.shift();
    this.disturbances.push({ p: p.clone(), r: radius, s: strength });
  }

  /** Click / splash: nearby fish dart away, then recover. */
  startle(x: number, y: number, z: number, radius = 3.2) {
    const p = this.tmp.set(x, y, z);
    for (const f of this.fish) {
      if (!f.active) continue;
      const d = f.pos.distanceTo(p);
      if (d < radius) {
        f.mode = 'flee';
        f.timer = rand(0.7, 1.5) * (1 - d / radius) + 0.3;
        f.target.copy(f.pos).sub(p).setY(Math.min(0, f.pos.y - p.y) - 0.6).normalize();
        f.food = -1;
      }
    }
  }

  private pickWanderTarget(f: Fish) {
    const z = f.b.zone;
    const vis = this.ctx.visibleX;
    const reef = this.ctx.reef;
    if (f.b.home === 'anemone') {
      const a = this.homePos(f);
      const r = f.b.homeRadius ?? 1;
      f.target.set(a.x + rand(-r, r), a.y + rand(-0.1, r * 0.7), a.z + rand(-0.6, 0.4));
    } else if (f.b.school < 0 && Math.random() < 0.08 + this.night * 0.6) {
      // resting near the reef (mostly at night)
      const spots = reef.selectables.filter((s) => s.kind === 'coral' || s.kind === 'rock');
      const s = spots[Math.floor(Math.random() * spots.length)];
      if (s) {
        f.target.copy(s.object.position).add(new THREE.Vector3(rand(-0.4, 0.4), s.height * 0.6 + 0.35, rand(0.2, 0.6)));
        f.mode = 'rest';
        f.timer = rand(12, 28);
        return;
      }
    } else if (f.b.school < 0 && Math.random() < (reef.recentPlacement(15) ? 0.5 : 0.12)) {
      // curiosity: inspect a newly placed object, or come right up to the front glass
      const poi = reef.recentPlacement(15);
      if (poi) f.target.copy(poi.object.position).add(new THREE.Vector3(rand(-0.5, 0.5), poi.height + 0.4, 0.5));
      else f.target.set(f.pos.x + rand(-1.5, 1.5), rand(z.y[0], z.y[1]), CONFIG.world.zFront - 0.9);
      f.mode = 'curious';
      f.timer = rand(6, 11);
      return;
    } else if (Math.random() < f.b.exitChance * 0.35) {
      // swim out of view for a while
      const side = f.pos.x < (vis.min + vis.max) / 2 ? -1 : 1;
      f.target.set(side * (Math.max(Math.abs(vis.min), vis.max) + 4), rand(z.y[0], z.y[1]), randZ(2, 1.4));
      f.mode = 'exit';
    } else {
      f.target.set(rand(z.x[0], z.x[1]), rand(z.y[0], z.y[1]), randZ(1.6, 1.5));
    }
    f.timer = rand(4, 10);
  }

  private updateSchoolGoals(dt: number) {
    const vis = this.ctx.visibleX;
    for (let s = 0; s < this.schoolGoals.length; s++) {
      this.schoolTimers[s] -= dt;
      if (this.schoolTimers[s] > 0) continue;
      const b = s === 0 ? BEHAVIOR.silverside : BEHAVIOR.cardinal;
      const g = this.schoolGoals[s];
      if (Math.random() < b.exitChance) {
        const side = Math.random() < 0.5 ? -1 : 1;
        g.set(side * (Math.max(-vis.min, vis.max) + 5), rand(b.zone.y[0], b.zone.y[1]), randZ(3, 1.4));
        this.schoolTimers[s] = rand(10, 16);
      } else {
        g.set(rand(b.zone.x[0], b.zone.x[1]), rand(b.zone.y[0], b.zone.y[1]), randZ(2, 1.5));
        this.schoolTimers[s] = rand(6, 13);
      }
    }
  }

  update(dt: number, time: number) {
    const ctx = this.ctx;
    const food = ctx.food;
    this.updateSchoolGoals(dt);
    const obstacles = ctx.obstacles();
    const C = CONFIG.creatures;
    const vis = ctx.visibleX;

    for (const f of this.fish) {
      if (!f.active) continue;
      const b = f.b;
      const acc = this.acc.set(0, 0, 0);
      if (f.leaving && f.mode !== 'exit' && f.mode !== 'flee') {
        f.mode = 'exit';
        f.target.set((f.pos.x < 0 ? -1 : 1) * (Math.max(-vis.min, vis.max) + 3), f.pos.y, f.pos.z);
      }
      f.satiated = Math.max(0, f.satiated - dt);
      f.timer -= dt;
      f.hunger = Math.min(1, f.hunger + dt / (b.school >= 0 ? 70 : 100));
      let maxSpeed = b.max * f.speedMul;
      let desiredSpeed = b.cruise * f.speedMul * (1 - 0.45 * this.night);
      if (b.home === 'anemone') this.considerHome(f, dt);
      let surfaceMargin = C.surfaceMargin;

      // ---------- food perception (staggered checks)
      f.checkTimer -= dt;
      if (f.checkTimer <= 0) {
        f.checkTimer = 0.25 + Math.random() * 0.1;
        if (f.satiated <= 0 && !f.leaving && (f.mode === 'wander' || f.mode === 'school' || f.mode === 'hover' || f.mode === 'rest' || f.mode === 'curious')) {
          const idx = food.nearest(f.pos.x, f.pos.y, f.pos.z, b.detect * (0.7 + f.hunger * 0.8), false);
          if (idx >= 0) {
            f.food = idx;
            f.mode = 'react';
            f.timer = rand(b.react[0], b.react[1]) * (1 - 0.6 * f.hunger);
          }
        }
      }

      switch (f.mode) {
        case 'react': {
          // noticed food: slow down and orient before committing
          if (food.state[f.food] === FoodState.Dead || food.state[f.food] === FoodState.Settled) {
            f.mode = b.school >= 0 ? 'school' : 'wander';
            break;
          }
          this.tmp.set(food.pos[f.food * 3], food.pos[f.food * 3 + 1], food.pos[f.food * 3 + 2]);
          this.seek(f, this.tmp, desiredSpeed * 0.6, acc, 0.6);
          if (f.timer <= 0) f.mode = 'seek';
          break;
        }
        case 'seek': {
          const st = food.state[f.food];
          if (f.food < 0 || st === FoodState.Dead || st === FoodState.Settled || st === FoodState.Air) {
            // retarget to another pellet nearby, otherwise resume
            const idx = food.nearest(f.pos.x, f.pos.y, f.pos.z, b.detect * 0.8, false);
            if (idx >= 0) f.food = idx;
            else {
              f.mode = b.school >= 0 ? 'school' : b.home ? 'hover' : 'wander';
              break;
            }
          }
          const k = f.food * 3;
          this.tmp.set(food.pos[k], food.pos[k + 1], food.pos[k + 2]);
          surfaceMargin = 0.06;
          desiredSpeed = maxSpeed * 0.85;
          const d = f.pos.distanceTo(this.tmp);
          this.arrive(f, this.tmp, desiredSpeed, acc, 1.6);
          if (d < 0.09 + f.spec.size * 0.22) {
            food.consume(f.food);
            f.food = -1;
            f.hunger = Math.max(0, f.hunger - 0.5);
            f.satiated = rand(3, 8) * (b.school >= 0 ? 0.6 : 1.2);
            f.mode = b.school >= 0 ? 'school' : b.home ? 'hover' : 'wander';
            f.vel.multiplyScalar(0.5);
            ctx.onEat?.(this.tmp);
          }
          break;
        }
        case 'flee': {
          acc.addScaledVector(f.target, b.accel * 3.5);
          desiredSpeed = maxSpeed * 1.15;
          maxSpeed *= 1.25;
          if (f.timer <= 0) f.mode = b.school >= 0 ? 'school' : b.home ? 'hover' : 'wander';
          break;
        }
        case 'school': {
          const g = this.schoolGoals[b.school];
          this.boids(f, acc);
          this.seek(f, g, desiredSpeed, acc, 0.45);
          break;
        }
        case 'hover': {
          // clownfish style: short darts around the home anemone, often pausing
          if (f.pos.distanceTo(f.target) < 0.25 || f.timer <= 0) this.pickWanderTarget(f);
          const far = f.home ? f.pos.distanceTo(f.home.object.position) > 2.2 : false;
          this.arrive(f, f.target, desiredSpeed * (far ? 2.2 : 0.8), acc, 0.8);
          break;
        }
        case 'rest': {
          // hover almost still beside the reef, slowly fanning fins
          this.arrive(f, f.target, desiredSpeed * 0.35, acc, 1.0);
          desiredSpeed *= 0.25;
          if (f.timer <= 0 && this.night < 0.6) {
            f.mode = 'wander';
            this.pickWanderTarget(f);
          }
          else if (f.timer <= 0) f.timer = rand(10, 20);
          break;
        }
        case 'curious': {
          this.arrive(f, f.target, desiredSpeed * 0.7, acc, 1.2);
          if (f.timer <= 0) {
            f.mode = 'wander';
            this.pickWanderTarget(f);
          }
          break;
        }
        case 'exit': {
          this.seek(f, f.target, desiredSpeed * 1.2, acc, 1);
          if (Math.abs(f.pos.x) > Math.max(-vis.min, vis.max) + 2.5) {
            if (f.leaving) {
              f.active = false;
              f.leaving = false;
              continue;
            }
            f.mode = 'away';
            f.timer = rand(6, 18);
          }
          break;
        }
        case 'away': {
          // out of view; idle drift, then come back
          f.vel.multiplyScalar(0.95);
          if (f.timer <= 0) {
            f.mode = 'wander';
            f.target.set(rand(b.zone.x[0], b.zone.x[1]), rand(b.zone.y[0], b.zone.y[1]), randZ(2, 1.5));
            f.timer = rand(6, 10);
          }
          break;
        }
        default: {
          if (f.pos.distanceTo(f.target) < 0.7 || f.timer <= 0) this.pickWanderTarget(f);
          this.arrive(f, f.target, desiredSpeed, acc, 1.2);
          // gentle meander
          acc.y += Math.sin(time * 0.7 + f.id) * 0.08;
        }
      }

      // ---------- separation from every nearby fish (prevents interpenetration)
      this.separation(f, acc);
      // ---------- avoid obstacles, terrain, surface, bounds
      this.avoid(f, acc, obstacles, surfaceMargin, dt);
      for (const d of this.disturbances) {
        this.tmp.copy(f.pos).sub(d.p);
        const dist = this.tmp.length();
        if (dist < d.r && dist > 1e-4) acc.addScaledVector(this.tmp.normalize(), d.s * (1 - dist / d.r) * b.accel);
      }

      // ---------- painted currents: schools go with the flow, others resist a little
      if (ctx.flow.active) {
        const fl = ctx.flow.velocityAt(f.pos.x, f.pos.y, f.pos.z, this.fv);
        acc.addScaledVector(fl, b.school >= 0 ? 1.4 : 0.6);
        f.pos.addScaledVector(fl, dt * (b.school >= 0 ? 0.35 : 0.5));
      }
      // ---------- integrate with turn-rate and acceleration limits
      this.integrate(f, acc, desiredSpeed, maxSpeed, dt);
    }
    this.disturbances.length = 0;
    this.writeInstances(dt);
  }

  /**
   * Clownfish habitat choice: they stay with their anemone, but a newly placed (or empty)
   * anemone may attract one of them after a while; a removed anemone sends them looking.
   */
  private considerHome(f: Fish, dt: number) {
    f.homeTimer -= dt;
    const anems = this.ctx.reef.anemones();
    if (f.home && !anems.includes(f.home)) {
      f.home = null;
      f.homeTimer = 0;
    }
    if (f.homeTimer > 0) return;
    f.homeTimer = rand(18, 40);
    if (!anems.length) return;
    if (!f.home) {
      f.home = anems.reduce((a, b) => (a.object.position.distanceTo(f.pos) < b.object.position.distanceTo(f.pos) ? a : b));
      f.mode = 'hover';
      this.pickWanderTarget(f);
      return;
    }
    const residents = (a: Selectable) => this.fish.filter((o) => o.active && o.home === a).length;
    const empty = anems.filter((a) => a !== f.home && residents(a) === 0);
    if (!empty.length || residents(f.home) < 2) return;
    const fresh = empty.find((a) => a.user);
    if (fresh || Math.random() < 0.35) {
      f.home = fresh ?? empty[Math.floor(Math.random() * empty.length)];
      f.mode = 'hover';
      this.pickWanderTarget(f);
    }
  }

  private seek(f: Fish, target: THREE.Vector3, speed: number, acc: THREE.Vector3, w: number) {
    const desired = this.tmp2.copy(target).sub(f.pos);
    const l = desired.length();
    if (l < 1e-4) return;
    desired.multiplyScalar(speed / l).sub(f.vel);
    acc.addScaledVector(desired, w * f.b.accel);
  }

  private arrive(f: Fish, target: THREE.Vector3, speed: number, acc: THREE.Vector3, slowR: number) {
    const desired = this.tmp2.copy(target).sub(f.pos);
    const l = desired.length();
    if (l < 1e-4) return;
    const s = l < slowR ? speed * Math.max(0.15, l / slowR) : speed;
    desired.multiplyScalar(s / l).sub(f.vel);
    acc.addScaledVector(desired, f.b.accel);
  }

  private boids(f: Fish, acc: THREE.Vector3) {
    const b = f.b;
    const cohesion = this.tmp.set(0, 0, 0);
    const align = new THREE.Vector3();
    let n = 0;
    const list = this.meshes.get(f.species)!.fish;
    for (const o of list) {
      if (o === f || o.mode === 'away' || !o.active) continue;
      const d = f.pos.distanceTo(o.pos);
      if (d < b.neighbor) {
        cohesion.add(o.pos);
        align.add(o.vel);
        n++;
      }
    }
    if (n > 0) {
      cohesion.divideScalar(n).sub(f.pos);
      acc.addScaledVector(cohesion, 0.9 * b.accel * 0.5);
      align.divideScalar(n).sub(f.vel);
      acc.addScaledVector(align, 0.8);
    }
  }

  private separation(f: Fish, acc: THREE.Vector3) {
    const r = f.b.sep;
    for (const o of this.fish) {
      if (o === f || !o.active) continue;
      const rr = Math.max(r, o.b.sep) * (f.species === o.species ? 1 : 1.4);
      const dx = f.pos.x - o.pos.x,
        dy = f.pos.y - o.pos.y,
        dz = f.pos.z - o.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const k = ((rr - d) / rr) * 3.2 * f.b.accel;
        acc.x += (dx / d) * k;
        acc.y += (dy / d) * k * 0.6;
        acc.z += (dz / d) * k;
      }
    }
  }

  private avoid(f: Fish, acc: THREE.Vector3, obstacles: { center: THREE.Vector3; radius: number }[], surfaceMargin: number, dt: number) {
    const ctx = this.ctx;
    const C = CONFIG.creatures;
    const b = f.b;
    const look = 0.55 + f.vel.length() * 0.5;
    const ahead = this.tmp.copy(f.pos).addScaledVector(f.fwd, look);
    // obstacles: sphere look-ahead
    for (const o of obstacles) {
      const dx = ahead.x - o.center.x,
        dy = ahead.y - o.center.y,
        dz = ahead.z - o.center.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rr = o.radius + 0.25 + f.spec.size * 0.4;
      if (d < rr) {
        const k = ((rr - d) / rr) * b.accel * 4;
        acc.x += (dx / (d + 1e-4)) * k;
        acc.y += (dy / (d + 1e-4)) * k + k * 0.3;
        acc.z += (dz / (d + 1e-4)) * k;
      }
    }
    // big creatures
    for (const o of ctx.creatureObstacles) {
      const d = f.pos.distanceTo(o.center);
      const rr = o.radius + 0.35;
      if (d < rr && d > 1e-4) {
        this.tmp2.copy(f.pos).sub(o.center).normalize();
        acc.addScaledVector(this.tmp2, ((rr - d) / rr) * b.accel * 4);
      }
    }
    // terrain: look ahead height
    const ground = Math.max(ctx.terrain.heightAt(ahead.x, ahead.z), ctx.terrain.heightAt(f.pos.x, f.pos.z));
    const clear = ground + 0.35 + f.spec.size * 0.3;
    if (f.pos.y < clear + 0.4) acc.y += (clear + 0.4 - f.pos.y) * b.accel * 3;
    // land ahead (island): turn around horizontally
    if (ctx.terrain.heightAt(ahead.x, ahead.z) > ctx.water.heightAt(ahead.x, ahead.z) - 0.6) {
      acc.x += (f.pos.x - ahead.x) * b.accel * 6;
      acc.y -= b.accel * 0.5;
    }
    // surface
    const surf = ctx.water.heightAt(f.pos.x, f.pos.z) - surfaceMargin;
    if (f.pos.y > surf - 0.25) acc.y -= (f.pos.y - (surf - 0.25)) * b.accel * 5;
    // depth bounds
    if (f.pos.z > C.zMax - 0.3) acc.z -= (f.pos.z - (C.zMax - 0.3)) * b.accel * 6;
    if (f.pos.z < C.zMin + 0.3) acc.z += (C.zMin + 0.3 - f.pos.z) * b.accel * 6;
    // x bounds (wide: fish may be off screen)
    if (f.pos.x > C.swimXMax) acc.x -= b.accel * 3;
    if (f.pos.x < C.swimXMin) acc.x += b.accel * 3;
    void dt;
  }

  private integrate(f: Fish, acc: THREE.Vector3, desiredSpeed: number, maxSpeed: number, dt: number) {
    const ctx = this.ctx;
    const prevFwd = this.tmp2.copy(f.fwd);
    f.vel.addScaledVector(acc, dt);
    // keep motion mostly horizontal (fish pitch less than they yaw)
    const horiz = Math.hypot(f.vel.x, f.vel.z);
    const maxVy = Math.max(0.25, horiz * 0.7);
    f.vel.y = clamp(f.vel.y, -maxVy, maxVy);
    // the camera sees the side of fish; discourage swimming straight at the viewer
    f.vel.z *= 1 - Math.min(0.5, dt * 0.18);
    let speed = f.vel.length();
    if (f.mode !== 'away') {
      const minSpeed = desiredSpeed * 0.25;
      if (speed < minSpeed) {
        f.vel.addScaledVector(f.fwd, (minSpeed - speed) * 0.6);
        speed = f.vel.length();
      }
    }
    if (speed > maxSpeed) f.vel.multiplyScalar(maxSpeed / speed);
    // turn-rate limited heading
    if (speed > 1e-3) {
      const want = this.tmp.copy(f.vel).divideScalar(speed);
      const ang = f.fwd.angleTo(want);
      const maxA = f.b.turn * dt * (f.mode === 'flee' ? 2 : 1);
      if (ang > maxA) f.fwd.lerp(want, maxA / ang).normalize();
      else f.fwd.copy(want);
      // velocity follows heading (no sideways sliding)
      f.vel.copy(f.fwd).multiplyScalar(speed);
    }
    f.pos.addScaledVector(f.vel, dt);
    // hard constraints
    const g = ctx.terrain.heightAt(f.pos.x, f.pos.z) + 0.18;
    if (f.pos.y < g) {
      f.pos.y = g;
      if (f.vel.y < 0) f.vel.y *= -0.3;
    }
    const s = ctx.water.heightAt(f.pos.x, f.pos.z) - 0.08;
    if (f.pos.y > s) f.pos.y = s;
    f.pos.z = clamp(f.pos.z, CONFIG.creatures.zMin, CONFIG.creatures.zMax);
    // turn bend for animation
    const yawRate = prevFwd.x * f.fwd.z - prevFwd.z * f.fwd.x;
    f.bend += (clamp(yawRate / Math.max(dt, 1e-3) * 0.25, -1, 1) - f.bend) * Math.min(1, dt * 6);
    const sp = speed / f.b.cruise;
    f.phase += dt * f.b.swimFreq * (0.35 + 0.65 * Math.min(2.2, sp));
    f.amp += (clamp(0.5 + sp * 0.5, 0.4, 1.6) - f.amp) * Math.min(1, dt * 3);
  }

  private writeInstances(dt: number) {
    for (const [, sm] of this.meshes) {
      const arr = sm.swim.array as Float32Array;
      for (const f of sm.fish) {
        if (!f.active) {
          this.m4.makeScale(0, 0, 0);
          sm.mesh.setMatrixAt(f.inst, this.m4);
          continue;
        }
        const X = f.fwd;
        const Z = this.basisZ.crossVectors(X, UP);
        if (Z.lengthSq() < 1e-5) Z.set(0, 0, 1);
        Z.normalize();
        // bank into turns
        const Y = this.basisY.crossVectors(Z, X).normalize();
        Y.addScaledVector(Z, -f.bend * 0.25).normalize();
        Z.crossVectors(X, Y).normalize();
        this.m4.makeBasis(X, Y, Z);
        this.m4.scale(this.scaleV.setScalar(0.92 + ((f.id * 37) % 17) / 100));
        this.m4.setPosition(f.pos);
        sm.mesh.setMatrixAt(f.inst, this.m4);
        arr[f.inst * 4] = f.phase;
        arr[f.inst * 4 + 1] = f.amp;
        arr[f.inst * 4 + 2] = f.bend;
      }
      sm.mesh.instanceMatrix.needsUpdate = true;
      sm.swim.needsUpdate = true;
    }
    void dt;
  }
}

export function makeFishMaterial(tex: THREE.Texture, spec: FishSpec, noseX: number, length: number, normalMap: THREE.Texture | null, eye = false) {
  const mat = new THREE.MeshPhysicalMaterial({
    map: tex,
    roughness: eye ? 0.05 : spec.roughness,
    metalness: eye ? 0 : spec.metalness,
    side: eye ? THREE.FrontSide : THREE.DoubleSide,
    clearcoat: eye ? 1 : 0.35,
    clearcoatRoughness: eye ? 0.02 : 0.35,
    iridescence: eye ? 0 : spec.iridescence ?? 0.15,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [180, 520],
    alphaToCoverage: !eye,
    alphaTest: eye ? 0 : 0.08,
  });
  if (normalMap && !eye) {
    mat.normalMap = normalMap;
    mat.normalScale.set(0.5, 0.5);
  }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, { uNose: { value: noseX }, uLen: { value: length } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSwim; uniform float uNose; uniform float uLen; varying vec3 vWPos;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float s = clamp((uNose - position.x) / uLen, 0.0, 1.0);
          float wave = sin(aSwim.x - s * 5.2);
          float amp = uLen * (0.015 + 0.13 * s * s) * aSwim.y;
          transformed.z += wave * amp + aSwim.z * s * s * uLen * 0.32;
          transformed.x -= abs(wave) * amp * 0.15 * s;
        }`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        { vec4 jwp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            jwp = instanceMatrix * jwp;
          #endif
          vWPos = (modelMatrix * jwp).xyz; }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos; uniform float uTime; uniform float uWaterLevel; uniform float uCausticStrength; uniform vec3 uCausticColor;
        ${GLSL_NOISE}`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 nW = inverseTransformDirection(normal, viewMatrix);
          float uw = uWaterLevel - vWPos.y;
          if (uw > 0.0) {
            float c = jCaustics(vWPos.xz * 0.95 + vec2(vWPos.y * 0.15), uTime * 0.9);
            outgoingLight += uCausticColor * c * clamp(nW.y, 0.0, 1.0) * exp(-uw * 0.12) * uCausticStrength * diffuseColor.rgb * 0.8;
          }
          vec3 vdir = normalize(vViewPosition);
          float rim = pow(1.0 - abs(dot(normal, -vdir)), 3.0);
          outgoingLight += diffuseColor.rgb * rim * 0.25;
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => (eye ? 'fish-eye' : 'fish');
  return mat;
}
