import * as THREE from 'three';
import { CONFIG, DEFAULTS, type WaterPresetId } from '../config';
import { damp } from '../util/math';
import { lookFromColor, PRESETS, WaterColorController } from '../water/WaterColor';
import { shared } from '../util/shaders';
import { computeAtmosphere, createAtmosphere, type AtmosphereState } from '../world/Atmosphere';

const WARM_WHITE = new THREE.Color(1, 1, 0.95);

export type TimeMode = 'manual' | 'cycle' | 'clock';
export type TideMode = 'manual' | 'auto';

export const SEA_LEVEL_RANGE: [number, number] = [-1.2, 0.8];

/**
 * Environment parameters, independent of the active tool: wind, water colour, time of day
 * (manual / accelerated cycle / follow the PC clock), rain and sea level (manual / tide cycle).
 * All of them change smoothly.
 */
export class EnvironmentController {
  windTarget = DEFAULTS.wind;
  /** Smoothed wind, 0..1 */
  wind = DEFAULTS.wind / 100;
  preset: WaterPresetId = DEFAULTS.waterPreset;
  customColor = DEFAULTS.customColor;
  /** Hours 0..24. */
  timeOfDay = 14.5;
  timeMode: TimeMode = 'manual';
  /** Real seconds for a full day in cycle mode. */
  dayLength = 360;
  rainTarget = 0;
  rain = 0;
  seaLevelTarget = 0;
  seaLevel = 0;
  tideMode: TideMode = 'manual';
  private tideT = 0;
  private displayHours = 14.5;
  readonly atm: AtmosphereState = createAtmosphere();
  private listeners: (() => void)[] = [];
  private uiTick = 0;

  constructor(readonly colors: WaterColorController) {
    computeAtmosphere(this.timeOfDay, 0, this.atm);
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  setWind(v: number) {
    this.windTarget = Math.max(0, Math.min(100, v));
    this.emit();
  }
  setPreset(id: WaterPresetId) {
    this.preset = id;
    this.colors.setTarget(id === 'custom' ? lookFromColor(this.customColor) : PRESETS[id]);
    this.emit();
  }
  setCustomColor(hex: string) {
    this.customColor = hex;
    this.preset = 'custom';
    this.colors.setTarget(lookFromColor(hex));
    this.emit();
  }
  setTime(h: number) {
    this.timeOfDay = ((h % 24) + 24) % 24;
    if (this.timeMode === 'clock') this.timeMode = 'manual';
    this.emit();
  }
  setTimeMode(m: TimeMode) {
    this.timeMode = m;
    this.emit();
  }
  setRain(v: number) {
    this.rainTarget = Math.max(0, Math.min(100, v));
    this.emit();
  }
  setSeaLevel(v: number) {
    this.seaLevelTarget = Math.max(SEA_LEVEL_RANGE[0], Math.min(SEA_LEVEL_RANGE[1], v));
    this.tideMode = 'manual';
    this.emit();
  }
  setTideMode(m: TideMode) {
    this.tideMode = m;
    this.emit();
  }

  reset() {
    this.windTarget = DEFAULTS.wind;
    this.customColor = DEFAULTS.customColor;
    this.rainTarget = 0;
    this.seaLevelTarget = 0;
    this.tideMode = 'manual';
    this.timeMode = 'manual';
    this.timeOfDay = 14.5;
    this.setPreset(DEFAULTS.waterPreset);
  }

  windLabel() {
    const w = this.windTarget;
    return w < 8 ? 'Calm' : w < 30 ? 'Light breeze' : w < 55 ? 'Breezy' : w < 80 ? 'Windy' : 'Strong';
  }
  timeLabel() {
    const h = Math.floor(this.timeOfDay),
      m = Math.floor((this.timeOfDay - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  tideLabel() {
    const l = this.seaLevel;
    return l < -0.6 ? 'Low tide' : l < -0.15 ? 'Ebbing' : l < 0.2 ? 'Mid tide' : l < 0.55 ? 'Rising' : 'High tide';
  }

  update(dt: number) {
    this.wind = damp(this.wind, this.windTarget / 100, CONFIG.wind.smoothing, dt);
    this.rain = damp(this.rain, this.rainTarget / 100, 0.6, dt);
    shared.uWind.value = this.wind;
    shared.uSwayTime.value += dt * (0.55 + this.wind * 1.7);
    this.colors.update(dt);

    // time of day
    if (this.timeMode === 'cycle') this.timeOfDay = (this.timeOfDay + (dt * 24) / this.dayLength) % 24;
    else if (this.timeMode === 'clock') {
      const d = new Date();
      this.timeOfDay = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    }
    // smooth display time (wraps around midnight)
    let dh = this.timeOfDay - this.displayHours;
    if (dh > 12) dh -= 24;
    if (dh < -12) dh += 24;
    this.displayHours = (this.displayHours + dh * Math.min(1, dt * 3) + 24) % 24;
    computeAtmosphere(this.displayHours, this.rain, this.atm);

    // tide
    if (this.tideMode === 'auto') {
      this.tideT += dt;
      this.seaLevelTarget = -0.2 + 0.9 * Math.sin((this.tideT / 240) * Math.PI * 2);
    }
    this.seaLevel = damp(this.seaLevel, this.seaLevelTarget, 0.8, dt);
    shared.uWaterLevel.value = this.seaLevel;

    // light-dependent shading
    const a = this.atm;
    shared.uCausticStrength.value = 0.5 * a.day * (1 - a.rain * 0.65);
    shared.uCausticColor.value.copy(this.colors.current.shallow).lerp(WARM_WHITE, 0.65);

    // keep the panel's live readouts fresh in cycle / clock / tide modes
    if (this.timeMode !== 'manual' || this.tideMode === 'auto') {
      this.uiTick -= dt;
      if (this.uiTick <= 0) {
        this.uiTick = 1;
        this.emit();
      }
    }
  }
}
