/**
 * Analytic wind-driven waves (sum of directional sines) evaluated identically on CPU and GPU.
 * Phases are integrated on the CPU so changing the wind never causes phase jumps.
 */
export interface WaveDef {
  k: number;
  dir: [number, number];
  amp: number;
  calm: number;
  pow: number;
}

const RAW: WaveDef[] = [
  // long, low swell: visible even in calm weather, rocks floating objects
  { k: 0.24, dir: [1, 0.05], amp: 0.3, calm: 0.13, pow: 0.9 },
  { k: 0.42, dir: [1, 0.12], amp: 0.24, calm: 0.09, pow: 1.0 },
  { k: 0.77, dir: [0.96, -0.3], amp: 0.13, calm: 0.08, pow: 1.1 },
  { k: 1.38, dir: [0.9, 0.44], amp: 0.075, calm: 0.04, pow: 1.3 },
  { k: 2.35, dir: [0.82, -0.57], amp: 0.042, calm: 0.02, pow: 1.6 },
  { k: 3.7, dir: [0.7, 0.71], amp: 0.022, calm: 0.0, pow: 1.8 },
];

export const WAVES: WaveDef[] = RAW.map((w) => {
  const l = Math.hypot(w.dir[0], w.dir[1]);
  return { ...w, dir: [w.dir[0] / l, w.dir[1] / l] as [number, number] };
});
export const WAVE_COUNT = WAVES.length;

export class WaveField {
  readonly amps = new Float32Array(WAVE_COUNT);
  readonly phases = new Float32Array(WAVE_COUNT);

  constructor() {
    WAVES.forEach((_, i) => (this.phases[i] = i * 1.7));
    this.update(0, 0.25);
  }

  update(dt: number, wind: number) {
    for (let i = 0; i < WAVE_COUNT; i++) {
      const w = WAVES[i];
      // Calm water keeps a faint natural swell; wind grows amplitude and chop.
      this.amps[i] = w.amp * (w.calm + (1 - w.calm) * Math.pow(wind, w.pow) * 1.0);
      const omega = Math.sqrt(9.8 * w.k) * (0.42 + 0.45 * wind);
      this.phases[i] = (this.phases[i] + omega * dt) % 6283.1853;
    }
  }

  height(x: number, z: number) {
    let h = 0;
    for (let i = 0; i < WAVE_COUNT; i++) {
      const w = WAVES[i];
      h += this.amps[i] * Math.sin(w.k * (w.dir[0] * x + w.dir[1] * z) - this.phases[i]);
    }
    return h;
  }

  /** GLSL source for the same wave function. Needs uniforms uWaveA[] and uWaveP[]. */
  static glsl(): string {
    const n = WAVE_COUNT;
    const terms = WAVES.map(
      (w, i) =>
        `{ float a = ${w.k.toFixed(4)} * dot(p, vec2(${w.dir[0].toFixed(4)}, ${w.dir[1].toFixed(4)})) - uWaveP[${i}];
           h += uWaveA[${i}] * sin(a);
           g += uWaveA[${i}] * ${w.k.toFixed(4)} * cos(a) * vec2(${w.dir[0].toFixed(4)}, ${w.dir[1].toFixed(4)}); }`,
    ).join('\n');
    return `
    uniform float uWaveA[${n}];
    uniform float uWaveP[${n}];
    // returns height in .x, gradient in .yz
    vec3 waveField(vec2 p){
      float h = 0.0; vec2 g = vec2(0.0);
      ${terms}
      return vec3(h, g);
    }`;
  }
}
