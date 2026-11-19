import type { App } from '../core/App';

/**
 * Ambient sound: a soft, white-noise-like soundscape synthesised with Web Audio (no audio files).
 *
 *  - swell:   brown noise, low-passed, breathing slowly with the waves
 *  - foam:    a hushed "shhh" at the top of each swell
 *  - bed:     a warm, very low underwater hum
 *  - crackle: the faint reef crackle of snapping shrimp (sparse tiny clicks)
 *  - wind / rain: only when the weather has them
 *
 * Off by default. Fades out and suspends whenever the ocean is not running (paused wallpaper,
 * hidden window), so it never plays to an empty room.
 */
export class AmbientSound {
  private ac: AudioContext | null = null;
  private master!: GainNode;
  private swell!: GainNode;
  private foam!: GainNode;
  private bed!: GainNode;
  private wind!: GainNode;
  private windBand!: BiquadFilterNode;
  private rain!: GainNode;
  private crackleBus!: GainNode;
  private click!: AudioBuffer;
  private phase = Math.random() * 10;
  private period = 8;
  private lastEnv = 0;
  private rising = false;
  private crackleAt = 0;
  private lastTick = 0;
  private running = false;
  private watch = 0;

  constructor(private app: App) {
    // browsers only start audio after a user gesture
    const kick = () => {
      if (this.on) this.ensure();
    };
    window.addEventListener('pointerdown', kick, { passive: true });
    window.addEventListener('keydown', kick);
    this.watch = window.setInterval(() => this.checkAlive(), 300);
  }

  get on() {
    return this.app.prefs.data.sound.on;
  }
  get volume() {
    return this.app.prefs.data.sound.volume;
  }

  setOn(v: boolean) {
    this.app.prefs.data.sound.on = v;
    this.app.prefs.changed();
    if (v) this.ensure();
    else this.fadeTo(0, 0.6);
  }

  setVolume(v: number) {
    this.app.prefs.data.sound.volume = Math.max(0, Math.min(1, v));
    this.app.prefs.changed();
    if (this.on) this.fadeTo(this.level(), 0.3);
  }

  dispose() {
    window.clearInterval(this.watch);
    this.ac?.close();
    this.ac = null;
  }

  private level() {
    // a gentle curve: the slider's lower half stays very quiet
    return 1.6 * this.volume * this.volume;
  }

  private fadeTo(v: number, time: number) {
    if (!this.ac) return;
    const g = this.master.gain;
    g.cancelScheduledValues(this.ac.currentTime);
    g.setTargetAtTime(v, this.ac.currentTime, time / 3);
  }

  /** Called every simulation step: follows waves, wind and rain. */
  update(dt: number) {
    this.lastTick = performance.now();
    if (!this.on) return;
    if (!this.ac) return;
    if (!this.running) {
      this.running = true;
      if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
      this.fadeTo(this.level(), 1.5);
    }
    const env = this.app.env;
    const wind = env.wind;
    const rain = env.rain;
    const night = env.atm.night;
    const t = this.ac.currentTime;
    // the swell breathes: slow, a little irregular, a bit faster in wind
    this.phase += (dt / this.period) * Math.PI * 2 * (1 + wind * 0.35);
    if (this.phase > Math.PI * 2) {
      this.phase -= Math.PI * 2;
      this.period = 6.5 + Math.random() * 4;
    }
    const e = Math.pow(0.5 + 0.5 * Math.sin(this.phase), 1.6);
    const swellK = 0.35 + 0.65 * e;
    this.swell.gain.setTargetAtTime(0.5 * swellK * (0.55 + 0.6 * wind), t, 0.08);
    // at the top of each swell, a hushed wash of foam
    if (e > this.lastEnv) this.rising = true;
    else if (this.rising && e < this.lastEnv) {
      this.rising = false;
      const a = (0.1 + 0.16 * wind) * (0.7 + Math.random() * 0.6);
      const g = this.foam.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(a, t + 0.5);
      g.setTargetAtTime(0.0, t + 0.6, 0.8);
    }
    this.lastEnv = e;
    this.bed.gain.setTargetAtTime(0.32, t, 0.5);
    // wind only above a light breeze; its whistle wanders a little
    const w = Math.max(0, wind - 0.25) / 0.75;
    this.wind.gain.setTargetAtTime(0.22 * Math.pow(w, 1.2), t, 0.5);
    this.windBand.frequency.setTargetAtTime(420 + 380 * (0.5 + 0.5 * Math.sin(this.phase * 0.37 + 1)), t, 0.6);
    this.rain.gain.setTargetAtTime(0.32 * rain, t, 0.6);
    // reef crackle: schedule sparse clicks a little ahead (a touch livelier at night)
    const rate = 9 + night * 6;
    if (this.crackleAt < t) this.crackleAt = t;
    while (this.crackleAt < t + 0.3) {
      this.crackleAt += -Math.log(1 - Math.random()) / rate;
      const src = this.ac.createBufferSource();
      src.buffer = this.click;
      src.playbackRate.value = 0.7 + Math.random() * 0.9;
      const g = this.ac.createGain();
      g.gain.value = 0.015 + Math.random() * Math.random() * 0.07;
      src.connect(g).connect(this.crackleBus);
      src.start(this.crackleAt);
    }
  }

  /** No simulation steps for a while (paused, hidden): fade out and suspend. */
  private checkAlive() {
    if (!this.ac || !this.running) return;
    if (performance.now() - this.lastTick > 600 || !this.on) {
      this.running = false;
      this.fadeTo(0, 0.4);
      const ac = this.ac;
      window.setTimeout(() => {
        if (!this.running && ac.state === 'running') ac.suspend().catch(() => {});
      }, 700);
    }
  }

  private ensure() {
    if (this.ac) {
      if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    this.ac = ac;
    this.master = ac.createGain();
    this.master.gain.value = 0;
    this.master.connect(ac.destination);
    const brown = noise(ac, 'brown', 8),
      pink = noise(ac, 'pink', 8),
      white = noise(ac, 'white', 4);
    const loop = (buf: AudioBuffer) => {
      const s = ac.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      // the first 50 ms already hold the cross-fade with the tail, so the loop skips the tail
      s.loopStart = 0;
      s.loopEnd = buf.duration - 0.05;
      s.start(0, Math.random() * (buf.duration - 0.1));
      return s;
    };
    const filter = (type: BiquadFilterType, f: number, q = 0.7) => {
      const b = ac.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const gain = (v = 0) => {
      const g = ac.createGain();
      g.gain.value = v;
      return g;
    };
    // swell
    this.swell = gain();
    loop(brown).connect(filter('lowpass', 620, 0.5)).connect(this.swell).connect(this.master);
    // foam
    this.foam = gain();
    loop(pink).connect(filter('highpass', 1400)).connect(filter('lowpass', 5200)).connect(this.foam).connect(this.master);
    // bed
    this.bed = gain();
    loop(brown).connect(filter('lowpass', 140, 0.6)).connect(this.bed).connect(this.master);
    // wind
    this.wind = gain();
    this.windBand = filter('bandpass', 600, 0.9);
    loop(pink).connect(this.windBand).connect(this.wind).connect(this.master);
    // rain
    this.rain = gain();
    loop(white).connect(filter('highpass', 1800)).connect(filter('lowpass', 8000)).connect(this.rain).connect(this.master);
    // crackle
    this.crackleBus = gain(1);
    this.crackleBus.connect(filter('highpass', 2600)).connect(this.master);
    const n = Math.floor(ac.sampleRate * 0.006);
    this.click = ac.createBuffer(1, n, ac.sampleRate);
    const d = this.click.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.18));
    if (ac.state === 'suspended') ac.resume().catch(() => {});
  }
}

/** A loopable noise buffer (white / pink / brown), normalised. */
function noise(ac: BaseAudioContext, kind: 'white' | 'pink' | 'brown', seconds: number) {
  const n = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0,
    last = 0,
    peak = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    let v = w;
    if (kind === 'pink') {
      // Paul Kellet's refined pink filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      v = last;
    }
    d[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  // normalise, and cross-fade the ends so the loop has no click
  const fade = Math.floor(ac.sampleRate * 0.05);
  for (let i = 0; i < n; i++) d[i] /= peak || 1;
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = d[i] * k + d[n - fade + i] * (1 - k);
  }
  return buf;
}
