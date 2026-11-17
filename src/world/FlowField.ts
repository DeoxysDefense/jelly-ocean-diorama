import * as THREE from 'three';
import { CONFIG } from '../config';
import { shared } from '../util/shaders';

interface Emitter {
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: number;
  /** Vertical radius multiplier (Top View strokes reach through the water column). */
  ry: number;
  life: number;
  max: number;
}

/**
 * Local water currents painted with the Current Brush. A stroke leaves a trail of short-lived
 * gaussian "jets"; drawing a loop therefore produces a swirl. Every moving system samples
 * velocityAt(), which is what links the brush to fish, jellyfish, sand, food, bubbles,
 * suspended particles and (via shader uniforms) the swaying plants.
 */
export class FlowField {
  private emitters: Emitter[] = [];
  /** Up to 4 strongest emitters as shader uniforms: xyz + radius, and velocity. */
  readonly uniforms = { uFlowP: shared.uFlowP, uFlowV: shared.uFlowV };

  get active() {
    return this.emitters.length > 0;
  }

  add(p: THREE.Vector3, v: THREE.Vector3, radius: number, verticalScale = 1) {
    const max = CONFIG.current.maxSpeed;
    const vv = v.clone();
    if (vv.length() > max) vv.setLength(max);
    if (this.emitters.length >= CONFIG.current.maxEmitters) this.emitters.shift();
    const life = CONFIG.current.life;
    this.emitters.push({ p: p.clone(), v: vv, r: radius, ry: verticalScale, life, max: life });
  }

  clear() {
    this.emitters.length = 0;
  }

  /** Flow velocity at a point (units/s). */
  velocityAt(x: number, y: number, z: number, out: THREE.Vector3) {
    out.set(0, 0, 0);
    for (const e of this.emitters) {
      const dx = (x - e.p.x) / e.r,
        dy = (y - e.p.y) / (e.r * e.ry),
        dz = (z - e.p.z) / e.r;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 4) continue;
      const k = Math.exp(-d2 * 1.4) * fade(e.life / e.max);
      out.x += e.v.x * k;
      out.y += e.v.y * k;
      out.z += e.v.z * k;
    }
    const l = out.length();
    const max = CONFIG.current.maxSpeed;
    if (l > max) out.multiplyScalar(max / l);
    return out;
  }

  update(dt: number) {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      this.emitters[i].life -= dt;
      if (this.emitters[i].life <= 0) this.emitters.splice(i, 1);
    }
    // pick the 4 strongest for the plant shaders
    const sorted = [...this.emitters].sort((a, b) => b.v.length() * fade(b.life / b.max) - a.v.length() * fade(a.life / a.max));
    for (let i = 0; i < 4; i++) {
      const e = sorted[i];
      const P = this.uniforms.uFlowP.value[i],
        V = this.uniforms.uFlowV.value[i];
      if (e) {
        P.set(e.p.x, e.p.y, e.p.z, e.r * 1.4);
        V.copy(e.v).multiplyScalar(fade(e.life / e.max));
      } else {
        P.set(0, -999, 0, 0.001);
        V.set(0, 0, 0);
      }
    }
  }
}

/** Ramp in fast, fade out smoothly. */
function fade(t: number) {
  const inT = Math.min(1, (1 - t) * 8);
  return inT * Math.min(1, t * 1.6);
}
