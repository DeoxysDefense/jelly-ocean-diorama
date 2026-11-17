import * as THREE from 'three';
import { smoothstep, lerp } from '../util/math';

/**
 * Day / night model. Hours 0..24 → sun elevation (sunrise 6:00, sunset 18:00); everything
 * else (sky gradient, light colour and direction, ambient level, stars) derives from it.
 * The moon takes over the key light at night (soft, bluish), so shadows stay coherent.
 */
export interface AtmosphereState {
  hours: number;
  /** Sun elevation as sin(angle): 1 = zenith, <0 = below horizon. */
  elev: number;
  day: number;
  night: number;
  /** Peaks around sunrise / sunset. */
  dusk: number;
  /** Overall light level 0..1 used to dim self-lit things (water scatter, back wall). */
  light: number;
  lightDir: THREE.Vector3;
  lightColor: THREE.Color;
  lightIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  skyTop: THREE.Color;
  skyMid: THREE.Color;
  skyHorizon: THREE.Color;
  /** Screen-space x (0..1) of the sun / moon glow. */
  glowX: number;
  glowColor: THREE.Color;
  rain: number;
}

const C = (hex: number) => new THREE.Color(hex);
// sky keyframes by elevation: [elev, top, mid, horizon]
const SKY: [number, THREE.Color, THREE.Color, THREE.Color][] = [
  [-0.35, C(0x070d22), C(0x0e1a3c), C(0x1c2a52)],
  [-0.1, C(0x16234d), C(0x2c3d73), C(0x6a5a86)],
  [0.03, C(0x34518f), C(0xb7808a), C(0xffa766)],
  [0.14, C(0x4a79c0), C(0x9cbde0), C(0xf6cf9a)],
  [0.35, C(0x578fd6), C(0x94cdf2), C(0xd6edf7)],
];

function skyAt(e: number, top: THREE.Color, mid: THREE.Color, hor: THREE.Color) {
  if (e <= SKY[0][0]) {
    top.copy(SKY[0][1]);
    mid.copy(SKY[0][2]);
    hor.copy(SKY[0][3]);
    return;
  }
  for (let i = 0; i < SKY.length - 1; i++) {
    const a = SKY[i],
      b = SKY[i + 1];
    if (e <= b[0]) {
      const t = smoothstep(a[0], b[0], e);
      top.copy(a[1]).lerp(b[1], t);
      mid.copy(a[2]).lerp(b[2], t);
      hor.copy(a[3]).lerp(b[3], t);
      return;
    }
  }
  const l = SKY[SKY.length - 1];
  top.copy(l[1]);
  mid.copy(l[2]);
  hor.copy(l[3]);
}

export function createAtmosphere(): AtmosphereState {
  return {
    hours: 14.5,
    elev: 1,
    day: 1,
    night: 0,
    dusk: 0,
    light: 1,
    lightDir: new THREE.Vector3(-0.43, 0.77, 0.52),
    lightColor: new THREE.Color(0xfff1dc),
    lightIntensity: 2.7,
    hemiSky: new THREE.Color(0xcfe9ff),
    hemiGround: new THREE.Color(0xd8c39a),
    hemiIntensity: 1.15,
    skyTop: new THREE.Color(),
    skyMid: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    glowX: 0.08,
    glowColor: new THREE.Color(1, 0.95, 0.82),
    rain: 0,
  };
}

const SUN_DAY = C(0xfff1dc),
  SUN_LOW = C(0xffa45c),
  MOON = C(0x9fb4ff);
const GREY_TOP = C(0x6f7c8c),
  GREY_HOR = C(0xa8b2ba);

export function computeAtmosphere(hours: number, rain: number, s: AtmosphereState) {
  s.hours = hours;
  s.rain = rain;
  const theta = ((hours - 6) / 12) * Math.PI; // 0 at sunrise, π at sunset
  const elev = Math.sin(theta);
  s.elev = elev;
  s.day = smoothstep(-0.08, 0.22, elev);
  s.night = 1 - smoothstep(-0.22, 0.02, elev);
  s.dusk = Math.exp(-Math.pow(elev / 0.12, 2)) * (1 - rain * 0.7);
  // key light: sun by day, moon by night (direction swaps while both are dim)
  const sunI = 2.7 * smoothstep(-0.03, 0.3, elev);
  const moonI = 0.5 * s.night;
  if (elev > -0.06) {
    const x = 0.85 * Math.cos(theta);
    s.lightDir.set(x, Math.max(0.12, elev), 0.52).normalize();
    s.lightColor.copy(SUN_LOW).lerp(SUN_DAY, smoothstep(0.02, 0.35, elev));
    s.glowX = 0.5 + x * 0.45;
    s.glowColor.copy(s.lightColor);
  } else {
    const mt = ((hours + 24 - 18) % 24) / 12 * Math.PI;
    const x = 0.7 * Math.cos(mt);
    s.lightDir.set(x, Math.max(0.25, Math.sin(mt)), 0.55).normalize();
    s.lightColor.copy(MOON);
    s.glowX = 0.5 + x * 0.45;
    s.glowColor.copy(MOON);
  }
  s.lightIntensity = Math.max(sunI, moonI) * (1 - rain * 0.55);
  s.hemiSky.copy(C(0x2a3a6a)).lerp(C(0xcfe9ff), s.day);
  s.hemiGround.copy(C(0x2c2c3a)).lerp(C(0xd8c39a), s.day);
  s.hemiIntensity = lerp(0.45, 1.15, s.day) * (1 - rain * 0.15);
  s.light = (0.16 + 0.84 * s.day) * (1 - rain * 0.3);
  skyAt(elev, s.skyTop, s.skyMid, s.skyHorizon);
  if (rain > 0) {
    const k = rain * 0.75;
    s.skyTop.lerp(GREY_TOP.clone().multiplyScalar(0.25 + 0.75 * s.day), k);
    s.skyMid.lerp(GREY_HOR.clone().multiplyScalar(0.25 + 0.75 * s.day), k);
    s.skyHorizon.lerp(GREY_HOR.clone().multiplyScalar(0.3 + 0.7 * s.day), k);
  }
  return s;
}
