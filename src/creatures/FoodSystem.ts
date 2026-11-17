import * as THREE from 'three';
import { zClamp } from '../config';
import { CONFIG } from '../config';
import { rand } from '../util/math';
import type { TerrainSystem } from '../world/TerrainSystem';
import type { WaterSurfaceSimulation } from '../water/WaterSurfaceSimulation';
import type { FlowField } from '../world/FlowField';

export const enum FoodState {
  Dead = 0,
  Air = 1,
  Floating = 2,
  Sinking = 3,
  Settled = 4,
}

/**
 * Fish food pellets: fall through air, splash, float briefly, sink with drag and drift, then
 * settle on the seabed and fade if nobody eats them. Pooled InstancedMesh, hard capped.
 */
export class FoodSystem {
  readonly max = CONFIG.feed.maxPellets;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly state: Uint8Array;
  readonly timer: Float32Array;
  readonly mesh: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();
  private spin: Float32Array;
  onSplash?: (x: number, z: number) => void;
  flow: FlowField | null = null;
  private fv = new THREE.Vector3();

  constructor(private terrain: TerrainSystem, private water: WaterSurfaceSimulation) {
    const n = this.max;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.state = new Uint8Array(n);
    this.timer = new Float32Array(n);
    this.spin = new Float32Array(n);
    const g = new THREE.DodecahedronGeometry(0.045, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8823a, roughness: 0.7, emissive: 0x3a1a00, emissiveIntensity: 0.25 });
    this.mesh = new THREE.InstancedMesh(g, mat, n);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
  }

  spawn(x: number, z: number, y: number, count = CONFIG.feed.pelletsPerClick) {
    let spawned = 0;
    for (let i = 0; i < this.max && spawned < count; i++) {
      if (this.state[i] !== FoodState.Dead) continue;
      this.pos[i * 3] = x + rand(-0.25, 0.25);
      this.pos[i * 3 + 1] = y + rand(0, 0.35);
      this.pos[i * 3 + 2] = zClamp(z + rand(-0.6, 0.6), 0.6);
      this.vel[i * 3] = rand(-0.3, 0.3);
      this.vel[i * 3 + 1] = rand(-0.2, 0.4);
      this.vel[i * 3 + 2] = rand(-0.2, 0.2);
      this.state[i] = FoodState.Air;
      this.timer[i] = 0;
      this.spin[i] = rand(0, 6);
      spawned++;
    }
    return spawned;
  }

  /** Consumes pellet i (eaten by a creature). */
  consume(i: number) {
    this.state[i] = FoodState.Dead;
  }

  clear() {
    this.state.fill(FoodState.Dead);
  }

  activeCount() {
    let c = 0;
    for (let i = 0; i < this.max; i++) if (this.state[i] !== FoodState.Dead) c++;
    return c;
  }

  update(dt: number, time: number) {
    const cfg = CONFIG.feed;
    for (let i = 0; i < this.max; i++) {
      const st = this.state[i];
      if (st === FoodState.Dead) continue;
      const k = i * 3;
      let x = this.pos[k],
        y = this.pos[k + 1],
        z = this.pos[k + 2];
      const surface = this.water.heightAt(x, z);
      this.timer[i] += dt;
      if (st === FoodState.Air) {
        this.vel[k + 1] -= 6.5 * dt;
        x += this.vel[k] * dt;
        y += this.vel[k + 1] * dt;
        z += this.vel[k + 2] * dt;
        if (y <= surface) {
          y = surface;
          this.state[i] = FoodState.Floating;
          this.timer[i] = rand(cfg.floatTime[0], cfg.floatTime[1]);
          this.water.disturb(x, z, -0.35, 0.22);
          this.water.addRipple(x, z, 0.035);
          this.onSplash?.(x, z);
        }
      } else if (st === FoodState.Floating) {
        // bob on the surface, drift slightly with the wind
        this.timer[i] -= dt * 2;
        y = surface - 0.02;
        x += Math.sin(time * 0.7 + i) * 0.04 * dt;
        if (this.timer[i] <= 0) {
          this.state[i] = FoodState.Sinking;
          this.vel[k] = this.vel[k + 2] = 0;
          this.vel[k + 1] = -0.05;
          this.timer[i] = 0;
        }
      } else if (st === FoodState.Sinking) {
        const t = time * 0.8 + i * 1.7;
        let vx = Math.sin(t) * 0.12 + Math.sin(t * 2.3) * 0.05;
        let vz = Math.cos(t * 0.9) * 0.06;
        let vy = -cfg.sinkSpeed;
        if (this.flow?.active) {
          const f = this.flow.velocityAt(x, y, z, this.fv);
          vx += f.x;
          vz += f.z;
          vy += f.y * 0.6;
        }
        this.vel[k] += (vx - this.vel[k]) * Math.min(1, dt * 1.5);
        this.vel[k + 2] += (vz - this.vel[k + 2]) * Math.min(1, dt * 1.5);
        this.vel[k + 1] += (vy - this.vel[k + 1]) * Math.min(1, dt * 1.2);
        x += this.vel[k] * dt;
        y += this.vel[k + 1] * dt;
        z = zClamp(z + this.vel[k + 2] * dt, 0.6);
        const ground = this.terrain.heightAt(x, z);
        if (y <= ground + 0.03) {
          y = ground + 0.03;
          this.state[i] = FoodState.Settled;
          this.timer[i] = cfg.bottomLife;
        }
      } else if (st === FoodState.Settled) {
        this.timer[i] -= dt;
        y = this.terrain.heightAt(x, z) + 0.03;
        if (this.timer[i] <= 0) this.state[i] = FoodState.Dead;
      }
      this.pos[k] = x;
      this.pos[k + 1] = y;
      this.pos[k + 2] = z;
    }
    // write instances (compact)
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      const st = this.state[i];
      if (st === FoodState.Dead) continue;
      const k = i * 3;
      let sc = 1;
      if (st === FoodState.Settled) sc = Math.min(1, this.timer[i] / 3);
      this.spin[i] += dt * (st === FoodState.Sinking ? 1.5 : 0.3);
      this.q.setFromAxisAngle(this.v.set(0.3, 1, 0.2).normalize(), this.spin[i]);
      this.m4.compose(this.v.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]), this.q, this.s.set(sc, sc * 0.8, sc));
      this.mesh.setMatrixAt(n++, this.m4);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Finds the nearest edible pellet within radius; filters by vertical zone. */
  nearest(x: number, y: number, z: number, radius: number, includeSettled: boolean, onlySettled = false): number {
    let best = -1,
      bd = radius * radius;
    for (let i = 0; i < this.max; i++) {
      const st = this.state[i];
      if (st === FoodState.Dead || st === FoodState.Air) continue;
      if (onlySettled && st !== FoodState.Settled) continue;
      if (!includeSettled && st === FoodState.Settled) continue;
      const k = i * 3;
      const dx = this.pos[k] - x,
        dy = this.pos[k + 1] - y,
        dz = this.pos[k + 2] - z;
      const d = dx * dx + dy * dy * 1.3 + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
}
