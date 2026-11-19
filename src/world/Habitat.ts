import * as THREE from 'three';
import { CONFIG } from '../config';
import { rand } from '../util/math';
import type { TerrainSystem } from './TerrainSystem';
import type { Reef } from './Reef';
import { ARCHI } from './Archipelago';

/**
 * V2 habitat map: where in the tray each kind of water is. Creatures pick their next spot from
 * the habitats their species likes (reef fish → reefs, schools → open water, grouper → the deep
 * slope …), so life spreads over the whole archipelago by habit instead of by hand-made boxes.
 *
 *  mainReef   — the v1 reef corals (centre / right of the main island)
 *  lagoonReef — the western patch reefs
 *  seagrass   — the lagoon's seagrass meadows
 *  lagoon     — open shallow water of the western lagoon
 *  slope      — the drop-off into the east deep water
 *  deep       — the deep east floor and water above it
 *  open       — any water at least 3 units deep (mid-water)
 */
export type HabitatKind = 'mainReef' | 'lagoonReef' | 'seagrass' | 'lagoon' | 'slope' | 'deep' | 'open';

export class Habitat {
  private anchors = new Map<HabitatKind, THREE.Vector3[]>();
  private built = false;

  constructor(private terrain: TerrainSystem, private reef: Reef) {}

  /** Lazily samples the terrain + reef once (the world exists by the time anyone asks). */
  private build() {
    if (this.built) return;
    this.built = true;
    const W = CONFIG.world;
    const sel = this.reef.selectables;
    const pos = (s: (typeof sel)[number]) => s.object.position.clone();
    this.anchors.set('mainReef', sel.filter((s) => (s.kind === 'coral' || s.kind === 'rock') && !s.id.startsWith('w2-') && s.object.position.x > 3).map(pos));
    this.anchors.set('lagoonReef', sel.filter((s) => s.id.startsWith('w2-p') && s.kind === 'coral').map(pos));
    this.anchors.set('seagrass', sel.filter((s) => s.kind === 'seagrass' && s.object.position.x < -24).map(pos));
    const grid = (x0: number, x1: number, minDepth: number, maxDepth = 99) => {
      const out: THREE.Vector3[] = [];
      for (let x = x0; x <= x1; x += 1.4)
        for (let z = W.zBack + 1.2; z <= W.zFront - 1; z += 1.4) {
          const g = this.terrain.heightAt(x, z);
          const d = W.waterLevel - g;
          if (d >= minDepth && d <= maxDepth) out.push(new THREE.Vector3(x, g, z));
        }
      return out;
    };
    this.anchors.set('lagoon', grid(W.xMin + 1.5, -25, 1.8));
    this.anchors.set('slope', grid(ARCHI.deep.xMin - 1, ARCHI.deep.xFull + 1, 3.5));
    this.anchors.set('deep', grid(ARCHI.deep.xFull, W.xMax - 1.5, 7));
    this.anchors.set('open', grid(W.xMin + 1.5, W.xMax - 1.5, 3.2));
  }

  count(kind: HabitatKind) {
    this.build();
    return this.anchors.get(kind)?.length ?? 0;
  }

  /**
   * A swimmable point in a habitat. `band` is where in the water column: 0 = just above the
   * seabed, 1 = just under the surface. Reef / meadow anchors get a small jitter around them.
   */
  sample(kind: HabitatKind, band: [number, number], out = new THREE.Vector3(), level = CONFIG.world.waterLevel): THREE.Vector3 | null {
    this.build();
    const list = this.anchors.get(kind);
    if (!list || !list.length) return null;
    const jitter = kind === 'mainReef' || kind === 'lagoonReef' || kind === 'seagrass' ? 1.4 : 0.7;
    for (let i = 0; i < 8; i++) {
      const a = list[Math.floor(Math.random() * list.length)];
      const x = a.x + rand(-jitter, jitter),
        z = Math.max(CONFIG.world.zBack + 0.8, Math.min(CONFIG.world.zFront - 0.8, a.z + rand(-jitter, jitter)));
      const g = this.terrain.heightAt(x, z);
      const lo = g + 0.35,
        hi = level - 0.35;
      if (hi - lo < 0.5) continue;
      return out.set(x, lo + (hi - lo) * rand(band[0], band[1]), z);
    }
    return null;
  }

  /** Weighted pick of a habitat kind. */
  static pick(weights: Partial<Record<HabitatKind, number>>): HabitatKind {
    let total = 0;
    for (const w of Object.values(weights)) total += w ?? 0;
    let r = Math.random() * total;
    for (const [k, w] of Object.entries(weights)) if ((r -= w ?? 0) <= 0) return k as HabitatKind;
    return Object.keys(weights)[0] as HabitatKind;
  }
}
