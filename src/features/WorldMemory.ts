import { dayKey } from '../content/journal';

/**
 * V2 (P2) World Memory — what this sea has seen.
 *
 * An append-only diary of things that happened, whether or not anyone was watching: a bottle that
 * drifted past, rain, a hermit crab moving house, the first time you noticed a species … It is
 * not an action log: Undo never touches it, Reset World keeps it, and it lives in its own
 * storage (not in the Save World slot). Repeats of the same small thing within a day merge into
 * one line, and the oldest days fold into one-line summaries past {@link WorldMemory.MAX}.
 */
export interface MemoryEntry {
  /** Real time (ms). */
  t: number;
  /** In-world hour when it happened (for the diary's "傍晚，…"). */
  h?: number;
  /** Kind of entry (see content/journal.ts memoryLine). */
  k: string;
  p?: Record<string, unknown>;
  /** Repeats merged into this line (same day). */
  n?: number;
}

const KEY = 'jelly-ocean-journal-v1';
/** Kinds that merge with an earlier entry of the same day instead of adding a line. */
const MERGE = new Set(['coconutSea', 'bottlePassed', 'hermitSwap', 'octopusInk', 'rain', 'lowTide', 'game']);
/** Kinds that happen at most once per day (no count shown). */
const ONCE_A_DAY = new Set(['lowTide']);

export interface MemoryData {
  v: 1;
  entries: MemoryEntry[];
  /** Species / behaviours the user has observed, with the first time (ms). P3 builds on this. */
  observed: Record<string, number>;
  /** Names the user gave to things they made (by creation id). */
  names: Record<string, string>;
  /** P3: in-world hour of each first observation, and the notebook sketches (JPEG data URLs). */
  observedH: Record<string, number>;
  sketches: Record<string, string>;
  /** P3: traces unseen visitors left behind (fade after a few hours). */
  traces: import('./RareVisitors').Trace[];
}

export class WorldMemory {
  static readonly MAX = 300;
  data: MemoryData = { v: 1, entries: [], observed: {}, names: {}, observedH: {}, sketches: {}, traces: [] };
  private saveTimer = 0;
  private listeners: (() => void)[] = [];
  /** Supplies the in-world hour at logging time. */
  hour: () => number = () => 12;
  now: () => number = () => Date.now();

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null) {
    try {
      const raw = this.storage?.getItem(KEY);
      if (raw) this.merge(JSON.parse(raw));
    } catch {
      /* storage blocked or corrupt: start a fresh diary */
    }
  }

  /** Accepts stored data, keeping only well-formed entries. */
  merge(o: unknown) {
    if (!o || typeof o !== 'object') return;
    const src = o as Partial<MemoryData>;
    if (Array.isArray(src.entries))
      this.data.entries = src.entries
        .filter((e) => e && typeof e.k === 'string' && Number.isFinite(e.t))
        .map((e) => ({ t: e.t, k: e.k, ...(Number.isFinite(e.h) ? { h: e.h } : {}), ...(e.p && typeof e.p === 'object' ? { p: e.p } : {}), ...(Number.isFinite(e.n) && e.n! > 1 ? { n: Math.round(e.n!) } : {}) }))
        .sort((a, b) => a.t - b.t);
    if (src.observed && typeof src.observed === 'object')
      for (const [k, v] of Object.entries(src.observed)) if (Number.isFinite(v)) this.data.observed[k] = v as number;
    if (src.observedH && typeof src.observedH === 'object')
      for (const [k, v] of Object.entries(src.observedH)) if (Number.isFinite(v)) this.data.observedH[k] = v as number;
    if (src.sketches && typeof src.sketches === 'object')
      for (const [k, v] of Object.entries(src.sketches)) if (typeof v === 'string' && v.startsWith('data:image/') && v.length < 60_000) this.data.sketches[k] = v;
    if (Array.isArray(src.traces))
      this.data.traces = src.traces.filter((t) => t && (t.k === 'turtleTracks' || t.k === 'cuttlebone') && Number.isFinite(t.x) && Number.isFinite(t.z) && Number.isFinite(t.until) && t.until > Date.now());
    if (src.names && typeof src.names === 'object')
      for (const [k, v] of Object.entries(src.names)) if (typeof v === 'string' && v.trim()) this.data.names[k] = v.slice(0, 40);
    this.compact();
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  /** Records something that happened. Returns the entry (new or merged). */
  log(k: string, p?: Record<string, unknown>, opts?: { hour?: number }): MemoryEntry {
    const t = this.now();
    const day = dayKey(t);
    const E = this.data.entries;
    if (MERGE.has(k)) {
      for (let i = E.length - 1; i >= 0 && dayKey(E[i].t) === day; i--) {
        const e = E[i];
        if (e.k === k && JSON.stringify(e.p ?? null) === JSON.stringify(p ?? null)) {
          if (!ONCE_A_DAY.has(k)) e.n = (e.n ?? 1) + 1;
          this.changed();
          return e;
        }
      }
    }
    const e: MemoryEntry = { t, h: Math.round((opts?.hour ?? this.hour()) * 10) / 10, k, ...(p ? { p } : {}) };
    E.push(e);
    this.compact();
    this.changed();
    return e;
  }

  /** First observation of a species / behaviour (kept once, forever). */
  observe(key: string): boolean {
    if (this.data.observed[key]) return false;
    this.data.observed[key] = this.now();
    this.data.observedH[key] = Math.round(this.hour() * 10) / 10;
    this.log('firstSeen', { sp: key });
    return true;
  }

  hasObserved(key: string) {
    return !!this.data.observed[key];
  }

  /** Oldest days fold into one-line summaries (never more than MAX lines). */
  compact() {
    const E = this.data.entries;
    while (E.length > WorldMemory.MAX) {
      // the oldest day that is not already a single summary line
      const first = dayKey(E[0].t);
      let end = 0;
      while (end < E.length && dayKey(E[end].t) === first) end++;
      if (end === 1 && E[0].k === 'summary') {
        // already folded: fold it into the next day's summary instead
        const next = E[1];
        const n = Number(E[0].p?.n ?? 1);
        E.shift();
        if (next.k === 'summary') next.p = { n: Number(next.p?.n ?? 1) + n };
        else E.unshift({ t: next.t - 1, k: 'summary', p: { n } });
        if (E.length <= WorldMemory.MAX) break;
        continue;
      }
      const n = E.slice(0, end).reduce((a, e) => a + (e.k === 'summary' ? Number(e.p?.n ?? 1) : e.n ?? 1), 0);
      E.splice(0, end, { t: E[0].t, k: 'summary', p: { n } });
    }
  }

  /** Entries grouped by day, newest day first, each day oldest → newest. */
  byDay(): { day: string; t: number; entries: MemoryEntry[] }[] {
    const out: { day: string; t: number; entries: MemoryEntry[] }[] = [];
    for (const e of this.data.entries) {
      const d = dayKey(e.t);
      const last = out[out.length - 1];
      if (last && last.day === d) last.entries.push(e);
      else out.push({ day: d, t: e.t, entries: [e] });
    }
    return out.reverse();
  }

  /** Clears the diary (only on an explicit request). */
  clear() {
    this.data = { v: 1, entries: [], observed: {}, names: this.data.names, observedH: {}, sketches: {}, traces: [] };
    this.changed();
  }

  /** Persist (also used when a name changes). */
  changed() {
    for (const l of this.listeners) l();
    if (this.saveTimer || !this.storage) return;
    const save = () => {
      this.saveTimer = 0;
      try {
        this.storage?.setItem(KEY, JSON.stringify(this.data));
      } catch {
        /* storage full / blocked: the diary lives on in memory */
      }
    };
    if (typeof window === 'undefined') save();
    else this.saveTimer = window.setTimeout(save, 800) as unknown as number;
  }
}
