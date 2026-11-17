import * as THREE from 'three';
import type { WaterPresetId } from '../config';
import { damp } from '../util/math';

/**
 * A water "look" is more than a colour: it defines in-scatter colours for shallow and deep
 * water, per-channel Beer–Lambert absorption, and how much light reaches deep objects.
 * Creature and coral materials are never recoloured — only the medium between them and the
 * viewer changes, which keeps their own colours readable.
 */
export interface WaterLook {
  shallow: THREE.Color;
  deep: THREE.Color;
  absorb: THREE.Vector3;
  depthTint: THREE.Color;
  density: number;
}

export interface PresetInfo {
  id: WaterPresetId;
  label: string;
  swatch: string;
}

function look(shallow: string, deep: string, absorb: [number, number, number], depthTint: string, density = 1): WaterLook {
  return {
    shallow: new THREE.Color(shallow),
    deep: new THREE.Color(deep),
    absorb: new THREE.Vector3(...absorb),
    depthTint: new THREE.Color(depthTint),
    density,
  };
}

export const PRESETS: Record<Exclude<WaterPresetId, 'custom'>, WaterLook> = {
  tropical: look('#3fd9d2', '#0b6d93', [0.2, 0.04, 0.035], '#8ccbd6', 1.0),
  lagoon: look('#5cc9f2', '#0f5aa3', [0.25, 0.065, 0.025], '#8fb4dc', 1.0),
  deep: look('#2c86cf', '#05275f', [0.32, 0.13, 0.055], '#5f7fb4', 1.1),
  seaglass: look('#8fe3be', '#1e7466', [0.17, 0.03, 0.08], '#a2cbb6', 0.95),
  sunset: look('#f4ad86', '#4d3f86', [0.04, 0.1, 0.085], '#caa2aa', 0.9),
};

export const PRESET_LIST: PresetInfo[] = [
  { id: 'tropical', label: 'Tropical Turquoise', swatch: '#2fd0cc' },
  { id: 'lagoon', label: 'Lagoon Blue', swatch: '#46b8ec' },
  { id: 'deep', label: 'Deep Ocean Blue', swatch: '#1b5fae' },
  { id: 'seaglass', label: 'Sea Glass Green', swatch: '#7fd8b2' },
  { id: 'sunset', label: 'Warm Sunset', swatch: '#f0a07e' },
  { id: 'custom', label: 'Custom Color', swatch: 'conic-gradient(#f66,#fd6,#6f9,#6df,#a7f,#f66)' },
];

/** Derives a natural-looking water look from a single user colour. */
export function lookFromColor(hex: string): WaterLook {
  const c = new THREE.Color(hex); // linear
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const shallow = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.95), Math.min(0.82, Math.max(0.42, hsl.l + 0.12)));
  const deep = new THREE.Color().setHSL((hsl.h + 0.02) % 1, Math.min(1, hsl.s * 1.05 + 0.1), Math.max(0.08, hsl.l * 0.38));
  // Absorb the complementary channels so the medium tints toward the chosen colour.
  const lin = shallow.clone();
  const absorb = new THREE.Vector3(1 - lin.r, 1 - lin.g, 1 - lin.b).multiplyScalar(0.26).addScalar(0.02);
  const depthTint = shallow.clone().lerp(new THREE.Color(0.6, 0.6, 0.6), 0.45);
  return { shallow, deep, absorb, depthTint, density: 1 };
}

export class WaterColorController {
  readonly current: WaterLook;
  private target: WaterLook;

  constructor(initial: WaterLook) {
    this.current = {
      shallow: initial.shallow.clone(),
      deep: initial.deep.clone(),
      absorb: initial.absorb.clone(),
      depthTint: initial.depthTint.clone(),
      density: initial.density,
    };
    this.target = initial;
  }

  setTarget(l: WaterLook) {
    this.target = l;
  }

  /** Smooth (~1 s) transition between looks. */
  update(dt: number) {
    const k = 1 - Math.exp(-3.2 * dt);
    const c = this.current,
      t = this.target;
    c.shallow.lerp(t.shallow, k);
    c.deep.lerp(t.deep, k);
    c.absorb.lerp(t.absorb, k);
    c.depthTint.lerp(t.depthTint, k);
    c.density = damp(c.density, t.density, 3.2, dt);
  }
}
