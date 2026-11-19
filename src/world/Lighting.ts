import * as THREE from 'three';
import type { AtmosphereState } from './Atmosphere';

/** Natural daylight: warm key sun with soft shadows + sky/ground hemisphere fill. */
export class Lighting {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;

  constructor() {
    this.hemi = new THREE.HemisphereLight(0xcfe9ff, 0xd8c39a, 1.15);
    this.group.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.7);
    this.sun.position.set(-9, 16, 11);
    this.sun.target.position.set(-1, -3, 0);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(2048, 2048);
    s.camera.left = -26;
    s.camera.right = 26;
    s.camera.top = 19;
    s.camera.bottom = -19;
    s.camera.near = 1;
    s.camera.far = 70;
    s.bias = -0.0004;
    s.normalBias = 0.025;
    s.radius = 3;
    this.group.add(this.sun, this.sun.target);

    this.fill = new THREE.DirectionalLight(0xbfe6ff, 0.35);
    this.fill.position.set(10, 4, 12);
    this.group.add(this.fill);
  }

  private fill: THREE.DirectionalLight;
  private frameKey = '';
  /** Changes whenever the shadow camera moved (the shadow map must be re-rendered). */
  shadowStamp = 0;
  private lastX = NaN;

  /**
   * V2: the tray is wider than one shadow map can cover sharply, so the sun's shadow frustum
   * follows the part of the world in view (v1 size in Focus View, the whole tray in Full View).
   */
  frame(cx: number, halfW: number, cz: number) {
    const ext = Math.max(26, halfW + 8);
    const texel = (2 * ext) / this.sun.shadow.mapSize.x;
    const x = Math.round((cx - 1) / (texel * 8)) * texel * 8;
    this.sun.target.position.set(x, -3, cz);
    if (x !== this.lastX) {
      this.lastX = x;
      this.shadowStamp++;
    }
    const key = ext.toFixed(1);
    if (key !== this.frameKey) {
      this.frameKey = key;
      const c = this.sun.shadow.camera;
      c.left = -ext;
      c.right = ext;
      const v = 19 + Math.max(0, ext - 26) * 0.15;
      c.top = v;
      c.bottom = -v;
      c.far = 70 + Math.max(0, ext - 26);
      c.updateProjectionMatrix();
      this.shadowStamp++;
    }
  }

  /** Follows the day / night state: sun or moon key light, ambient sky / ground colours. */
  apply(atm: AtmosphereState) {
    this.sun.position.copy(this.sun.target.position).addScaledVector(atm.lightDir, 22);
    this.sun.color.copy(atm.lightColor);
    this.sun.intensity = atm.lightIntensity;
    this.hemi.color.copy(atm.hemiSky);
    this.hemi.groundColor.copy(atm.hemiGround);
    this.hemi.intensity = atm.hemiIntensity;
    this.fill.intensity = 0.35 * (0.3 + 0.7 * atm.day);
  }
}
