import * as THREE from 'three';
import { CONFIG, outsideView } from '../config';
import { rand } from '../util/math';
import { FishSystem, FISH_CAP, EXTRA_FISH_DEFAULTS, type Fish } from './FishSystem';
import { Crawler, GardenEels, Shrimp } from './LagoonLife';
import { FoodSystem } from './FoodSystem';
import { Stingray } from './Stingray';
import { Jellyfish } from './Jellyfish';
import { Crab } from './Crab';
import { Octopus } from './Octopus';
import { HermitCrab } from './HermitCrab';
import type { WorldContext } from './types';
import type { Obstacle } from '../world/Reef';
import { PAGES } from '../content/notebook';
import { tr, uiLang } from '../ui/lang';

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
/** V2: lagoon crabs around the sand cay and the boulder cluster: x, z, x-range, z-range, hue, shore box. */
const LAGOON_CRAB_DEFS: [number, number, [number, number], [number, number], number, [number, number, number, number]][] = [
  [-30.0, 2.0, [-35, -26], [0.5, 4.5], 0.05, [-39, -29, -2, 0]],
  [-39.0, 1.0, [-44, -34], [-0.5, 3.5], 0.0, [-44, -36, -4, -1]],
  [-48.0, -8.0, [-50, -45], [-11, -4], 0.08, [-48, -40, -17, -10]],
  [-33.5, -11.0, [-39, -28], [-14, -9], 0.02, [-39, -29, -9, -7]],
  [-27.0, 3.5, [-31, -25], [1.5, 4.8], 0.06, [-36, -29, -2, 0.5]],
  [-46.5, -2.5, [-50, -44], [-6, 1], 0.04, [-45, -38, -8, -4]],
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
  // V2 extra species (Life → Extra)
  sergeant: [0, FISH_CAP.sergeant],
  parrot: [0, FISH_CAP.parrot],
  wrasse: [0, FISH_CAP.wrasse],
  snapper: [0, FISH_CAP.snapper],
  barracuda: [0, FISH_CAP.barracuda],
  grouper: [0, FISH_CAP.grouper],
  lagoonCrab: [0, 6],
  shrimp: [0, 10],
  urchin: [0, 10],
  cucumber: [0, 6],
  gardenEel: [0, 16],
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
  ...EXTRA_FISH_DEFAULTS,
  lagoonCrab: 3,
  shrimp: 5,
  urchin: 5,
  cucumber: 3,
  gardenEel: 10,
};

export type PickResult =
  | { kind: 'fish'; fish: Fish; point: THREE.Vector3 }
  | { kind: 'jelly'; jelly: Jellyfish; point: THREE.Vector3 }
  | { kind: 'crab'; crab: Crab; point: THREE.Vector3 }
  | { kind: 'hermit'; hermit: HermitCrab; point: THREE.Vector3 }
  | { kind: 'octopus'; point: THREE.Vector3 }
  | { kind: 'ray'; point: THREE.Vector3 }
  | { kind: 'eels'; point: THREE.Vector3 }
  | { kind: 'crawler'; crawler: Crawler; point: THREE.Vector3 }
  | { kind: 'shrimp'; shrimp: Shrimp; point: THREE.Vector3 }
  | { kind: 'visitor'; key: string; label: string; point: THREE.Vector3; poke: () => void; notice?: () => void };

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
  /** V2 lagoon residents. */
  readonly lagoonCrabs: Crab[] = [];
  readonly eels: GardenEels;
  readonly crawlers: Crawler[] = [];
  readonly shrimps: Shrimp[] = [];
  private eelThreats: THREE.Vector3[] = [];
  /** P3 hooks: rare visitors are picked / avoided like residents. */
  extraPick?: (rc: THREE.Raycaster) => PickResult | null;
  extraObstacles?: () => Obstacle[];
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
    this.eels = new GardenEels(ctx, POP_LIMITS.gardenEel[1]);
    this.group.add(this.eels.group);
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
    if (!only || only === 'lagoonCrab') {
      while (this.lagoonCrabs.length < P.lagoonCrab) {
        const [x, z, range, zRange, hue, shore] = LAGOON_CRAB_DEFS[this.lagoonCrabs.length % LAGOON_CRAB_DEFS.length];
        const c = new Crab(ctx, new THREE.Vector3(x, ctx.terrain.heightAt(x, z), z), range, zRange, hue);
        c.shore = shore;
        c.rescueMaxX = range[1] + 3;
        this.lagoonCrabs.push(c);
        this.group.add(c.group);
      }
      this.lagoonCrabs.forEach((c, i) => this.setActive(c, i < P.lagoonCrab, [c.group]));
    }
    if (!only || only === 'urchin' || only === 'cucumber') {
      const want = (k: 'urchin' | 'cucumber') => P[k];
      for (const k of ['urchin', 'cucumber'] as const) {
        while (this.crawlers.filter((c) => c.kind === k).length < want(k)) {
          const c = new Crawler(ctx, k, this.crawlers.length * 13 + 5);
          this.crawlers.push(c);
          this.group.add(c.group);
        }
        let n = 0;
        for (const c of this.crawlers) if (c.kind === k) this.setActive(c, n++ < want(k), [c.group]);
      }
    }
    if (!only || only === 'shrimp') {
      while (this.shrimps.length < P.shrimp) {
        const s = new Shrimp(ctx, this.shrimps.length * 17 + 3);
        this.shrimps.push(s);
        this.group.add(s.group);
      }
      this.shrimps.forEach((s, i) => this.setActive(s, i < P.shrimp, [s.group]));
    }
    if (!only || only === 'gardenEel') this.eels.setCount(P.gardenEel);
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
    for (const c of this.lagoonCrabs) if (c.active) c.disturb(x, z, strength);
    for (const h of this.hermits) if (h.active) h.disturb(x, z, strength);
    this.eels.scare(p, 1.8 * strength);
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
    for (const c of this.lagoonCrabs) test(c.group, (h) => ({ kind: 'crab', crab: c, point: h.point }));
    for (const c of this.crawlers) test(c.group, (h) => ({ kind: 'crawler', crawler: c, point: h.point }));
    for (const s of this.shrimps) test(s.group, (h) => ({ kind: 'shrimp', shrimp: s, point: h.point }));
    test(this.eels.group, (h) => ({ kind: 'eels', point: h.point }));
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
    const v = this.extraPick?.(rc);
    if (v) hits.push({ d: rc.ray.origin.distanceTo(v.point), r: v });
    hits.sort((a, b) => a.d - b.d);
    return hits[0]?.r ?? null;
  }

  /** V2 journal: which species / kind a pick is (first observations). */
  speciesKey(r: PickResult): string {
    switch (r.kind) {
      case 'fish':
        return r.fish.species;
      case 'eels':
        return 'gardenEel';
      case 'crawler':
        return r.crawler.kind;
      case 'visitor':
        return r.key;
      default:
        return r.kind;
    }
  }

  /** How big a sketch frame the Field Notebook needs for this creature (world units). */
  sketchSize(r: PickResult): number {
    switch (r.kind) {
      case 'fish':
        return Math.max(0.8, r.fish.spec.size * (r.fish.b.school >= 0 ? 3.2 : 1.9));
      case 'visitor':
        return { whaleShark: 5.5, manta: 3.2, dolphin: 3, turtle: 1.8, flyingFish: 2.2, fusilier: 2.6 }[r.key] ?? 1.1;
      case 'ray':
        return 2;
      case 'octopus':
        return 1.6;
      case 'eels':
        return 1.8;
      case 'jelly':
        return 1.5;
      default:
        return 0.9;
    }
  }

  /** Short description for the hover inspector (in the interface language). */
  describe(r: PickResult): string {
    const zh = uiLang() === 'zh';
    const name = (key: string, en: string) => (zh && PAGES[key] ? PAGES[key].zh : en);
    const line = (key: string, en: string, mood: string) => `${name(key, en)} · ${tr(mood)}`;
    switch (r.kind) {
      case 'fish':
        return line(r.fish.species, r.fish.spec.label, this.fish.moodOf(r.fish));
      case 'jelly':
        return line('jelly', 'Moon jelly', this.night > 0.5 ? 'glowing softly' : 'drifting');
      case 'crab':
        return line('crab', 'Crab', r.crab.label);
      case 'hermit':
        return line('hermit', 'Hermit crab', r.hermit.label);
      case 'octopus':
        return line('octopus', 'Octopus', this.octopus.label);
      case 'ray':
        return line('ray', 'Blue-spotted stingray', this.ray.label);
      case 'eels':
        return line('gardenEel', 'Garden eels', this.eels.label);
      case 'crawler':
        return line(r.crawler.kind, r.crawler.kind === 'urchin' ? 'Sea urchin' : 'Sea cucumber', r.crawler.label);
      case 'shrimp':
        return line('shrimp', 'Cleaner shrimp', r.shrimp.label);
      case 'visitor': {
        const i = r.label.indexOf(' · ');
        return i < 0 ? name(r.key, r.label) : line(r.key, r.label.slice(0, i), r.label.slice(i + 3));
      }
    }
  }

  /** The individual a pick refers to (so the pointer resting on it is noticed once). */
  pickTarget(r: PickResult): unknown {
    switch (r.kind) {
      case 'fish':
        return r.fish;
      case 'jelly':
        return r.jelly;
      case 'crab':
        return r.crab;
      case 'hermit':
        return r.hermit;
      case 'crawler':
        return r.crawler;
      case 'shrimp':
        return r.shrimp;
      case 'visitor':
        return r.key;
      default:
        return r.kind;
    }
  }

  /** The pointer has rested on a creature for a moment: a gentle, short reaction. */
  notice(r: PickResult) {
    switch (r.kind) {
      case 'fish':
        this.fish.notice(r.fish, r.point);
        break;
      case 'crab':
        r.crab.display(r.point);
        break;
      case 'octopus':
        this.octopus.blush();
        break;
      case 'eels':
        this.eels.scare(r.point, 0.9);
        break;
      case 'ray':
        this.ray.nudge(r.point);
        break;
      case 'jelly':
        r.jelly.glowUp(0.5);
        break;
      case 'visitor':
        r.notice?.();
        break;
    }
  }

  /** Pressed and held on a creature (`p`: the pointer inside the water, if any). */
  hold(r: PickResult, p: THREE.Vector3 | null, dt: number) {
    switch (r.kind) {
      case 'fish':
        this.fish.holdStill(r.fish);
        break;
      case 'octopus':
        this.octopus.reach(p ?? r.point, dt);
        break;
      case 'jelly':
        if (p) r.jelly.towards(p, dt);
        break;
    }
  }

  /** Species-specific reaction to a poke. */
  poke(r: PickResult) {
    switch (r.kind) {
      case 'fish':
        this.fish.pokeFish(r.fish, r.point);
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
      case 'ray': {
        // a flick of the wings lifts a cloud of sand as it darts off
        const g = this.ctx.terrain.heightAt(this.ray.pos.x, this.ray.pos.z);
        if (this.ray.pos.y - g < 1.6) this.ctx.fx?.dust(this.ray.pos.x, g + 0.1, this.ray.pos.z, 10);
        this.ray.poke(r.point);
        break;
      }
      case 'eels':
        this.eels.poke(r.point);
        break;
      case 'crawler':
        r.crawler.poke(r.point);
        break;
      case 'shrimp':
        r.shrimp.poke(r.point);
        break;
      case 'visitor':
        r.poke();
        break;
    }
  }

  /** A strong painted current passed by: crabs brace, the octopus may tuck away, fish give way. */
  currentDisturbance(p: THREE.Vector3, radius: number) {
    for (const c of this.crabs) if (c.active && c.pos.distanceTo(p) < radius + 0.8) c.disturb(p.x, p.z, 0.6);
    for (const c of this.lagoonCrabs) if (c.active && c.pos.distanceTo(p) < radius + 0.8) c.disturb(p.x, p.z, 0.6);
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
    this.eels.scare(p, 1.2);
  }

  update(dt: number, time: number) {
    const obs = this.creatureObs;
    obs.length = 0;
    if (this.ray.active) obs.push({ center: this.ray.pos, radius: this.ray.radius });
    for (const j of this.jellies) if (j.active) obs.push({ center: j.pos, radius: j.radius });
    for (const c of this.crabs) if (c.active) obs.push({ center: c.pos, radius: c.radius });
    for (const c of this.lagoonCrabs) if (c.active) obs.push({ center: c.pos, radius: c.radius });
    if (this.extraObstacles) for (const o of this.extraObstacles()) obs.push(o);
    for (const h of this.hermits) if (h.active) obs.push({ center: h.pos, radius: h.radius });
    if (this.octopus.active && this.octopus.state !== 'hidden' && this.octopus.state !== 'buried') obs.push({ center: this.octopus.pos, radius: this.octopus.radius });

    this.food.update(dt, time);
    this.fish.update(dt, time);
    if (this.ray.active) this.ray.update(dt, time);
    for (const j of this.jellies) if (j.active) j.update(dt, time);
    for (const c of this.crabs) if (c.active) c.update(dt, time);
    // V2 lagoon residents: far off-screen ones update at a lower rate (cheap, never visible)
    this.slowT += dt;
    const slowTick = this.slowT >= 0.2;
    const sdt = slowTick ? this.slowT : 0;
    if (slowTick) this.slowT = 0;
    const near = (x: number) => !outsideView(x);
    for (const c of this.lagoonCrabs) if (c.active && (near(c.pos.x) || slowTick)) c.update(near(c.pos.x) ? dt : sdt, time);
    for (const c of this.crawlers) {
      c.night = this.night;
      if (c.active && (near(c.pos.x) || slowTick)) c.update(near(c.pos.x) ? dt : sdt, time);
    }
    for (const s of this.shrimps) if (s.active && (near(s.pos.x) || slowTick)) s.update(near(s.pos.x) ? dt : sdt, time);
    if (near(this.eels.pos.x) || slowTick) {
      // fish passing low over the colony make the eels duck
      this.eelThreats.length = 0;
      for (const f of this.fish.fish) if (f.active && f.spec.size > 0.5 && Math.abs(f.pos.x) > 20) this.eelThreats.push(f.pos);
      if (this.ray.active) this.eelThreats.push(this.ray.pos);
      this.eels.update(slowTick && !near(this.eels.pos.x) ? sdt : dt, time, this.eelThreats);
    }
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
    this.lagoonCrabs.forEach((c, i) => {
      const [x, z] = LAGOON_CRAB_DEFS[i % LAGOON_CRAB_DEFS.length];
      c.reset(new THREE.Vector3(x, this.ctx.terrain.heightAt(x, z), z));
    });
    this.crawlers.forEach((c) => c.reset());
    this.shrimps.forEach((s) => s.reset());
    this.eels.reset();
  }
  private slowT = 0;

  /** Restore default populations (Reset World). */
  resetPopulation() {
    Object.assign(this.population, POP_DEFAULTS);
    this.applyPopulation();
  }
}
