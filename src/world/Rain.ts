import * as THREE from 'three';
import { randZ } from '../config';
import { rand } from '../util/math';
import type { WaterSurfaceSimulation } from '../water/WaterSurfaceSimulation';
import type { TerrainSystem } from './TerrainSystem';

/**
 * Rain: falling streaks that become micro ripples where they hit the water surface
 * (shared heightfield, so the rings are identical in Front and Top View).
 */
export class Rain {
  readonly max = 700;
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private drops: Float32Array; // x, y, z, speed
  private active = 0;
  onDrop?: (x: number, z: number) => void;

  constructor(private water: WaterSurfaceSimulation, private terrain: TerrainSystem) {
    this.pos = new Float32Array(this.max * 6);
    this.drops = new Float32Array(this.max * 4);
    for (let i = 0; i < this.max; i++) this.spawn(i, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xdbe8f0, transparent: true, opacity: 0.32, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 9;
    this.lines.visible = false;
  }

  private spawn(i: number, anywhere = false) {
    this.drops[i * 4] = rand(-21, 21);
    this.drops[i * 4 + 1] = anywhere ? rand(0, 11) : rand(9, 12);
    this.drops[i * 4 + 2] = randZ(0.2);
    this.drops[i * 4 + 3] = rand(11, 15);
  }

  update(dt: number, rain: number, wind: number, night: number) {
    const target = Math.floor(this.max * rain);
    this.active = target;
    this.lines.visible = target > 0;
    (this.lines.material as THREE.LineBasicMaterial).opacity = 0.32 * (0.45 + 0.55 * (1 - night));
    if (!target) return;
    const slant = 0.15 + wind * 0.5;
    for (let i = 0; i < this.max; i++) {
      const k = i * 4,
        p = i * 6;
      if (i >= target) {
        this.pos.fill(0, p, p + 6);
        continue;
      }
      const sp = this.drops[k + 3];
      this.drops[k] += sp * slant * dt;
      this.drops[k + 1] -= sp * dt;
      const x = this.drops[k],
        y = this.drops[k + 1],
        z = this.drops[k + 2];
      const surf = this.water.heightAt(x, z);
      const ground = this.terrain.heightAt(x, z);
      if (y <= Math.max(surf, ground)) {
        if (surf > ground) {
          this.water.addRipple(x, z, rand(0.012, 0.03) * (0.6 + rain * 0.6));
          if (Math.random() < 0.08) this.water.disturb(x, z, -0.06, 0.2);
          this.onDrop?.(x, z);
        }
        this.spawn(i);
        continue;
      }
      const len = 0.35;
      this.pos[p] = x;
      this.pos[p + 1] = y;
      this.pos[p + 2] = z;
      this.pos[p + 3] = x - slant * len;
      this.pos[p + 4] = y + len;
      this.pos[p + 5] = z;
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
