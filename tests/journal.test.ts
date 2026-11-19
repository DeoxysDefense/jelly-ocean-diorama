import { describe, it, expect } from 'vitest';
import { WorldMemory } from '../src/features/WorldMemory';
import { Creations } from '../src/features/Creations';
import { creationName, memoryLine, memorySentence, dayLabel, regionOf } from '../src/content/journal';
import { TerrainSystem } from '../src/world/TerrainSystem';
import { Reef } from '../src/world/Reef';
import { HistoryManager } from '../src/interaction/HistoryManager';
import { decodeGrid, SAVE_VERSION } from '../src/platform/WorldStore';

/** In-memory storage stand-in. */
function store() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('World Memory', () => {
  it('merges small repeats within a day, keeps first observations once, survives a reload', () => {
    const s = store();
    const mem = new WorldMemory(s);
    let t = Date.UTC(2026, 10, 17, 10);
    mem.now = () => t;
    mem.hour = () => 17.5;
    mem.log('coconutSea');
    mem.log('coconutSea');
    mem.log('bottleOpen');
    mem.log('lowTide');
    mem.log('lowTide'); // once a day
    expect(mem.observe('parrot')).toBe(true);
    expect(mem.observe('parrot')).toBe(false);
    const day = mem.byDay()[0].entries;
    expect(day.map((e) => e.k)).toEqual(['coconutSea', 'bottleOpen', 'lowTide', 'firstSeen']);
    expect(day[0].n).toBe(2);
    expect(day[2].n).toBeUndefined();
    // the next day starts a new line
    t += 86_400_000;
    mem.log('coconutSea');
    expect(mem.byDay()[0].entries[0].n).toBeUndefined();
    // reload from storage (saved synchronously outside the browser)
    const again = new WorldMemory(s);
    expect(again.data.entries.length).toBe(5);
    expect(again.hasObserved('parrot')).toBe(true);
  });

  it('folds the oldest days into summaries and never exceeds the cap', () => {
    const mem = new WorldMemory(null);
    let t = Date.UTC(2026, 0, 1, 12);
    mem.now = () => t;
    for (let d = 0; d < 120; d++) {
      for (let i = 0; i < 4; i++) mem.log('event', { id: ['starfish', 'school', 'crabShell', 'palmLeaf'][i] });
      t += 86_400_000;
    }
    expect(mem.data.entries.length).toBeLessThanOrEqual(WorldMemory.MAX);
    const first = mem.data.entries[0];
    expect(first.k).toBe('summary');
    // nothing is lost in the count: summaries + remaining lines = everything logged
    const total = mem.data.entries.reduce((a, e) => a + (e.k === 'summary' ? Number(e.p!.n) : e.n ?? 1), 0);
    expect(total).toBe(480);
  });

  it('reads like a diary in both languages', () => {
    expect(memorySentence(17.5, memoryLine('bottlePassed', undefined, 1, 'zh'), 'zh')).toBe('傍晚，一只漂流瓶漂过，又悄悄漂走了。');
    expect(memorySentence(9, memoryLine('firstSeen', { sp: 'parrot' }, 1, 'en'), 'en')).toBe('In the morning, you noticed a parrotfish for the first time.');
    expect(memoryLine('coconutSea', undefined, 3, 'zh')).toContain('几颗');
    const now = Date.UTC(2026, 10, 17, 12);
    expect(dayLabel(now, now, 'zh')).toBe('今天');
    expect(dayLabel(now - 86_400_000, now, 'en')).toBe('Yesterday');
  });
});

describe('My Ocean (derived from the world as it is)', () => {
  const setup = () => {
    const terrain = new TerrainSystem();
    const reef = new Reef(terrain);
    const c = new Creations(terrain, reef);
    c.conditions = () => ({ h: 15, rain: 0.6, wind: 0.2, night: 0 });
    const history = new HistoryManager({
      snapshotSediment: () => terrain.snapshot(),
      restoreSediment: (s) => terrain.restore(s),
      restoreObject: () => {},
      attach: (sel) => reef.attach(sel),
      detach: (sel) => reef.detach(sel),
    });
    return { terrain, reef, c, history };
  };

  it('names things by how and when they were made', () => {
    expect(creationName('island', { h: 15, rain: 0.6, wind: 0, night: 0 }, 'zh')).toBe('雨天下午诞生的小沙洲');
    expect(creationName('dune', { h: 18, rain: 0, wind: 0.8, night: 0 }, 'zh')).toBe('起风的傍晚堆起的沙丘');
    expect(creationName('branching', { h: 22, rain: 0, wind: 0, night: 0.9 }, 'zh')).toBe('月光下种下的鹿角珊瑚');
    expect(creationName('island', { h: 15, rain: 0.6, wind: 0, night: 0 }, 'en')).toBe('a little sandbar born one rainy afternoon');
    expect(creationName('island', { h: 12, rain: 0, wind: 0, night: 0, old: true }, 'zh')).toBe('从前诞生的小沙洲');
    expect(regionOf(-35, 0)).toBe('lagoon');
    expect(regionOf(45, -5)).toBe('deep');
  });

  it('Undo / Redo / Reset keep the list consistent without any log', () => {
    const { terrain, reef, c, history } = setup();
    const before = terrain.snapshot();
    terrain.stampIsland(-31, 3, 2.5);
    history.push({ kind: 'sediment', label: 'Island stamp', before });
    c.addIsland(-31, 3, 2.5);
    expect(c.list('zh').map((i) => i.kind)).toEqual(['island']);
    expect(c.list('zh')[0].name).toBe('雨天下午诞生的小沙洲');
    history.undo();
    expect(c.list('zh')).toEqual([]);
    history.redo();
    expect(c.list('zh').length).toBe(1);
    // a placed coral is listed while it exists (Undo of the placement removes it)
    const sel = reef.createObject('branching', 10, 2);
    c.stamp(sel);
    history.push({ kind: 'add', label: 'Place', sel });
    expect(c.list('en').map((i) => i.kind).sort()).toEqual(['branching', 'island']);
    history.undo();
    expect(c.list('en').map((i) => i.kind)).toEqual(['island']);
    // Reset World: sand cleared, records cleared
    terrain.clearSediment();
    c.clear();
    expect(c.list('en')).toEqual([]);
  });

  it('stamping where an undone island was makes a new island; stamping on a living one grows it', () => {
    const { terrain, c } = setup();
    const before = terrain.snapshot();
    terrain.stampIsland(-31, 3, 2.5);
    const a = c.addIsland(-31, 3, 2.5);
    terrain.stampIsland(-30.5, 3.2, 3);
    expect(c.addIsland(-30.5, 3.2, 3)).toBe(a); // grew
    terrain.restore(before); // undone
    let now = a.bornAt + 1000;
    c.now = () => now++;
    c.pruneAt(-31, 3, 2.5); // (the app prunes right before stamping)
    terrain.stampIsland(-31, 3, 2.5);
    const b = c.addIsland(-31, 3, 2.5);
    expect(b).not.toBe(a);
    expect(c.land.length).toBe(1);
  });

  it('renames stick, and save / load round-trips the records', () => {
    const { terrain, reef, c } = setup();
    terrain.stampIsland(-31, 3, 2.5);
    c.addIsland(-31, 3, 2.5);
    c.list('zh')[0].rename('  小月亮岛  ');
    expect(c.list('zh')[0].name).toBe('小月亮岛');
    expect(c.list('zh')[0].custom).toBe(true);
    c.list('zh')[0].rename('');
    expect(c.list('zh')[0].custom).toBe(false);
    const saved = JSON.parse(JSON.stringify(c.serialize()));
    const c2 = new Creations(terrain, reef);
    c2.apply(saved);
    expect(c2.list('zh').length).toBe(1);
    expect(c2.list('zh')[0].name).toBe('雨天下午诞生的小沙洲');
    // corrupt records are ignored
    c2.apply({ land: [{ kind: 'castle', x: 1 } as never, null as never] });
    expect(c2.land.length).toBe(0);
  });

  it('older saves: stamped islands are recovered from the compacted sand ("from before")', () => {
    const { terrain, c } = setup();
    terrain.stampIsland(-31, 3, 2.5);
    terrain.stampIsland(10, -2, 2);
    c.recoverIslands(Date.UTC(2026, 0, 1));
    const list = c.list('zh');
    expect(list.length).toBe(2);
    expect(list.every((i) => i.name === '从前诞生的小沙洲')).toBe(true);
    expect(SAVE_VERSION).toBe(5);
    expect(decodeGrid({ version: 5, savedAt: '', grid: [4, 3], box: [0, -1, 0, -1], sediment: '', objects: [], env: { preset: 'tropical', customColor: '#22b8c8', wind: 25 } })).not.toBeNull();
  });
});
