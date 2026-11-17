import * as THREE from 'three';
import { zClamp } from '../config';
import { clamp, rand } from '../util/math';
import { leafGeometry, paint } from '../util/geometry';
import type { WaterSurfaceSimulation } from '../water/WaterSurfaceSimulation';
import type { TerrainSystem } from './TerrainSystem';
import type { FlowField } from './FlowField';

interface Floater {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  draft: number;
  size: number;
  spin: number;
}

/**
 * Floating objects (coconuts, a palm leaflet, a frangipani flower, driftwood) that ride the
 * real water surface W(x, z, t): they bob with the swell, tilt with the local slope, slide
 * down wave faces, drift with wind and painted currents and get pushed by drag / ripples.
 * They are the visible proof that Front and Top View share one 3D surface.
 */
export class Floaters {
  readonly group = new THREE.Group();
  private items: Floater[] = [];
  private n = new THREE.Vector3();
  private fv = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private water: WaterSurfaceSimulation, private terrain: TerrainSystem, private flow: FlowField) {
    const nut = new THREE.MeshStandardMaterial({ color: 0x6a5a2c, roughness: 0.6 });
    const nutG = new THREE.MeshStandardMaterial({ color: 0x5c7530, roughness: 0.45 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a8268, roughness: 0.95 });
    const add = (obj: THREE.Object3D, x: number, z: number, draft: number, size: number) => {
      obj.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));
      obj.position.set(x, 0, z);
      this.group.add(obj);
      this.items.push({ obj, vel: new THREE.Vector3(rand(-0.1, 0.1), 0, rand(-0.05, 0.05)), draft, size, spin: rand(-0.3, 0.3) });
    };
    add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10).scale(1, 1.1, 1), nut), 2.5, 3.6, 0.03, 0.09);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10).scale(1, 1.1, 1), nutG), 11.5, -2.5, 0.03, 0.09);
    // driftwood
    const drift = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.8, 8).rotateZ(Math.PI / 2), wood);
    add(drift, -2.5, 1.0, 0.01, 0.4);
    // palm leaflet
    const leafG = leafGeometry({ length: 0.5, width: 0.09, segs: 6, fold: 0.25, curl: 0.05 });
    paint(leafG, (p, _n, c) => c.set(0x6a8a2c).lerp(new THREE.Color(0xb0b050), p.x / 0.5));
    const leaf = new THREE.Mesh(leafG, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 }));
    add(leaf, 7.5, 1.5, -0.005, 0.25);
    // frangipani flower
    const flower = new THREE.Group();
    const petalMat = new THREE.MeshStandardMaterial({ color: 0xfff6ea, roughness: 0.45, emissive: 0x302820, emissiveIntensity: 0.3 });
    for (let i = 0; i < 5; i++) {
      const pg = leafGeometry({ length: 0.08, width: 0.05, segs: 4, fold: -0.15, curl: -0.2 });
      paint(pg, (p, _n, c) => c.set(0xffffff).lerp(new THREE.Color(0xffd34a), Math.max(0, 1 - p.x / 0.035)));
      const m = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide }));
      m.rotation.y = (i / 5) * Math.PI * 2;
      m.rotation.z = 0.25;
      flower.add(m);
    }
    void petalMat;
    add(flower, 4.5, -1.0, -0.01, 0.1);
  }

  update(dt: number, wind: number) {
    const W = this.water;
    for (const f of this.items) {
      const p = f.obj.position;
      const e = 0.18;
      const hx = (W.heightAt(p.x + e, p.z) - W.heightAt(p.x - e, p.z)) / (2 * e);
      const hz = (W.heightAt(p.x, p.z + e) - W.heightAt(p.x, p.z - e)) / (2 * e);
      // slide down wave faces, drift with wind and currents, damp
      f.vel.x += (-hx * 1.6 + wind * 0.22) * dt;
      f.vel.z += -hz * 1.6 * dt;
      if (this.flow.active) {
        const fl = this.flow.velocityAt(p.x, W.level - 0.2, p.z, this.fv);
        f.vel.x += (fl.x - f.vel.x) * Math.min(1, dt * 1.5);
        f.vel.z += (fl.z - f.vel.z) * Math.min(1, dt * 1.5);
      }
      f.vel.multiplyScalar(Math.exp(-dt * 0.7));
      // beach / land: push back toward deeper water
      const ground = this.terrain.heightAt(p.x + f.vel.x * 0.3, p.z + f.vel.z * 0.3);
      if (ground > W.heightAt(p.x, p.z) - 0.15) {
        const gx = this.terrain.heightAt(p.x + 0.3, p.z) - this.terrain.heightAt(p.x - 0.3, p.z);
        const gz = this.terrain.heightAt(p.x, p.z + 0.3) - this.terrain.heightAt(p.x, p.z - 0.3);
        f.vel.x -= gx * 3 * dt + f.vel.x * 0.5;
        f.vel.z -= gz * 3 * dt + f.vel.z * 0.5;
      }
      p.x += f.vel.x * dt;
      p.z = zClamp(p.z + f.vel.z * dt, 0.5);
      if (p.x > 22) p.x = -22;
      if (p.x < -22) p.x = 22;
      const h = W.heightAt(p.x, p.z);
      p.y += (h - f.draft - p.y) * Math.min(1, dt * 12);
      // tilt to the surface normal, slow spin
      this.n.set(-hx, 1, -hz).normalize();
      this.q.setFromUnitVectors(this.up, this.n);
      const yaw = (f.obj.userData.yaw = (f.obj.userData.yaw ?? rand(0, 6)) + f.spin * dt);
      f.obj.quaternion.copy(this.q).multiply(new THREE.Quaternion().setFromAxisAngle(this.up, yaw));
    }
  }
}
