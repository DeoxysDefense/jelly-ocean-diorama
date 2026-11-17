import * as THREE from 'three';
import { CONFIG } from '../config';
import { shared } from '../util/shaders';
import type { Reef, Selectable } from '../world/Reef';
import type { TerrainSystem } from '../world/TerrainSystem';
import { GroundMarker } from './GroundMarker';

/**
 * Select tool: hover highlight (outline + ground footprint), pick, lift-and-drag with
 * ground snapping, placement validation and animated revert on invalid drops.
 */
export class SelectionManager {
  hovered: Selectable | null = null;
  dragging: Selectable | null = null;
  readonly marker: GroundMarker;
  private from = new THREE.Vector3();
  private fromRot = 0;
  private lift = 0;
  valid = true;
  private reverting: { sel: Selectable; to: THREE.Vector3; t: number }[] = [];
  private meshes: THREE.Object3D[] = [];
  private tmpN = new THREE.Vector3();

  constructor(private reef: Reef, private terrain: TerrainSystem) {
    this.marker = new GroundMarker(terrain);
    this.refresh();
  }

  /** Rebuild the pickable mesh list (objects were placed / removed). */
  refresh() {
    this.meshes.length = 0;
    for (const s of this.reef.selectables) s.object.traverse((o) => (o as THREE.Mesh).isMesh && !o.userData.isOutline && this.meshes.push(o));
    if (this.hovered && !this.reef.selectables.includes(this.hovered)) this.hovered = null;
  }

  /** Placement check for a new object of footprint radius r at (x, z). */
  canPlace(x: number, z: number, r: number, visible: { min: number; max: number }) {
    const probe = { radius: r, kind: 'rock' } as Selectable;
    return this.validate(probe, x, z, visible);
  }

  pick(raycaster: THREE.Raycaster): Selectable | null {
    const hits = raycaster.intersectObjects(this.meshes, false);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.selectableId === undefined) o = o.parent;
      if (o) {
        const sel = this.reef.selectables.find((s) => s.object === o);
        if (sel) return sel;
      }
    }
    return null;
  }

  setHover(sel: Selectable | null) {
    if (this.hovered === sel) return;
    if (this.hovered && this.hovered !== this.dragging) this.reef.setHighlight(this.hovered, false);
    this.hovered = sel;
    if (sel) this.reef.setHighlight(sel, true);
  }

  begin(sel: Selectable) {
    // finish any snap-back animation first so "from" is the true resting spot
    const i = this.reverting.findIndex((r) => r.sel === sel);
    if (i >= 0) {
      sel.object.position.copy(this.reverting[i].to);
      this.reverting.splice(i, 1);
    }
    this.dragging = sel;
    this.from.copy(sel.object.position);
    this.fromRot = sel.object.rotation.y;
    this.reef.setHighlight(sel, true);
    this.lift = 0;
  }

  /**
   * Moves the dragged object toward (x, z) — Top View supplies both, Front View keeps the
   * current depth (or the wheel changes it) — then snaps Y to the seabed with a small lift.
   */
  dragTo(x: number, z: number, visible: { min: number; max: number }, dt: number) {
    const sel = this.dragging;
    if (!sel) return;
    const o = sel.object;
    const nx = THREE.MathUtils.clamp(x, visible.min - 1, visible.max + 1);
    const nz = THREE.MathUtils.clamp(z, CONFIG.world.zBack + 0.4, CONFIG.world.zFront - 0.4);
    o.position.x += (nx - o.position.x) * Math.min(1, dt * 14);
    o.position.z += (nz - o.position.z) * Math.min(1, dt * 14);
    this.lift += (0.35 - this.lift) * Math.min(1, dt * 8);
    const gy = this.reef.groundY(o.position.x, o.position.z, sel.radius);
    o.position.y = gy + this.lift + Math.sin(performance.now() * 0.006) * 0.02;
    o.rotation.z = Math.sin(performance.now() * 0.004) * 0.04;
    this.valid = this.validate(sel, o.position.x, o.position.z, visible);
    this.marker.setColor(this.valid ? 0xc8ffe8 : 0xff8a8a);
    this.marker.show(o.position.x, o.position.z, sel.radius * 1.15, sel.radius * 0.9);
  }

  validate(sel: Selectable, x: number, z: number, visible: { min: number; max: number }) {
    if (x < visible.min + 0.5 || x > visible.max - 0.5) return false;
    if (z < CONFIG.world.zBack + 0.5 || z > CONFIG.world.zFront - 0.5) return false;
    // must be underwater (not on the island or a sand bar), on reasonably flat ground
    if (this.terrain.heightAt(x, z) > shared.uWaterLevel.value - 1.1) return false;
    if (this.terrain.normalAt(x, z, this.tmpN).y < 0.74) return false;
    for (const s of this.reef.selectables) {
      if (s === sel) continue;
      const d = Math.hypot(s.object.position.x - x, s.object.position.z - z);
      const k = s.kind === 'seagrass' || sel.kind === 'seagrass' ? 0.45 : 0.62;
      if (d < (s.radius + sel.radius) * k) return false;
    }
    for (const o of this.reef.fixedObstacles) {
      const d = Math.hypot(o.center.x - x, o.center.z - z);
      if (d < (o.radius + sel.radius) * 0.7) return false;
    }
    return true;
  }

  /** Finishes the drag. Returns the move record if it was placed, null if reverted. */
  end(visible: { min: number; max: number }) {
    const sel = this.dragging;
    if (!sel) return null;
    this.dragging = null;
    const o = sel.object;
    o.rotation.z = 0;
    this.marker.setColor(0xd8fdff);
    const ok = this.validate(sel, o.position.x, o.position.z, visible) && Math.hypot(o.position.x - this.from.x, o.position.z - this.from.z) > 0.02;
    if (ok) {
      o.position.y = this.reef.groundY(o.position.x, o.position.z, sel.radius) - (sel.kind === 'rock' ? -sel.radius * 0.05 : 0.05);
      if (sel !== this.hovered) this.reef.setHighlight(sel, false);
      this.marker.hide();
      return { sel, from: this.from.clone(), to: o.position.clone(), rotFrom: this.fromRot, rotTo: o.rotation.y };
    }
    this.reverting.push({ sel, to: this.from.clone(), t: 0 });
    if (sel !== this.hovered) this.reef.setHighlight(sel, false);
    this.marker.hide();
    return null;
  }

  isReverting() {
    return this.reverting.length > 0;
  }

  update(dt: number, time: number) {
    for (let i = this.reverting.length - 1; i >= 0; i--) {
      const r = this.reverting[i];
      r.t += dt * 3;
      const o = r.sel.object;
      o.position.lerp(r.to, Math.min(1, dt * 9));
      if (r.t >= 1 || o.position.distanceTo(r.to) < 0.01) {
        o.position.copy(r.to);
        this.reverting.splice(i, 1);
      }
    }
    if (!this.dragging && this.hovered) {
      const s = this.hovered;
      this.marker.show(s.object.position.x, s.object.position.z, s.radius * 1.15, s.radius * 0.9);
    } else if (!this.dragging) this.marker.hide();
    this.marker.update(dt, time);
  }

  clear() {
    if (this.hovered) this.reef.setHighlight(this.hovered, false);
    if (this.dragging) this.reef.setHighlight(this.dragging, false);
    this.hovered = null;
    this.dragging = null;
    this.reverting.length = 0;
    this.marker.hide();
  }
}
