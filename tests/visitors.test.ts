import { describe, it, expect } from 'vitest';
import { VISITORS, VISIT_GAP, moonFullness, visitRate, type Conditions } from '../src/features/RareVisitors';
import { memoryLine, memorySentence } from '../src/content/journal';
import { PAGES, pageName } from '../src/content/notebook';
import { WorldMemory } from '../src/features/WorldMemory';
import { Prefs } from '../src/features/Prefs';

const base: Conditions = { hour: 12, night: 0, wind: 0.2, afterWind: false, moon: 0.5 };
const rateOf = (id: string, c: Partial<Conditions>, mode: 'off' | 'few' | 'normal' = 'normal') =>
  visitRate({ ...base, ...c }, mode).find((r) => r.def.id === id)?.rate ?? 0;

describe('Rare visitors: predictable, not random', () => {
  it('every visitor has a table entry, a notebook page and sensible numbers', () => {
    expect(VISITORS.length).toBe(8);
    for (const v of VISITORS) {
      expect(PAGES[v.id]).toBeDefined();
      expect(v.mean).toBeGreaterThanOrEqual(60);
      expect(v.stay[0]).toBeGreaterThan(0);
      expect(v.stay[1]).toBeGreaterThanOrEqual(v.stay[0]);
    }
    expect(VISIT_GAP).toBe(20 * 60);
  });

  it('preferences shape the odds', () => {
    // turtles like the late afternoon
    expect(rateOf('turtle', { hour: 17 })).toBeCloseTo(2 * rateOf('turtle', { hour: 10 }), 10);
    // mantas only at night, more around the full moon
    expect(rateOf('manta', { night: 0 })).toBe(0);
    expect(rateOf('manta', { night: 1, moon: 1 })).toBeGreaterThan(rateOf('manta', { night: 1, moon: 0 }));
    // dolphins by day, much likelier after strong wind
    expect(rateOf('dolphin', { night: 1 })).toBe(0);
    expect(rateOf('dolphin', { afterWind: true })).toBeCloseTo(5 * rateOf('dolphin', { afterWind: false }), 12);
    // flying fish need a breeze over 50
    expect(rateOf('flyingFish', { wind: 0.4 })).toBe(0);
    expect(rateOf('flyingFish', { wind: 0.7 })).toBeGreaterThan(0);
    // cuttlefish prefer dusk
    expect(rateOf('cuttlefish', { hour: 18 })).toBeGreaterThan(5 * rateOf('cuttlefish', { hour: 10 }));
  });

  it('"few" halves every rate and "off" stops them', () => {
    for (const v of VISITORS) expect(rateOf(v.id, { night: 0.6, wind: 0.8, hour: 17.5 }, 'few')).toBeCloseTo(rateOf(v.id, { night: 0.6, wind: 0.8, hour: 17.5 }) / 2, 12);
    expect(visitRate(base, 'off')).toEqual([]);
  });

  it('a typical afternoon sees a visitor every hour or so, never a crowd', () => {
    const total = visitRate({ ...base, hour: 16.5, wind: 0.3 }, 'normal').reduce((a, r) => a + r.rate, 0);
    const meanMinutes = 1 / total / 60 + VISIT_GAP / 60;
    expect(meanMinutes).toBeGreaterThan(35);
    expect(meanMinutes).toBeLessThan(80);
  });

  it('knows the moon from the real date', () => {
    expect(moonFullness(Date.UTC(2000, 0, 6, 18, 14))).toBeCloseTo(0, 3); // a new moon
    expect(moonFullness(Date.UTC(2000, 0, 21, 4, 40))).toBeGreaterThan(0.98); // the full moon after it
  });

  it('prefs keep the setting and refuse junk', () => {
    const p = new Prefs();
    p.merge({ visitors: { mode: 'few', wait: 120 } } as never);
    expect(p.data.visitors).toEqual({ mode: 'few', wait: 120 });
    p.merge({ visitors: { mode: 'lots', wait: -5 } } as never);
    expect(p.data.visitors.mode).toBe('few');
    expect(p.data.visitors.wait).toBe(0);
  });
});

describe('Not missing out', () => {
  it('an unseen visit is still remembered, with its trace; a seen one says so', () => {
    expect(memorySentence(17, memoryLine('visitor', { id: 'turtle', seen: false, trace: 'turtleTracks' }, 1, 'zh'), 'zh')).toBe('傍晚，一只绿海龟来过。沙滩上留下了一串爪印。');
    expect(memoryLine('visitor', { id: 'dolphin', seen: true }, 1, 'zh')).toBe('一群海豚游了过来，你看见了它们。');
    expect(memoryLine('visitor', { id: 'cuttlefish', seen: false, trace: 'cuttlebone' }, 1, 'en')).toBe('a cuttlefish came by. A white cuttlebone washed up on the beach.');
    expect(memoryLine('firstSeen', { sp: 'b:turtleBreath' }, 1, 'zh')).toBe('第一次看到了「海龟换气」。');
  });

  it('visits log at the hour they started, and traces survive a reload until they fade', () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const mem = new WorldMemory(s);
    mem.hour = () => 21;
    mem.log('visitor', { id: 'turtle', seen: false }, { hour: 17.2 });
    mem.data.traces.push({ k: 'turtleTracks', x: -30, z: 1, rot: 0, until: Date.now() + 3_600_000 });
    mem.data.traces.push({ k: 'cuttlebone', x: -30, z: 1, rot: 0, until: Date.now() - 1 }); // already faded
    mem.changed();
    const again = new WorldMemory(s);
    expect(again.data.entries[0].h).toBe(17.2);
    expect(again.data.traces.map((t) => t.k)).toEqual(['turtleTracks']);
  });
});

describe('Field Notebook content', () => {
  it('every page is bilingual and short', () => {
    for (const [k, p] of Object.entries(PAGES)) {
      expect(p.zh.length).toBeGreaterThan(1);
      expect(p.en.length).toBeGreaterThan(2);
      expect(/[一-鿿]/.test(p.notesZh)).toBe(true);
      expect(p.notesEn.length).toBeGreaterThan(20);
      expect(p.notesZh.length).toBeLessThan(110);
      expect(pageName(k, 'en')).toBe(p.en);
    }
  });

  it('the notebook remembers sketches and first-seen hours, and never counts pages', () => {
    const mem = new WorldMemory(null);
    mem.hour = () => 18.5;
    mem.observe('parrot');
    expect(mem.data.observedH.parrot).toBe(18.5);
    // the notebook UI only lists observed keys; there is no total anywhere in the data it reads
    expect(Object.keys(mem.data.observed)).toEqual(['parrot']);
  });
});
