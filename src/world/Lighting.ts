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
