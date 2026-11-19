/**
 * V3 preferences and slow "real time" state (language, Ocean Mail, surprises, island life,
 * personal bests). Saved automatically to localStorage — separate from the explicit
 * Save World slot — so timers survive restarts even if the user never presses Save.
 * Temporary things (ripples, particles, an event in progress) are never stored here.
 */
export type Lang = 'zh' | 'en';
export type Frequency = 'rare' | 'normal' | 'often';

export interface TreeState {
  /** Ripe coconuts hanging on the tree. */
  ripe: number;
  /** Wall-clock ms when the coconut currently growing started. */
  since: number;
}

export interface PrefsData {
  version: 1;
  lang: Lang;
  mail: { on: boolean; freq: Frequency; nextIn: number; recent: string[] };
  events: { on: boolean; freq: Frequency; nextIn: number; last: string };
  coconut: { on: boolean; intervalMin: number; max: number; trees: TreeState[] };
  /** V2 (P3) rare visitors: off / few / normal, and active seconds until the next can come. */
  visitors: { mode: 'off' | 'few' | 'normal'; wait: number };
  /** Ambient sound (off by default) and its volume 0..1. */
  sound: { on: boolean; volume: number };
  magnifierZoom: number;
  bestSkips: number;
  hideSeekFound: number;
}

const KEY = 'jelly-ocean-v3';

/** Active-time ranges in seconds for each frequency setting. */
export const MAIL_INTERVAL: Record<Frequency, [number, number]> = {
  rare: [90 * 60, 180 * 60],
  normal: [45 * 60, 120 * 60],
  often: [12 * 60, 30 * 60],
};
export const EVENT_INTERVAL: Record<Frequency, [number, number]> = {
  rare: [30 * 60, 60 * 60],
  normal: [15 * 60, 40 * 60],
  often: [4 * 60, 10 * 60],
};
export const COCONUT_INTERVALS = [30, 60, 120, 180, 360];

const randIn = ([a, b]: [number, number]) => a + Math.random() * (b - a);

function defaults(): PrefsData {
  const zh = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '');
  const now = Date.now();
  return {
    version: 1,
    lang: zh ? 'zh' : 'en',
    // a fresh install waits a full interval: no bottle right after the first page load
    mail: { on: true, freq: 'normal', nextIn: randIn(MAIL_INTERVAL.normal), recent: [] },
    events: { on: true, freq: 'normal', nextIn: randIn(EVENT_INTERVAL.normal), last: '' },
    coconut: { on: true, intervalMin: 180, max: 4, trees: [{ ripe: 2, since: now }, { ripe: 1, since: now }] },
    // a fresh install waits a little before the first visitor can come
    visitors: { mode: 'normal', wait: 10 * 60 },
    sound: { on: false, volume: 0.6 },
    magnifierZoom: 2,
    bestSkips: 0,
    hideSeekFound: 0,
  };
}

export class Prefs {
  data: PrefsData;
  private timer = 0;
  private listeners: (() => void)[] = [];

  constructor() {
    this.data = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.merge(JSON.parse(raw));
    } catch {
      /* storage blocked: defaults */
    }
  }

  /** Merges stored / imported data over the defaults, keeping only known, valid fields. */
  merge(o: Partial<PrefsData> | null | undefined) {
    if (!o || typeof o !== 'object') return;
    const d = this.data;
    if (o.lang === 'zh' || o.lang === 'en') d.lang = o.lang;
    const freq = (f: unknown, fb: Frequency): Frequency => (f === 'rare' || f === 'normal' || f === 'often' ? f : fb);
    if (o.mail) {
      d.mail.on = o.mail.on !== false;
      d.mail.freq = freq(o.mail.freq, d.mail.freq);
      if (Number.isFinite(o.mail.nextIn)) d.mail.nextIn = Math.max(60, o.mail.nextIn);
      if (Array.isArray(o.mail.recent)) d.mail.recent = o.mail.recent.filter((s) => typeof s === 'string').slice(-40);
    }
    if (o.events) {
      d.events.on = o.events.on !== false;
      d.events.freq = freq(o.events.freq, d.events.freq);
      if (Number.isFinite(o.events.nextIn)) d.events.nextIn = Math.max(60, o.events.nextIn);
      if (typeof o.events.last === 'string') d.events.last = o.events.last;
    }
    if (o.coconut) {
      const c = o.coconut;
      d.coconut.on = c.on !== false;
      if (COCONUT_INTERVALS.includes(c.intervalMin)) d.coconut.intervalMin = c.intervalMin;
      if (Number.isFinite(c.max)) d.coconut.max = Math.max(3, Math.min(5, Math.round(c.max)));
      if (Array.isArray(c.trees))
        // V2: more palms than the two v1 trees (the coconut system trims to the real count)
        c.trees.slice(0, 16).forEach((t, i) => {
          if (t && Number.isFinite(t.ripe) && Number.isFinite(t.since)) d.coconut.trees[i] = { ripe: Math.max(0, Math.min(5, Math.round(t.ripe))), since: t.since };
        });
    }
    if (o.visitors) {
      const v = o.visitors;
      if (v.mode === 'off' || v.mode === 'few' || v.mode === 'normal') d.visitors.mode = v.mode;
      if (Number.isFinite(v.wait)) d.visitors.wait = Math.max(0, Math.min(3 * 3600, v.wait));
    }
    if (o.sound) {
      d.sound.on = o.sound.on === true;
      if (Number.isFinite(o.sound.volume)) d.sound.volume = Math.max(0, Math.min(1, o.sound.volume));
    }
    if (Number.isFinite(o.magnifierZoom)) d.magnifierZoom = [1.5, 2, 3].includes(o.magnifierZoom!) ? o.magnifierZoom! : 2;
    if (Number.isFinite(o.bestSkips)) d.bestSkips = Math.max(0, Math.round(o.bestSkips!));
    if (Number.isFinite(o.hideSeekFound)) d.hideSeekFound = Math.max(0, Math.round(o.hideSeekFound!));
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  /** Call after any change: notifies listeners and schedules a debounced save. */
  changed(notify = true) {
    if (notify) for (const l of this.listeners) l();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 400) as unknown as number;
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  static randIn = randIn;
}
