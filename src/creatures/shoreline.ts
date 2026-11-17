import type { WorldContext } from './types';
import { zClamp } from '../config';

/**
 * Keeps bottom-walking creatures (crabs, hermit crabs) under water. The seabed counts as "wet"
 * when it sits far enough below the still-water level that the whole body stays submerged even
 * in a wave trough: a fixed body height plus most of the current wind-wave amplitude, so crabs
 * keep to deeper water on stormy days. Works with tides, sand piles and stamped islands because
 * it only looks at the live terrain height, sea level and waves.
 */
const BODY = 0.4;

/** Required water depth over the seabed right now. */
export function wetMargin(ctx: WorldContext) {
  const amps = ctx.water.waves.amps;
  let sum = 0;
  for (let i = 0; i < amps.length; i++) sum += amps[i];
  return BODY + 0.75 * sum;
}

/** > 0: the seabed at (x, z) is too shallow / dry for a crab. */
export function dryness(ctx: WorldContext, x: number, z: number) {
  return ctx.terrain.heightAt(x, z) - (ctx.water.level - wetMargin(ctx));
}

/** Nearest comfortably wet point around (x, z), searching outward in rings. */
export function findWet(ctx: WorldContext, x: number, z: number, out: { x: number; z: number }, maxR = 10) {
  for (let r = 0.5; r <= maxR; r += 0.5) {
    let best = Infinity;
    const n = Math.max(8, Math.round(r * 6));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = zClamp(z + Math.sin(a) * r, 0.8);
      const d = dryness(ctx, px, pz);
      if (d < -0.4 && d < best) {
        best = d;
        out.x = px;
        out.z = pz;
      }
    }
    if (best < Infinity) return true;
  }
  return false;
}

/**
 * Movement gate: a step that ends on dry/too-shallow ground is undone, unless the creature is
 * already stranded (tide went out, sand piled on it) and the step takes it toward deeper water.
 * Returns true when the step was blocked.
 */
export function gateStep(ctx: WorldContext, pos: { x: number; z: number }, ox: number, oz: number) {
  const dNew = dryness(ctx, pos.x, pos.z);
  if (dNew <= 0) return false;
  const dOld = dryness(ctx, ox, oz);
  if (dOld > 0 && dNew < dOld + 0.02) return false; // stranded: let it walk down to the water
  pos.x = ox;
  pos.z = oz;
  return true;
}
