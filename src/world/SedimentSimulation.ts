import * as THREE from 'three';
import { CONFIG } from '../config';
import { rand } from '../util/math';
import { patchMaterial } from '../util/shaders';
import type { TerrainSystem } from './TerrainSystem';
import type { WaterSurfaceSimulation } from '../water/WaterSurfaceSimulation';
import type { Obstacle } from './Reef';

/**
 * Hybrid granular sand:
 *  - active grains are pooled particles (gravity, water drag, turbulence, dispersion,
 *    collisions with rocks/corals),
 *  - on touching the seabed a grain is converted into sediment height in the terrain grid
 *    (TerrainSystem handles angle-of-repose sliding),
 *  - "dust" grains are short-lived visual particles for removal / dragging feedback.
 * Hard-capped pool, so nothing grows unbounded.
 */
export class SedimentSimulation {
  readonly max = CONFIG.sand.maxParticles;
  readonly mesh: THREE.InstancedMesh;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array; // >0 alive; dust uses it as fade timer
  private kind: Uint8Array; // 1 sand, 2 dust
  private inWater: Uint8Array;
  private scale: Float32Array;
  /** Seconds a grain has been resting on an obstacle (prevents grains perching forever). */
  private contact: Float32Array;
  private cursor = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  /** Called when a grain settles (x, z) — used by creatures that react to falling sand. */
  onSettle?: (x: number, z: number) => void;
  private settleThrottle = 0;
  flow: import('./FlowField').FlowField | null = null;
  private fv = new THREE.Vector3();

  constructor(private terrain: TerrainSystem, private water: WaterSurfaceSimulation, private obstacles: () => Obstacle[]) {
    const n = this.max;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.kind = new Uint8Array(n);
    this.inWater = new Uint8Array(n);
    this.scale = new Float32Array(n);
    this.contact = new Float32Array(n);
    const geo = new THREE.IcosahedronGeometry(0.03, 0);
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ roughness: 0.9, color: 0xffffff }), { caustics: true, key: 'sand-grain' });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      c.setHSL(0.11 + rand(-0.015, 0.02), rand(0.35, 0.55), rand(0.62, 0.84));
      this.mesh.setColorAt(i, c);
    }
    this.mesh.count = 0;
  }

  private alloc(): number {
    for (let t = 0; t < this.max; t++) {
      const i = (this.cursor + t) % this.max;
      if (this.life[i] <= 0) {
        this.cursor = (i + 1) % this.max;
        return i;
      }
    }
    return -1;
  }

  /** Emits sand grains at a point (hourglass stream when called every frame). */
  emitSand(x: number, y: number, z: number, count: number) {
    for (let k = 0; k < count; k++) {
      const i = this.alloc();
      if (i < 0) return;
      this.pos[i * 3] = x + rand(-0.05, 0.05);
      this.pos[i * 3 + 1] = y + rand(-0.04, 0.04);
      this.pos[i * 3 + 2] = z + rand(-0.12, 0.12);
      this.vel[i * 3] = rand(-0.12, 0.12);
      this.vel[i * 3 + 1] = rand(-0.3, 0.0);
      this.vel[i * 3 + 2] = rand(-0.1, 0.1);
      this.life[i] = 30;
      this.kind[i] = 1;
      this.inWater[i] = y < this.water.heightAt(x, z) ? 1 : 0;
      this.scale[i] = rand(0.6, 1.3);
      this.contact[i] = 0;
    }
  }

  /** Visual-only dust puffs (sand being sucked up, objects dragged). */
  emitDust(x: number, y: number, z: number, count: number, up = 0.6) {
    for (let k = 0; k < count; k++) {
      const i = this.alloc();
      if (i < 0) return;
      this.pos[i * 3] = x + rand(-0.25, 0.25);
      this.pos[i * 3 + 1] = y + rand(0, 0.1);
      this.pos[i * 3 + 2] = z + rand(-0.25, 0.25);
      this.vel[i * 3] = rand(-0.3, 0.3);
      this.vel[i * 3 + 1] = rand(0.2, 1) * up;
      this.vel[i * 3 + 2] = rand(-0.2, 0.2);
      this.life[i] = rand(0.6, 1.4);
      this.kind[i] = 2;
      this.inWater[i] = 1;
      this.scale[i] = rand(0.5, 1.0);
    }
  }

  clear() {
    this.life.fill(0);
  }

  activeCount() {
    let c = 0;
    for (let i = 0; i < this.max; i++) if (this.life[i] > 0) c++;
    return c;
  }

  update(dt: number, time: number) {
    const obs = this.obstacles();
    this.settleThrottle -= dt;
    let n = 0;
    const cfg = CONFIG.sand;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3;
      let x = this.pos[k],
        y = this.pos[k + 1],
        z = this.pos[k + 2];
      let vx = this.vel[k],
        vy = this.vel[k + 1],
        vz = this.vel[k + 2];
      this.life[i] -= dt;
      if (this.kind[i] === 2) {
        // dust: buoyant puff that slows and fades
        vx *= Math.exp(-2 * dt);
        vy *= Math.exp(-2.5 * dt);
        vz *= Math.exp(-2 * dt);
      } else {
        const surf = this.water.heightAt(x, z);
        if (y > surf) {
          vy -= 9.0 * dt; // air
        } else {
          if (!this.inWater[i]) {
            this.inWater[i] = 1;
            this.water.disturb(x, z, -0.08, 0.18);
            vy *= 0.35;
          }
          // water: drag toward a terminal velocity + turbulent dispersion
          const term = -1.25 * this.scale[i];
          let turbX = Math.sin(time * 2.1 + i * 0.37 + y * 2) * 0.22;
          let turbZ = Math.cos(time * 1.7 + i * 0.53) * 0.1;
          if (this.flow?.active) {
            const f = this.flow.velocityAt(x, y, z, this.fv);
            turbX += f.x;
            turbZ += f.z;
            vy += f.y * dt * 2;
          }
          vx += (turbX - vx) * Math.min(1, 2.2 * dt);
          vz += (turbZ - vz) * Math.min(1, 2.2 * dt);
          vy += (term - vy) * Math.min(1, 3 * dt);
        }
      }
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      if (z > CONFIG.world.zFront - 0.15) {
        z = CONFIG.world.zFront - 0.15;
        vz = -Math.abs(vz) * 0.3;
      } else if (z < CONFIG.world.zBack + 0.15) {
        z = CONFIG.world.zBack + 0.15;
        vz = Math.abs(vz) * 0.3;
      }
      if (this.kind[i] === 1) {
        // collide with rocks/corals: push to sphere surface and slide
        let touching = false;
        for (const o of obs) {
          const dx = x - o.center.x,
            dy = y - o.center.y,
            dz = z - o.center.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          const r = o.radius * 0.85;
          if (d2 < r * r && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const nx = dx / d,
              ny = dy / d,
              nz = dz / d;
            x = o.center.x + nx * r;
            y = o.center.y + ny * r;
            z = o.center.z + nz * r;
            const vn = vx * nx + vy * ny + vz * nz;
            if (vn < 0) {
              vx -= vn * nx * 1.1;
              vy -= vn * ny * 1.1;
              vz -= vn * nz * 1.1;
            }
            // slide off sideways (random nudge so grains don't perch on the apex)
            vx += (nx + rand(-0.6, 0.6)) * 4 * dt;
            vz += (nz + rand(-0.6, 0.6)) * 4 * dt;
            touching = true;
          }
        }
        this.contact[i] = touching ? this.contact[i] + dt : 0;
        if (this.contact[i] > 1.2) {
          // grains that cannot slide off settle into the sand around the object's foot
          const a = Math.random() * Math.PI * 2;
          this.terrain.addSediment(x + Math.cos(a) * 0.25, z + Math.sin(a) * 0.25, cfg.grainVolume * this.scale[i]);
          this.life[i] = 0;
          continue;
        }
        const ground = this.terrain.heightAt(x, z);
        if (y <= ground) {
          this.terrain.addSediment(x, z, cfg.grainVolume * this.scale[i]);
          this.life[i] = 0;
          if (this.settleThrottle <= 0 && this.onSettle) {
            this.settleThrottle = 0.25;
            this.onSettle(x, z);
          }
          continue;
        }
      }
      this.pos[k] = x;
      this.pos[k + 1] = y;
      this.pos[k + 2] = z;
      this.vel[k] = vx;
      this.vel[k + 1] = vy;
      this.vel[k + 2] = vz;
      const sc = this.kind[i] === 2 ? this.scale[i] * Math.min(1, this.life[i] * 1.5) : this.scale[i];
      this.q.setFromAxisAngle(this.v.set(0.4, 1, 0.2).normalize(), i + time * (this.kind[i] === 2 ? 1 : 3));
      this.m4.compose(this.v.set(x, y, z), this.q, this.s.set(sc, sc, sc));
      this.mesh.setMatrixAt(n, this.m4);
      // instance colour index stays tied to slot n (cheap visual variety)
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
