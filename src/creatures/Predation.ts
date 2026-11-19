import * as THREE from 'three';
import { outsideView } from '../config';
import { rand } from '../util/math';
import type { Fish, FishSystem } from './FishSystem';
import type { WorldContext } from './types';

/**
 * Predators and prey, kept gentle: a barracuda now and then stalks a school and strikes through
 * it (the school balls up, then bursts apart), and a grouper lies in wait beside a rock and
 * lunges at a passing fish. Most attempts fail, as in the sea; when one succeeds, the fish is
 * simply gone and a newcomer joins the population a minute or two later, so nothing ever needs
 * looking after.
 */

/** Chance that a strike / lunge actually catches something. */
export const STRIKE_SUCCESS = 0.18;
export const LUNGE_SUCCESS = 0.25;
/** Prey a grouper will go for (small enough to swallow). */
const SMALL_FISH = new Set(['silverside', 'cardinal', 'sergeant', 'wrasse', 'tang', 'butterfly', 'snapper']);
/** Schools a barracuda will hunt (index into the FishSystem's schools). */
const PREY_SCHOOLS = [0, 1, 2, 3];

type StrikePhase = 'approach' | 'stalk' | 'strike' | 'after';
interface Strike {
  hunter: Fish;
  school: number;
  phase: StrikePhase;
  t: number;
  dir: THREE.Vector3;
  rolled: boolean;
  flashed: boolean;
}
type AmbushPhase = 'settle' | 'lurk' | 'lunge';
interface Ambush {
  hunter: Fish;
  phase: AmbushPhase;
  t: number;
  spot: THREE.Vector3;
  prey: Fish | null;
  scanT: number;
}

export class Predation {
  private strike: Strike | null = null;
  private ambush: Ambush | null = null;
  private strikeCool = rand(90, 200);
  private ambushCool = rand(40, 110);
  private refills: { species: string; at: number }[] = [];
  private clock = 0;
  private centre = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  /** Hunts and catches since start (debug / tests). */
  readonly stats = { strikes: 0, ambushes: 0, caught: 0 };

  constructor(
    private fs: FishSystem,
    private ctx: WorldContext,
  ) {}

  reset() {
    if (this.strike) this.release(this.strike.hunter);
    if (this.ambush) this.release(this.ambush.hunter);
    this.strike = null;
    this.ambush = null;
    this.refills.length = 0;
    this.fs.schoolAlarm.fill(0);
  }

  /** Starts a hunt now (debugging / screenshots): `__jelly.creatures.fish.predation.trigger('strike')`. */
  trigger(kind: 'strike' | 'ambush') {
    if (kind === 'strike') {
      this.strikeCool = 0;
      return this.startStrike(true);
    }
    this.ambushCool = 0;
    return this.startAmbush(true);
  }

  get busy() {
    return { strike: this.strike?.phase ?? null, ambush: this.ambush?.phase ?? null };
  }

  update(dt: number) {
    this.clock += dt;
    // dusk and dawn are hunting time
    const twilight = this.fs.night > 0.15 && this.fs.night < 0.85 ? 1.8 : 1;
    this.strikeCool -= dt * twilight;
    this.ambushCool -= dt * twilight;
    if (!this.strike && this.strikeCool <= 0) {
      if (!this.startStrike(false)) this.strikeCool = rand(20, 40);
    }
    if (!this.ambush && this.ambushCool <= 0) {
      if (!this.startAmbush(false)) this.ambushCool = rand(20, 40);
    }
    if (this.strike) this.updateStrike(dt);
    if (this.ambush) this.updateAmbush(dt);
    // the alarm of a school fades once the hunter has gone
    for (let s = 0; s < this.fs.schoolAlarm.length; s++) {
      if (this.strike && this.strike.school === s && this.strike.phase !== 'after') continue;
      this.fs.schoolAlarm[s] = Math.max(0, this.fs.schoolAlarm[s] - dt * 0.25);
    }
    // newcomers replace the fish that were caught
    for (let i = this.refills.length - 1; i >= 0; i--) {
      const r = this.refills[i];
      if (this.clock < r.at) continue;
      this.refills.splice(i, 1);
      this.fs.setCount(r.species, this.fs.want[r.species]);
    }
  }

  // -------------------------------------------------------------- barracuda strike
  private startStrike(force: boolean) {
    const hunters = this.fs.fish.filter((f) => f.active && !f.leaving && f.species === 'barracuda' && f.mode === 'school');
    if (!hunters.length) return false;
    const hunter = hunters[Math.floor(Math.random() * hunters.length)];
    // a school within reach, preferring one that is in view
    let best = -1,
      bestW = 0;
    for (const s of PREY_SCHOOLS) {
      const n = this.fs.schoolCenter(s, this.centre);
      if (n < 6) continue;
      const d = this.centre.distanceTo(hunter.pos);
      if (d > 45) continue;
      const w = (outsideView(this.centre.x) ? 1 : 3) * (1 - d / 50) * Math.random();
      if (w > bestW) {
        bestW = w;
        best = s;
      }
    }
    if (best < 0) return false;
    this.strike = { hunter, school: best, phase: 'approach', t: force ? 40 : 75, dir: new THREE.Vector3(), rolled: false, flashed: false };
    hunter.mode = 'hunt';
    hunter.huntSpeed = 2.2;
    hunter.huntMax = 1;
    hunter.huntAccel = 1.2;
    this.stats.strikes++;
    return true;
  }

  private updateStrike(dt: number) {
    const S = this.strike!;
    const f = S.hunter;
    S.t -= dt;
    if (!f.active || f.leaving || f.mode !== 'hunt') return this.endStrike();
    const n = this.fs.schoolCenter(S.school, this.centre);
    if (n < 3) return this.endStrike();
    const toC = this.tmp.copy(this.centre).sub(f.pos);
    const d = toC.length();
    switch (S.phase) {
      case 'approach':
        // cruise up to a few body lengths from the school, unhurried
        f.target.copy(this.centre).addScaledVector(toC.normalize(), -3.2);
        if (d < 3.8) {
          S.phase = 'stalk';
          S.t = rand(3, 6);
          f.huntSpeed = 0.7;
        } else if (S.t <= 0) this.endStrike();
        break;
      case 'stalk':
        // the school has seen it: it balls up and slows; the barracuda edges closer
        this.fs.schoolAlarm[S.school] = Math.min(1, this.fs.schoolAlarm[S.school] + dt * 0.8);
        f.target.copy(this.centre).addScaledVector(toC.normalize(), -2.2);
        if (S.t <= 0) {
          S.phase = 'strike';
          S.t = 1.3;
          S.dir.copy(this.centre).sub(f.pos).normalize();
          f.huntSpeed = 9;
          f.huntMax = 1.6;
          f.huntAccel = 5;
          this.ctx.sight?.('barracudaStrike', f.pos);
        }
        break;
      case 'strike': {
        // a straight dash through the middle of the school
        f.target.copy(f.pos).addScaledVector(S.dir, 3);
        if (!S.flashed && d < 1.4) {
          S.flashed = true;
          this.flash(S.school, f);
        }
        if (!S.rolled) {
          const prey = this.nearestOfSchool(S.school, f, 0.5);
          if (prey) {
            S.rolled = true;
            if (Math.random() < STRIKE_SUCCESS) this.catch(prey, f);
          }
        }
        if (S.t <= 0) {
          S.phase = 'after';
          S.t = rand(4, 7);
          f.huntSpeed = 0.6;
          f.huntMax = 1;
          f.huntAccel = 1;
        }
        break;
      }
      case 'after':
        f.target.copy(f.pos).addScaledVector(S.dir, 2);
        if (S.t <= 0) this.endStrike();
        break;
    }
  }

  private endStrike() {
    if (this.strike) this.release(this.strike.hunter);
    this.strike = null;
    this.strikeCool = rand(150, 320);
  }

  /** The school bursts away from the attacker's path ("flash expansion"). */
  private flash(school: number, hunter: Fish) {
    const fwd = hunter.fwd;
    for (const f of this.fs.fish) {
      if (!f.active || f.b.school !== school || f.mode === 'away') continue;
      const rel = this.tmp.copy(f.pos).sub(hunter.pos);
      const d = rel.length();
      if (d > 2.6) continue;
      // away from the line of attack, a little forward
      rel.addScaledVector(fwd, -rel.dot(fwd)).addScaledVector(fwd, 0.35);
      if (rel.lengthSq() < 1e-4) rel.set(Math.random() - 0.5, 0.2, Math.random() - 0.5);
      f.target.copy(rel.normalize());
      f.mode = 'flee';
      f.timer = rand(0.5, 1.1);
      f.food = -1;
    }
  }

  private nearestOfSchool(school: number, hunter: Fish, reach: number) {
    let best: Fish | null = null,
      bd = reach + hunter.spec.size * 0.4;
    const head = this.tmp.copy(hunter.pos).addScaledVector(hunter.fwd, hunter.spec.size * 0.45);
    for (const f of this.fs.fish) {
      if (!f.active || f.b.school !== school) continue;
      const d = f.pos.distanceTo(head);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  // -------------------------------------------------------------- grouper ambush
  private startAmbush(force: boolean) {
    const hunters = this.fs.fish.filter((f) => f.active && !f.leaving && f.species === 'grouper' && f.mode === 'wander');
    if (!hunters.length) return false;
    // prefer a grouper with small fish around (and, all else equal, one in view)
    let hunter: Fish | null = null,
      bestW = 0;
    for (const g of hunters) {
      let prey = 0;
      for (const f of this.fs.fish) if (f.active && SMALL_FISH.has(f.species) && f.pos.distanceTo(g.pos) < 9) prey++;
      const w = (prey + (force ? 1 : 0)) * (outsideView(g.pos.x) ? 1 : 2) * (0.5 + Math.random());
      if (w > bestW) {
        bestW = w;
        hunter = g;
      }
    }
    if (!hunter) return false;
    // a hiding place: beside the nearest rock or coral head, close to the seabed
    let spot: THREE.Vector3 | null = null,
      bd = 7;
    for (const s of this.ctx.reef.selectables) {
      if (s.kind !== 'rock' && s.kind !== 'coral') continue;
      const d = s.object.position.distanceTo(hunter.pos);
      if (d < bd) {
        bd = d;
        const p = s.object.position;
        const side = hunter.pos.x < p.x ? -1 : 1;
        // just outside the distance its obstacle avoidance keeps from the rock
        spot = new THREE.Vector3(p.x + side * (s.radius + 0.4 + hunter.spec.size * 0.45), 0, p.z + 0.3);
      }
    }
    if (!spot) return false;
    const g = this.ctx.terrain.heightAt(spot.x, spot.z);
    spot.y = Math.min(g + 0.32, this.ctx.water.heightAt(spot.x, spot.z) - 0.5);
    if (spot.y < g + 0.15) return false;
    this.ambush = { hunter, phase: 'settle', t: 45, spot, prey: null, scanT: 0 };
    hunter.mode = 'hunt';
    hunter.target.copy(spot);
    hunter.huntSpeed = 2;
    hunter.huntMax = 1;
    hunter.huntAccel = 1;
    this.stats.ambushes++;
    return true;
  }

  private updateAmbush(dt: number) {
    const A = this.ambush!;
    const f = A.hunter;
    A.t -= dt;
    if (!f.active || f.leaving || f.mode !== 'hunt') return this.endAmbush(false);
    switch (A.phase) {
      case 'settle':
        f.target.copy(A.spot);
        if (f.pos.distanceTo(A.spot) < 0.8) {
          A.phase = 'lurk';
          A.t = rand(40, 100);
          f.huntSpeed = 0.06;
        } else if (A.t <= 0) this.endAmbush(false);
        break;
      case 'lurk': {
        // almost motionless in the rock's shadow, watching
        f.target.copy(A.spot);
        A.scanT -= dt;
        if (A.scanT <= 0) {
          A.scanT = 0.2;
          const prey = this.preyInFront(f, 1.6);
          if (prey) {
            A.prey = prey;
            A.phase = 'lunge';
            A.t = 0.45;
            f.huntSpeed = 10;
            f.huntMax = 2.2;
            f.huntAccel = 6;
            this.ctx.sight?.('grouperAmbush', f.pos);
          }
        }
        if (A.t <= 0) this.endAmbush(false);
        break;
      }
      case 'lunge': {
        const p = A.prey!;
        f.target.copy(p.pos).addScaledVector(p.vel, 0.25);
        if (A.t <= 0) {
          // the suction lifts a little sand; the fish around scatter
          const mouth = this.tmp.copy(f.pos).addScaledVector(f.fwd, f.spec.size * 0.5);
          this.ctx.fx?.dust(mouth.x, mouth.y - 0.1, mouth.z, 6);
          const caught = p.active && p.pos.distanceTo(mouth) < 0.5 + p.spec.size * 0.4 && Math.random() < LUNGE_SUCCESS;
          if (caught) this.catch(p, f);
          this.fs.startle(mouth.x, mouth.y, mouth.z, 2.4, f);
          this.endAmbush(true);
        }
        break;
      }
    }
  }

  private preyInFront(f: Fish, reach: number) {
    let best: Fish | null = null,
      bd = reach;
    for (const o of this.fs.fish) {
      if (!o.active || o === f || o.mode === 'away' || !SMALL_FISH.has(o.species)) continue;
      const rel = this.tmp.copy(o.pos).sub(f.pos);
      const d = rel.length();
      if (d > bd) continue;
      if (rel.dot(f.fwd) < 0.15 * d) continue; // behind it
      if (Math.abs(rel.y) > 0.6) continue; // groupers lunge forward, not straight up
      bd = d;
      best = o;
    }
    return best;
  }

  private endAmbush(struck: boolean) {
    if (this.ambush) this.release(this.ambush.hunter);
    this.ambush = null;
    this.ambushCool = struck ? rand(80, 170) : rand(40, 90);
  }

  // -------------------------------------------------------------- shared
  private release(f: Fish) {
    if (f.mode === 'hunt') f.mode = f.b.school >= 0 ? 'school' : 'wander';
    f.huntSpeed = 1;
    f.huntMax = 1;
    f.huntAccel = 1;
    f.timer = 0;
  }

  /** A catch: the fish is simply gone; a newcomer joins in a minute or two. */
  private catch(prey: Fish, hunter: Fish) {
    prey.active = false;
    prey.mode = prey.b.school >= 0 ? 'school' : 'wander';
    this.ctx.fx?.bubbles(prey.pos.x, prey.pos.y, prey.pos.z, 3);
    this.refills.push({ species: prey.species, at: this.clock + rand(60, 150) });
    this.stats.caught++;
    void hunter;
  }
}
