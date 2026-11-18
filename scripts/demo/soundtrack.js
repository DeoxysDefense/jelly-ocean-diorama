/*
 * Soundtrack for the demo video, synthesised in the browser with an OfflineAudioContext — every
 * note and sound effect is made from oscillators and filtered noise (no samples, no downloads).
 *
 * Music: a warm tropical loop in F major at 100 BPM — marimba hook (the earworm), soft pad,
 * round bass and a light shaker. Arrangement follows the video chapters: the hook opens the
 * title, the groove carries the play chapters, it thins out for the bottle, ducks under the
 * storm, turns dreamy at sunset/night and resolves on the outro.
 * Sound effects are scheduled from the director's event log; wind / rain / night ambience follow
 * the recorded environment timeline.
 */
window.renderSoundtrack = async function ({ events, env, chapters: T, end }, sampleRate = 48000) {
  const dur = end;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);
  const rnd = mulberry(7);

  // ------------------------------------------------------------------ buses
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  comp.attack.value = 0.005;
  comp.release.value = 0.25;
  // brick-wall-ish limiter last, so the louder mix never clips
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  master.connect(comp).connect(limiter).connect(ctx.destination);
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(1.7, 0.25);
  master.gain.setValueAtTime(1.7, dur - 1.6);
  master.gain.linearRampToValueAtTime(0, dur);
  const music = ctx.createGain();
  const sfx = ctx.createGain();
  const amb = ctx.createGain();
  music.gain.value = 0.42;
  sfx.gain.value = 1.5;
  amb.gain.value = 0.6;
  // a little stereo room for the music
  const verb = makeReverb(ctx, 1.6, 0.35);
  const verbSend = ctx.createGain();
  verbSend.gain.value = 0.22;
  music.connect(master);
  music.connect(verbSend).connect(verb).connect(master);
  sfx.connect(master);
  amb.connect(master);

  const noise = makeNoise(ctx, 3);
  const at = (t) => Math.max(0, t);
  const chap = (i) => T[i];

  // ------------------------------------------------------------------ instruments
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const N = { F3: 53, G3: 55, A3: 57, Bb3: 58, C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, Bb4: 70, C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, A5: 81, C6: 84 };
  function marimba(note, t, vel = 0.5, pan = 0) {
    const f = midi(note);
    const out = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    out.connect(p).connect(music);
    const g = out.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(vel, t + 0.004);
    g.exponentialRampToValueAtTime(0.001, t + 1.3);
    const o1 = osc('sine', f, t, t + 1.4, out);
    void o1;
    // bright "wooden" partial that dies quickly
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(vel * 0.5, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    g2.connect(p);
    osc('sine', f * 3.93, t, t + 0.25, g2);
    const g3 = ctx.createGain();
    g3.gain.setValueAtTime(vel * 0.25, t);
    g3.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    g3.connect(p);
    osc('sine', f * 9.2, t, t + 0.05, g3);
  }
  function pad(notes, t, len, vol = 0.05) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1000;
    lp.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.5);
    g.gain.setValueAtTime(vol, t + len - 0.3);
    g.gain.linearRampToValueAtTime(0, t + len + 0.6);
    lp.connect(g).connect(music);
    for (const n of notes)
      for (const d of [-7, 7]) {
        const o = osc('sawtooth', midi(n), t, t + len + 0.7, lp);
        o.detune.value = d;
      }
  }
  function bass(note, t, len, vol = 0.22) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(vol * 0.5, t + len * 0.8);
    g.gain.linearRampToValueAtTime(0, t + len);
    lp.connect(g).connect(music);
    osc('triangle', midi(note - 12), t, t + len + 0.05, lp);
  }
  function shaker(t, vol = 0.03) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.07);
    hp.connect(g).connect(music);
    play(noise, t, 0.09, hp, rnd() * 2);
  }
  function bell(note, t, vol = 0.12) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    g.connect(music);
    osc('sine', midi(note), t, t + 2.3, g);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(vol * 0.35, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    g2.connect(music);
    osc('sine', midi(note) * 2.76, t, t + 1, g2);
  }

  // ------------------------------------------------------------------ the music
  const beat = 60 / 100; // 100 BPM
  const bar = beat * 4;
  // the hook: up-and-back phrase, two bars — the melody people remember
  const HOOK_A = [
    [0, N.C5],
    [0.5, N.A4],
    [1, N.C5],
    [1.5, N.D5],
    [2, N.F5],
    [3, N.D5],
    [3.5, N.C5],
  ];
  const HOOK_B = [
    [0, N.D5],
    [0.5, N.C5],
    [1, N.A4],
    [1.5, N.G4],
    [2, N.F4],
    [2.5, N.G4],
    [3, N.A4],
  ];
  const CHORDS = [
    { root: N.F3, notes: [N.F4, N.A4, N.C5] }, // F
    { root: N.D4 - 12, notes: [N.D4, N.F4, N.A4] }, // Dm
    { root: N.Bb3, notes: [N.Bb3, N.D4, N.F4] }, // Bb
    { root: N.C4 - 12, notes: [N.C4, N.E4, N.G4] }, // C
  ];
  const t0 = 0.15;
  const nBars = Math.ceil((dur - t0) / bar);
  const section = (t) => {
    if (t < T[0]) return 'intro';
    if (t >= T[9] - 0.2) return 'outro';
    if (t >= T[8]) return 'night';
    if (t >= T[7]) return 'storm';
    if (t >= T[4] && t < T[5]) return 'mail';
    return 'groove';
  };
  for (let b = 0; b < nBars; b++) {
    const bt = t0 + b * bar;
    if (bt > dur - 0.5) break;
    const ch = CHORDS[b % 4];
    const sec = section(bt);
    const last = bt + bar > dur - 2.6;
    // pad under everything (softer in the storm, warmer at night)
    pad(last ? [N.F4, N.A4, N.C5] : ch.notes, bt, last ? dur - bt - 0.4 : bar, sec === 'storm' ? 0.03 : sec === 'night' ? 0.06 : 0.045);
    if (last) {
      bass(N.F3, bt, dur - bt - 0.4, 0.2);
      marimba(N.F5, bt, 0.5, 0.1);
      marimba(N.C5, bt + 0.02, 0.32, -0.15);
      marimba(N.A4, bt + 0.04, 0.3, 0.15);
      bell(N.F5 + 12, bt + 0.3, 0.06);
      break;
    }
    // bass: root on 1, a pickup on the "and" of 3
    if (sec !== 'intro') {
      bass(ch.root, bt, beat * 2.2, sec === 'storm' ? 0.16 : 0.22);
      bass(ch.root + (b % 2 ? 7 : 12), bt + beat * 2.5, beat * 1.3, 0.14);
    }
    // shaker on the off-beats while we play
    if (sec === 'groove')
      for (let k = 0; k < 8; k++) shaker(bt + k * beat * 0.5 + beat * 0.25, k % 2 ? 0.035 : 0.02);
    // melody: the hook every 4 bars (intro, groove, outro), soft arpeggios otherwise
    const phrase = b % 4;
    const hookBar = sec === 'intro' || sec === 'outro' || sec === 'night' ? phrase < 2 : phrase < 2 && b % 8 < 4;
    if (hookBar && sec !== 'storm') {
      const H = phrase === 0 ? HOOK_A : HOOK_B;
      for (const [pos, n] of H) marimba(n, bt + pos * beat, sec === 'night' ? 0.32 : 0.42, (n - 70) / 40);
    } else {
      const arp = [...ch.notes, ch.notes[1] + 12];
      const vol = sec === 'storm' ? 0.12 : sec === 'mail' ? 0.18 : 0.2;
      for (let k = 0; k < 8; k++) {
        if (sec === 'storm' && k % 2) continue;
        marimba(arp[[0, 1, 2, 3, 2, 1, 2, 3][k]], bt + k * beat * 0.5, vol * (k % 2 ? 0.7 : 1), k % 2 ? 0.25 : -0.25);
      }
    }
    if (sec === 'night' && phrase === 0) bell(N.C6, bt + beat * 2, 0.05);
  }
  // duck the music under the storm
  music.gain.setValueAtTime(0.42, at(T[7] - 0.4));
  music.gain.linearRampToValueAtTime(0.26, T[7] + 0.6);
  music.gain.setValueAtTime(0.26, T[8] - 0.3);
  music.gain.linearRampToValueAtTime(0.46, T[8] + 0.8);

  // ------------------------------------------------------------------ ambience (from the env timeline)
  // gentle sea always; wind and rain follow the recorded weather; quieter at night
  const sea = filtered('lowpass', 520, 0.7, amb);
  const seaG = sea.gain;
  const wind = filtered('bandpass', 700, 0.9, amb);
  const windG = wind.gain;
  const rainF = filtered('highpass', 2600, 0.5, amb);
  const rainG = rainF.gain;
  play(noise, 0, dur, sea.input, 0, true);
  play(noise, 0, dur, wind.input, 1.1, true);
  play(noise, 0, dur, rainF.input, 2.2, true);
  seaG.setValueAtTime(0.0, 0);
  windG.setValueAtTime(0.0, 0);
  rainG.setValueAtTime(0.0, 0);
  for (let i = 0; i < env.length; i += 6) {
    const [t, w, r, n] = env[i];
    const swell = 0.5 + 0.5 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1);
    seaG.linearRampToValueAtTime((0.13 + 0.12 * w) * (0.75 + 0.5 * swell) * (1 - 0.35 * n), t);
    windG.linearRampToValueAtTime(0.32 * Math.pow(Math.max(0, w - 0.25) / 0.75, 1.6), t);
    wind.filter.frequency.linearRampToValueAtTime(500 + 500 * w + 150 * Math.sin(t * 1.7), t);
    rainG.linearRampToValueAtTime(0.18 * r, t);
  }
  // rain drops: tiny ticks while it rains
  for (let i = 0; i < env.length; i += 2) {
    const [t, , r] = env[i];
    if (r > 0.1 && rnd() < r * 0.9) tick(t + rnd() * 0.03, 0.03 * r);
  }

  // ------------------------------------------------------------------ sound effects
  for (const e of events) {
    const t = e.t;
    switch (e.type) {
      case 'title':
        whoosh(t + 0.1, 1.4, 0.1, 300, 1400);
        break;
      case 'tap':
        tap(t);
        break;
      case 'swish':
        whoosh(t, e.dur, 0.12, 500, 1600);
        break;
      case 'lift':
        gloop(t, e.dur);
        break;
      case 'splash':
        splash(t, e.size ?? 1);
        break;
      case 'plop':
        plop(t, 700 + rnd() * 500, 0.16);
        break;
      case 'current':
        whoosh(t, e.dur, 0.16, 350, 1200, 4);
        for (let k = 0; k < 6; k++) bubble(t + 0.3 + k * 0.45 + rnd() * 0.2, 0.08);
        break;
      case 'whoosh':
        whoosh(t, e.dur, 0.09, 250, 1300);
        break;
      case 'island':
        rumble(t, 1.4);
        sandHiss(t + 0.05, 1.0);
        for (let k = 0; k < 7; k++) bubble(t + 0.2 + k * 0.12 + rnd() * 0.1, 0.1);
        break;
      case 'place':
        thump(t, 0.35);
        bubble(t + 0.08, 0.08);
        bubble(t + 0.2, 0.06);
        break;
      case 'bottle':
        pop(t + 0.02);
        clink(t + 0.06);
        paper(t + 0.25, 0.7);
        bell(N.A5, t + 0.15, 0.06);
        break;
      case 'paper':
        paper(t, e.dur);
        break;
      case 'rustle':
        rustle(t, e.dur);
        break;
      case 'thud':
        thump(t, 0.5);
        break;
      case 'throw':
        whoosh(t, 0.35, 0.12, 900, 2400);
        break;
      case 'skip':
        skip(t, e.k);
        break;
      case 'plunge':
        splash(t, 0.8);
        break;
      case 'thunder':
        thunder(t);
        break;
      case 'sparkle':
        sparkle(t);
        break;
    }
  }

  return ctx.startRendering();

  // ================================================================== helpers
  function osc(type, f, t, stop, dest) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.connect(dest);
    o.start(at(t));
    o.stop(Math.min(dur, stop));
    return o;
  }
  function play(buf, t, len, dest, offset = 0, loop = false) {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    s.connect(dest);
    s.start(at(t), offset % buf.duration);
    s.stop(Math.min(dur, t + len));
    return s;
  }
  function filtered(type, f, q, dest) {
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = f;
    filter.Q.value = q;
    const g = ctx.createGain();
    filter.connect(g).connect(dest);
    return { input: filter, filter, gain: g.gain };
  }
  function env1(g, t, a, peak, d) {
    g.setValueAtTime(0, at(t));
    g.linearRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(0.0008, t + a + d);
  }
  function tap(t) {
    const g = ctx.createGain();
    env1(g.gain, t, 0.002, 0.08, 0.06);
    g.connect(sfx);
    osc('sine', 1650, t, t + 0.08, g);
  }
  function tick(t, vol) {
    const f = filtered('bandpass', 3500 + rnd() * 3000, 2, sfx);
    env1(f.gain, t, 0.001, vol, 0.03);
    play(noise, t, 0.04, f.input, rnd() * 2);
  }
  function whoosh(t, len, vol, f0, f1, wobble = 0) {
    const f = filtered('bandpass', f0, 1.1, sfx);
    f.gain.setValueAtTime(0, at(t));
    f.gain.linearRampToValueAtTime(vol, t + len * 0.35);
    f.gain.linearRampToValueAtTime(0, t + len);
    f.filter.frequency.setValueAtTime(f0, at(t));
    f.filter.frequency.exponentialRampToValueAtTime(f1, t + len * 0.5);
    f.filter.frequency.exponentialRampToValueAtTime(f0 * 1.2, t + len);
    if (wobble) for (let k = 1; k < wobble * 2; k++) f.filter.frequency.setValueAtTime(f0 + (f1 - f0) * (0.4 + 0.6 * (k % 2)), t + (len * k) / (wobble * 2));
    play(noise, t, len + 0.05, f.input, rnd() * 2);
  }
  function plop(t, f0, vol) {
    const g = ctx.createGain();
    env1(g.gain, t, 0.003, vol, 0.1);
    g.connect(sfx);
    const o = osc('sine', f0, t, t + 0.14, g);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + 0.08);
  }
  function bubble(t, vol) {
    const g = ctx.createGain();
    env1(g.gain, t, 0.004, vol, 0.07);
    g.connect(sfx);
    const f0 = 500 + rnd() * 500;
    const o = osc('sine', f0, t, t + 0.1, g);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.4, t + 0.07);
  }
  function splash(t, size) {
    const f = filtered('bandpass', 2200, 0.8, sfx);
    env1(f.gain, t, 0.005, 0.28 * size, 0.35 + 0.25 * size);
    f.filter.frequency.setValueAtTime(2600, t);
    f.filter.frequency.exponentialRampToValueAtTime(500, t + 0.4);
    play(noise, t, 0.8, f.input, rnd() * 2);
    plop(t, 420, 0.14 * size);
    for (let k = 0; k < 3; k++) tick(t + 0.05 + rnd() * 0.25, 0.05 * size);
  }
  function gloop(t, len) {
    // stretchy jelly water: a slow wobbling rise
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.2);
    g.gain.setValueAtTime(0.12, t + len - 0.3);
    g.gain.linearRampToValueAtTime(0, t + len);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(g).connect(sfx);
    const o = osc('triangle', 140, t, t + len + 0.05, lp);
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(260, t + len);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lg = ctx.createGain();
    lg.gain.value = 18;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(Math.min(dur, t + len + 0.05));
  }
  function rumble(t, len) {
    const f = filtered('lowpass', 160, 0.7, sfx);
    f.gain.setValueAtTime(0, t);
    f.gain.linearRampToValueAtTime(0.85, t + 0.25);
    f.gain.exponentialRampToValueAtTime(0.001, t + len);
    play(noise, t, len + 0.1, f.input, rnd() * 2);
    const g = ctx.createGain();
    env1(g.gain, t, 0.05, 0.2, len);
    g.connect(sfx);
    const o = osc('sine', 62, t, t + len, g);
    o.frequency.exponentialRampToValueAtTime(40, t + len);
  }
  function sandHiss(t, len) {
    const f = filtered('bandpass', 4200, 0.7, sfx);
    f.gain.setValueAtTime(0, t);
    f.gain.linearRampToValueAtTime(0.07, t + 0.15);
    f.gain.linearRampToValueAtTime(0, t + len);
    play(noise, t, len, f.input, rnd() * 2);
  }
  function thump(t, vol) {
    const g = ctx.createGain();
    env1(g.gain, t, 0.003, vol, 0.16);
    g.connect(sfx);
    const o = osc('sine', 120, t, t + 0.2, g);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.14);
    const f = filtered('lowpass', 500, 0.7, sfx);
    env1(f.gain, t, 0.002, vol * 0.4, 0.06);
    play(noise, t, 0.08, f.input, rnd() * 2);
  }
  function pop(t) {
    const g = ctx.createGain();
    env1(g.gain, t, 0.001, 0.22, 0.04);
    g.connect(sfx);
    const o = osc('sine', 900, t, t + 0.06, g);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.04);
    tick(t, 0.12);
  }
  function clink(t) {
    for (const [f, v] of [
      [2350, 0.07],
      [3720, 0.05],
      [5230, 0.03],
    ]) {
      const g = ctx.createGain();
      env1(g.gain, t, 0.002, v, 0.7);
      g.connect(sfx);
      osc('sine', f, t, t + 0.8, g);
    }
  }
  function paper(t, len) {
    for (let k = 0; k < len * 40; k++) {
      const tt = t + rnd() * len;
      const f = filtered('bandpass', 2500 + rnd() * 2500, 1.2, sfx);
      env1(f.gain, tt, 0.002, 0.035 + rnd() * 0.04, 0.03 + rnd() * 0.03);
      play(noise, tt, 0.08, f.input, rnd() * 2);
    }
  }
  function rustle(t, len) {
    // palm fronds: a shaky bandpassed noise
    const f = filtered('bandpass', 2600, 0.6, sfx);
    f.gain.setValueAtTime(0, t);
    for (let k = 0; k < len * 18; k++) f.gain.linearRampToValueAtTime(0.05 + rnd() * 0.12 * (1 - k / (len * 18)), t + k / 18);
    f.gain.linearRampToValueAtTime(0, t + len);
    play(noise, t, len + 0.05, f.input, rnd() * 2);
  }
  function skip(t, k) {
    const vol = 0.22 * Math.pow(0.86, k - 1);
    const g = ctx.createGain();
    env1(g.gain, t, 0.002, vol, 0.09);
    g.connect(sfx);
    const f0 = 1500 + k * 90;
    const o = osc('sine', f0, t, t + 0.12, g);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.07);
    const f = filtered('bandpass', 3000, 0.9, sfx);
    env1(f.gain, t, 0.002, vol * 0.6, 0.12);
    play(noise, t, 0.18, f.input, rnd() * 2);
  }
  function thunder(t) {
    const f = filtered('lowpass', 140, 0.6, sfx);
    f.gain.setValueAtTime(0, t);
    for (let k = 0; k < 30; k++) f.gain.linearRampToValueAtTime((0.35 + rnd() * 0.7) * Math.exp(-k / 14), t + 0.05 + k * 0.09);
    f.gain.linearRampToValueAtTime(0, t + 3);
    play(noise, t, 3.1, f.input, rnd() * 2);
  }
  function sparkle(t) {
    const notes = [N.C6, N.A5, N.F5 + 12, N.G5 + 12, N.D5 + 12];
    const g = ctx.createGain();
    env1(g.gain, t, 0.003, 0.04, 0.6);
    g.connect(sfx);
    osc('sine', midi(notes[Math.floor(rnd() * notes.length)]), t, t + 0.7, g);
  }
};

function makeNoise(ctx, seconds) {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(seconds * sr), sr);
  const d = buf.getChannelData(0);
  const r = mulberry(3);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return buf;
}
function makeReverb(ctx, seconds, decay) {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const r = mulberry(11);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, 1 / decay) * 0.5;
  }
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}
function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
