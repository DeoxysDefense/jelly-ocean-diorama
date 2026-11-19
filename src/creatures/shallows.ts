/**
 * Keeping swimmers out of water that has become too shallow (sea level / tide dropping, a raised
 * island or dune): they head for deeper water instead of being squeezed into the sand.
 */
export interface DepthSource {
  terrain: { heightAt(x: number, z: number): number };
  water: { heightAt(x: number, z: number): number };
}

export function depthAt(ctx: DepthSource, x: number, z: number) {
  return ctx.water.heightAt(x, z) - ctx.terrain.heightAt(x, z);
}

const RADII = [0.6, 1.2, 2.2, 3.5, 5.5, 8, 12];
const ANGLES = 12;

/**
 * Finds the nearest point (ring search) with at least `need` depth. Fills `out` with the unit
 * direction (x, z) and `out.dist` with the distance; false when there is none within 12 units.
 */
export function towardDeep(ctx: DepthSource, x: number, z: number, need: number, out: { x: number; z: number; dist: number }, zMin = -Infinity, zMax = Infinity) {
  for (const r of RADII) {
    let best = -Infinity,
      bx = 0,
      bz = 0;
    for (let i = 0; i < ANGLES; i++) {
      const a = (i / ANGLES) * Math.PI * 2 + r; // stagger the rings
      const px = x + Math.cos(a) * r,
        pz = z + Math.sin(a) * r;
      if (pz < zMin || pz > zMax) continue;
      const d = depthAt(ctx, px, pz);
      if (d >= need && d > best) {
        best = d;
        bx = px;
        bz = pz;
      }
    }
    if (best > -Infinity) {
      const dx = bx - x,
        dz = bz - z;
      const l = Math.sqrt(dx * dx + dz * dz) || 1;
      out.x = dx / l;
      out.z = dz / l;
      out.dist = l;
      return true;
    }
  }
  return false;
}
