import * as THREE from 'three';
import { CONFIG } from '../config';
import { rand } from '../util/math';
import { FishSystem, FISH_CAP, type Fish } from './FishSystem';
import { FoodSystem } from './FoodSystem';
import { Stingray } from './Stingray';
import { Jellyfish } from './Jellyfish';
import { Crab } from './Crab';
import { Octopus } from './Octopus';
import { HermitCrab } from './HermitCrab';
import type { WorldContext } from './types';
import type { Obstacle } from '../world/Reef';

const JELLY_STARTS = [
  new THREE.Vector3(3.5, -2.0, -1.0),
  new THREE.Vector3(-1.5, -1.8, -3.4),
  new THREE.Vector3(11.5, -1.6, 2.4),
  new THREE.Vector3(6.5, -2.6, 3.6),
  new THREE.Vector3(0.5, -2.2, 1.8),
  new THREE.Vector3(14.5, -2.0, -2.5),
  new THREE.Vector3(-3.5, -1.6, 0.5),
  new THREE.Vector3(9.0, -1.5, -4.0),
];
const JELLY_HUES = [0.78, 0.58, 0.9, 0.68, 0.52, 0.84, 0.62, 0.95];
const CRAB_DEFS: [number, number, [number, number], [number, number], number][] = [
  [2.5, 3.6, [-1.8, 7.2], [1.0, 5.0], 0.03],
  [10.8, 2.0, [8.5, 16.5], [-2.5, 4.8], 0.07],
  [5.5, -2.0, [1.0, 9.0], [-4.0, 2.0], 0.0],
  [-2.0, 1.5, [-4.0, 3.0], [-1.0, 4.5], 0.09],
];
const HERMIT_DEFS: [number, number, number][] = [
  [4.2, 3.2, 101],
  [0.5, 4.2, 202],
  [8.0, 1.0, 303],
];

/** Population limits shown by the Life panel. */
export const POP_LIMITS: Record<string, [number, number]> = {
  silverside: [0, FISH_CAP.silverside],
  cardinal: [0, FISH_CAP.cardinal],
  clown: [0, FISH_CAP.clown],
  tang: [0, FISH_CAP.tang],
  butterfly: [0, FISH_CAP.butterfly],
  angel: [0, FISH_CAP.angel],
  jelly: [0, 8],
  crab: [0, 4],
  hermit: [0, 3],
  ray: [0, 1],
  octopus: [0, 1],
};
export const POP_DEFAULTS: Record<string, number> = {
  silverside: CONFIG.creatures.schoolCount,
  cardinal: CONFIG.creatures.cardinalCount,
  clown: CONFIG.creatures.clownCount,
  tang: CONFIG.creatures.tangCount,
  butterfly: CONFIG.creatures.butterflyCount,
  angel: CONFIG.creatures.angelCount,
  jelly: CONFIG.creatures.jellyCount,
  crab: CONFIG.creatures.crabCount,
  hermit: 1,
  ray: 1,
  octopus: 1,
};

export type PickResult =
  | { kind: 'fish'; fish: Fish; point: THREE.Vector3 }
  | { kind: 'jelly'; jelly: Jellyfish; point: THREE.Vector3 }
  | { kind: 'crab'; crab: Crab; point: THREE.Vector3 }
  | { kind: 'hermit'; hermit: HermitCrab; point: THREE.Vector3 }
  | { kind: 'octopus'; point: THREE.Vector3 }
  | { kind: 'ray'; point: THREE.Vector3 };

/**
 * Owns every living creature, their populations, and routes environmental events (food,
 * sand, ripples, moved / placed objects, currents) to the creatures that care about them.
 */
export class CreatureManager {
  readonly group = new THREE.Group();
  readonly fish: FishSystem;
  readonly ray: Stingray;
  readonly jellies: Jellyfish[] = [];
  readonly crabs: Crab[] = [];
  readonly hermits: HermitCrab[] = [];
  readonly octopus: Octopus;
  private creatureObs: Obstacle[] = [];
  readonly population: Record<string, number> = { ...POP_DEFAULTS };
  private night = 0;
  private fastFish: THREE.Vector3[] = [];

  constructor(readonly ctx: WorldContext, readonly food: FoodSystem) {
    this.group.add(food.mesh);
    this.fish = new FishSystem(ctx);
    this.group.add(this.fish.group);
    this.ray = new Stingray(ctx);
    this.group.add(this.ray.group);
    this.octopus = new Octopus(ctx);
    // its arms are bent in the vertex shader, so the geometry bounds don't match what is drawn;
    // without this, narrow views (the Magnifier) cull the octopus away
    this.octopus.group.traverse((o) => (o.frustumCulled = false));
    this.group.add(this.octopus.group, this.octopus.inkObject);
    ctx.creatureObstacles = this.creatureObs;
    this.applyPopulation();
  }

  // ------------------------------------------------------------------ population
  /** Sets the desired count of a species; creatures arrive / leave gracefully. */
  setPopulation(kind: string, n: number) {
    const lim = POP_LIMITS[kind];
    if (!lim) return;
    this.population[kind] = Math.max(lim[0], Math.min(lim[1], Math.round(n)));
    this.applyPopulation(kind);
  }

  private applyPopulation(only?: string) {
    const P = this.population;
    const ctx = this.ctx;
    for (const sp of Object.keys(FISH_CAP)) if (!only || only === sp) this.fish.setCount(sp, P[sp]);
    if (!only || only === 'jelly') {
      while (this.jellies.length < P.jelly) {
        const i = this.jellies.length;
        const j = new Jellyfish(ctx, i, JELLY_STARTS[i % JELLY_STARTS.length], JELLY_HUES[i % JELLY_HUES.length]);
        j.nightGlow = this.night;
        this.jellies.push(j);
        this.group.add(j.group, j.tentacleObject);
      }
      this.jellies.forEach((j, i) => this.setActive(j, i < P.jelly, [j.group, j.tentacleObject]));
    }
    if (!only || only === 'crab') {
      while (this.crabs.length < P.crab) {
        const [x, z, range, zRange, hue] = CRAB_DEFS[this.crabs.length % CRAB_DEFS.length];
        const c = new Crab(ctx, new THREE.Vector3(x, ctx.terrain.heightAt(x, z), z), range, zRange, hue);
        this.crabs.push(c);
        this.group.add(c.group);
      }
      this.crabs.forEach((c, i) => this.setActive(c, i < P.crab, [c.group]));
    }
    if (!only || only === 'hermit') {
      while (this.hermits.length < P.hermit) {
        const [x, z, seed] = HERMIT_DEFS[this.hermits.length % HERMIT_DEFS.length];
        const h = new HermitCrab(ctx, new THREE.Vector3(x, ctx.terrain.heightAt(x, z), z), seed);
        this.hermits.push(h);
        this.group.add(h.group);
      }
      this.hermits.forEach((h, i) => this.setActive(h, i < P.hermit, [h.group]));
    }
    if (!only || only === 'ray') this.setActive(this.ray, P.ray > 0, [this.ray.group]);
    if (!only || only === 'octopus') this.setActive(this.octopus, P.octopus > 0, [this.octopus.group, this.octopus.inkObject]);
  }

  private setActive(c: { active: boolean }, on: boolean, objs: THREE.Object3D[]) {
    c.active = on;
    for (const o of objs) o.visible = on;
  }

  // ------------------------------------------------------------------ events
  /** Splash / click on the water surface. */
  ripple(x: number, z: number, strength: number) {
    const y = this.ctx.water.heightAt(x, z);
    this.fish.startle(x, y - 0.5, z, 2.2 + strength * 1.2);
  }

  /** Something disturbed the seabed (sand landing, objects moved, removal brush). */
  seabedDisturbance(x: number, z: number, strength = 1) {
    const y = this.ctx.terrain.heightAt(x, z);
    const p = new THREE.Vector3(x, y, z);
    for (const c of this.crabs) if (c.active) c.disturb(x, z, strength);
    for (const h of this.hermits) if (h.active) h.disturb(x, z, strength);
    if (this.octopus.active) this.octopus.disturb(p, strength);
    this.fish.addDisturbance(p.setY(y + 0.4), 1.4 * strength, 1.2);
  }

  /** Hover near water surface: fish keep a little distance (limited reaction). */
  surfaceHover(p: THREE.Vector3) {
    this.fish.addDisturbance(p, 1.2, 0.6);
  }

  /** Raycasts creatures (Creature Interaction poke / inspect tooltip). */
  pick(rc: THREE.Raycaster): PickResult | null {
    const hits: { d: number; r: PickResult }[] = [];
    const test = (obj: THREE.Object3D, make: (h: THREE.Intersection) => PickResult) => {
      if (!obj.visible) return;
      const h = rc.intersectObject(obj, true)[0];
      if (h) hits.push({ d: h.distance, r: make(h) });
    };
    for (const j of this.jellies) test(j.group, (h) => ({ kind: 'jelly', jelly: j, point: h.point }));
    for (const c of this.crabs) test(c.group, (h) => ({ kind: 'crab', crab: c, point: h.point }));
    for (const hc of this.hermits) test(hc.group, (h) => ({ kind: 'hermit', hermit: hc, point: h.point }));
    test(this.octopus.group, (h) => ({ kind: 'octopus', point: h.point }));
    test(this.ray.group, (h) => ({ kind: 'ray', point: h.point }));
    for (const m of this.fish.group.children) {
      if (!m.name.startsWith('fish-') || m.name.startsWith('fish-eyes')) continue;
      const h = rc.intersectObject(m, false)[0];
      if (h && h.instanceId !== undefined) {
        const f = this.fish.fish.find((x) => `fish-${x.species}` === m.name && x.inst === h.instanceId);
        if (f && f.active) hits.push({ d: h.distance, r: { kind: 'fish', fish: f, point: h.point } });
      }
    }
    hits.sort((a, b) => a.d - b.d);
    return hits[0]?.r ?? null;
  }

  /** Short description for the hover inspector. */
  describe(r: PickResult): string {
    switch (r.kind) {
      case 'fish':
        return `${r.fish.spec.label} · ${this.fish.moodOf(r.fish)}`;
      case 'jelly':
        return `Moon jelly · ${this.night > 0.5 ? 'glowing softly' : 'drifting'}`;
      case 'crab':
        return `Crab · ${r.crab.label}`;
      case 'hermit':
        return `Hermit crab · ${r.hermit.label}`;
      case 'octopus':
        return `Octopus · ${this.octopus.label}`;
      case 'ray':
        return `Blue-spotted stingray · ${this.ray.label}`;
    }
  }

  /** Species-specific reaction to a poke. */
  poke(r: PickResult) {
    switch (r.kind) {
      case 'fish':
        this.fish.startle(r.point.x, r.point.y, r.point.z, 1.6);
        break;
      case 'jelly':
        r.jelly.poke(r.point);
        break;
      case 'crab':
        r.crab.poke(r.point);
        break;
      case 'hermit':
        r.hermit.poke();
        break;
      case 'octopus':
        this.octopus.poke(r.point);
        break;
      case 'ray':
        this.ray.poke(r.point);
        break;
    }
  }

  /** A strong painted current passed by: crabs brace, the octopus may tuck away, fish give way. */
  currentDisturbance(p: THREE.Vector3, radius: number) {
    for (const c of this.crabs) if (c.active && c.pos.distanceTo(p) < radius + 0.8) c.disturb(p.x, p.z, 0.6);
    for (const h of this.hermits) if (h.active && h.pos.distanceTo(p) < radius + 0.8) h.disturb(p.x, p.z, 0.6);
    if (this.octopus.active && this.octopus.pos.distanceTo(p) < radius + 0.6) this.octopus.disturb(p, 0.8);
    this.fish.addDisturbance(p, radius, 0.5);
  }

  /** Night: jellies glow, fish rest (consumed by the creature updates). */
  setNight(n: number) {
    this.night = n;
    for (const j of this.jellies) j.nightGlow = n;
    this.fish.night = n;
  }

  /** A handful of currently fast-moving fish (they stir bioluminescent plankton at night). */
  fastFishPositions() {
    this.fastFish.length = 0;
    if (this.night < 0.05) return this.fastFish;
    for (const f of this.fish.fish) {
      if (!f.active) continue;
      if (f.vel.lengthSq() > 1.4) this.fastFish.push(f.pos);
      if (this.fastFish.length >= 10) break;
    }
    return this.fastFish;
  }

  /** Pointer hovering in the water: nearby jellyfish glow softly. */
  hoverAt(p: THREE.Vector3) {
    for (const j of this.jellies) if (j.active && j.pos.distanceTo(p) < 1.6) j.glowUp(0.45);
  }

  update(dt: number, time: number) {
    const obs = this.creatureObs;
    obs.length = 0;
    if (this.ray.active) obs.push({ center: this.ray.pos, radius: this.ray.radius });
    for (const j of this.jellies) if (j.active) obs.push({ center: j.pos, radius: j.radius });
    for (const c of this.crabs) if (c.active) obs.push({ center: c.pos, radius: c.radius });
    for (const h of this.hermits) if (h.active) obs.push({ center: h.pos, radius: h.radius });
    if (this.octopus.active && this.octopus.state !== 'hidden' && this.octopus.state !== 'buried') obs.push({ center: this.octopus.pos, radius: this.octopus.radius });

    this.food.update(dt, time);
    this.fish.update(dt, time);
    if (this.ray.active) this.ray.update(dt, time);
    for (const j of this.jellies) if (j.active) j.update(dt, time);
    for (const c of this.crabs) if (c.active) c.update(dt, time);
    for (const h of this.hermits) if (h.active) h.update(dt, time);
    if (this.octopus.active) this.octopus.update(dt, time);
  }

  reset() {
    this.food.clear();
    this.fish.resetBehaviors();
    this.ray.reset();
    this.jellies.forEach((j, i) => j.reset(JELLY_STARTS[i % JELLY_STARTS.length].clone().add(new THREE.Vector3(rand(-0.5, 0.5), 0, 0))));
    this.crabs.forEach((c, i) => {
      const [x, z] = CRAB_DEFS[i % CRAB_DEFS.length];
      c.reset(new THREE.Vector3(x, this.ctx.terrain.heightAt(x, z), z));
    });
    this.hermits.forEach((h, i) => {
      const [x, z] = HERMIT_DEFS[i % HERMIT_DEFS.length];
      h.reset(new THREE.Vector3(x, this.ctx.terrain.heightAt(x, z), z));
    });
    this.octopus.reset();
  }

  /** Restore default populations (Reset World). */
  resetPopulation() {
    Object.assign(this.population, POP_DEFAULTS);
    this.applyPopulation();
  }
}
