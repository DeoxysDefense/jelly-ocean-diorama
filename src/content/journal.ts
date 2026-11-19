import type { Lang } from '../features/Prefs';
import { pageName } from './notebook';

/**
 * V2 Ocean Journal texts (中文 / English). The diary voice is gentle and short: a time of day,
 * then what happened — "傍晚，一只漂流瓶漂了过来。" Nothing here counts, scores or urges.
 */

type L = [zh: string, en: string];
const pick = (lang: Lang, s: L) => (lang === 'zh' ? s[0] : s[1]);

/** In-world time of day (hours 0–24) as a diary word. */
export function timeWord(hour: number, lang: Lang): string {
  const h = ((hour % 24) + 24) % 24;
  const w: L =
    h >= 5 && h < 8 ? ['清晨', 'At dawn'] : h < 11 && h >= 8 ? ['上午', 'In the morning'] : h < 13 && h >= 11 ? ['中午', 'Around noon'] : h < 17 && h >= 13 ? ['下午', 'In the afternoon'] : h < 19.5 && h >= 17 ? ['傍晚', 'In the evening'] : ['夜里', 'At night'];
  return pick(lang, w);
}

/** Day heading: 今天 / 昨天 / 前天 / 11月15日. */
export function dayLabel(ts: number, now: number, lang: Lang): string {
  const d0 = new Date(now);
  d0.setHours(0, 0, 0, 0);
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const diff = Math.round((d0.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return pick(lang, ['今天', 'Today']);
  if (diff === 1) return pick(lang, ['昨天', 'Yesterday']);
  if (diff === 2 && lang === 'zh') return '前天';
  const sameYear = d.getFullYear() === d0.getFullYear();
  if (lang === 'zh') return `${sameYear ? '' : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日`;
  return d.toLocaleDateString('en', sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Local calendar day key (groups entries by day). */
export const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// --------------------------------------------------------------------------- places

export type RegionId = 'main' | 'reef' | 'lagoon' | 'slope' | 'deep' | 'back' | 'open';

/** Where in the archipelago a point is (for gentle "where" words). */
export function regionOf(x: number, z: number): RegionId {
  if (z < -13.5 && x > -24 && x < 26) return 'back';
  if (x < -23.5) return 'lagoon';
  if (x > 37) return 'deep';
  if (x > 25.5) return 'slope';
  if (x < 1.5) return 'main';
  if (x < 21) return 'reef';
  return 'open';
}

const REGION: Record<RegionId, L> = {
  main: ['主岛旁', 'by the main island'],
  reef: ['礁区', 'on the reef'],
  lagoon: ['西边潟湖', 'in the western lagoon'],
  slope: ['东边礁坡', 'on the eastern drop-off'],
  deep: ['深海', 'in the deep water'],
  back: ['远处的后方', 'far at the back'],
  open: ['开阔的水里', 'in open water'],
};
export const regionName = (r: RegionId, lang: Lang) => pick(lang, REGION[r]);

// --------------------------------------------------------------------------- species

const SPECIES: Record<string, L> = {
  silverside: ['银汉鱼', 'silversides'],
  cardinal: ['天竺鲷', 'cardinalfish'],
  clown: ['小丑鱼', 'a clownfish'],
  tang: ['蓝倒吊', 'a blue tang'],
  butterfly: ['蝴蝶鱼', 'a butterflyfish'],
  angel: ['神仙鱼', 'an angelfish'],
  sergeant: ['军士鱼', 'sergeant majors'],
  parrot: ['鹦嘴鱼', 'a parrotfish'],
  wrasse: ['月眉鱼', 'a moon wrasse'],
  snapper: ['黄尾笛鲷', 'yellowtail snappers'],
  barracuda: ['梭鱼', 'a barracuda'],
  grouper: ['石斑鱼', 'a grouper'],
  jelly: ['海月水母', 'a moon jelly'],
  crab: ['螃蟹', 'a crab'],
  hermit: ['寄居蟹', 'a hermit crab'],
  octopus: ['章鱼', 'the octopus'],
  ray: ['蓝斑魟', 'the stingray'],
  gardenEel: ['花园鳗', 'the garden eels'],
  urchin: ['海胆', 'a sea urchin'],
  cucumber: ['海参', 'a sea cucumber'],
  shrimp: ['清洁虾', 'a cleaner shrimp'],
  turtle: ['绿海龟', 'a green sea turtle'],
  manta: ['蝠鲼', 'a manta ray'],
  dolphin: ['海豚', 'dolphins'],
  whaleShark: ['鲸鲨', 'a whale shark'],
  seahorse: ['海马', 'a seahorse'],
  cuttlefish: ['乌贼', 'a cuttlefish'],
  moray: ['海鳝', 'a moray eel'],
  flyingFish: ['飞鱼', 'flying fish'],
  fusilier: ['梅鲷', 'fusiliers'],
};

/** Visitors with a counting word, for "一只绿海龟来过". */
const VISITOR_A: Record<string, L> = {
  turtle: ['一只绿海龟', 'a green sea turtle'],
  manta: ['一只蝠鲼', 'a manta ray'],
  dolphin: ['一群海豚', 'a pod of dolphins'],
  whaleShark: ['一条鲸鲨', 'a whale shark'],
  seahorse: ['一只海马', 'a seahorse'],
  cuttlefish: ['一只乌贼', 'a cuttlefish'],
  moray: ['一条海鳝', 'a moray eel'],
  flyingFish: ['一群飞鱼', 'a school of flying fish'],
};
const PLURAL = new Set(['dolphin', 'flyingFish']);
export const speciesName = (k: string, lang: Lang) => pick(lang, SPECIES[k] ?? [k, k]);

// --------------------------------------------------------------------------- world memory

/** A diary line for a world-memory entry ("{time}，…"). `n` merges repeats within a day. */
export function memoryLine(k: string, p: Record<string, unknown> | undefined, n: number, lang: Lang): string {
  const many = n > 1;
  const zh = lang === 'zh';
  const sp = (key: unknown) => speciesName(String(key), lang);
  switch (k) {
    case 'bottleOpen':
      return zh ? '打开了一只漂流瓶，读了里面的纸条。' : 'you opened a drifting bottle and read its note.';
    case 'bottlePassed':
      return zh ? (many ? '有几只漂流瓶漂过，又悄悄漂走了。' : '一只漂流瓶漂过，又悄悄漂走了。') : many ? 'a few bottles drifted by and quietly floated away.' : 'a bottle drifted by and quietly floated away.';
    case 'coconutSea':
      return zh ? (many ? '几颗椰子落进了海里，随着浪漂了一会儿。' : '一颗椰子落进了海里，随着浪漂了一会儿。') : many ? 'a few coconuts fell into the sea and bobbed on the waves.' : 'a coconut fell into the sea and bobbed on the waves.';
    case 'event': {
      const id = String(p?.id ?? '');
      const t: Record<string, L> = {
        starfish: ['一只海星从沙里探出身来。', 'a starfish surfaced from the sand.'],
        school: ['一群过路的梅鲷游了进来，又游走了。', 'a passing school of fusiliers swam through.'],
        crabShell: ['一只螃蟹搬着一枚贝壳走了好远。', 'a crab carried a shell a long way.'],
        palmLeaf: ['椰子树落下了一片干叶子。', 'a palm let go of a dry frond.'],
        shellAshore: ['浪把一枚贝壳冲上了岸。', 'the waves washed a shell ashore.'],
      };
      return pick(lang, t[id] ?? ['海里发生了一件小事。', 'something small happened in the sea.']);
    }
    case 'rain':
      return zh ? (many ? '下了好几场大雨，海面一片朦胧。' : '下了一场大雨，海面一片朦胧。') : many ? 'heavy rain fell a few times; the sea went misty.' : 'heavy rain fell and the sea went misty.';
    case 'lowTide':
      return zh ? '退潮了，沙岛周围的滩涂露了出来。' : 'the tide went out and the flats around the sand cay dried.';
    case 'hermitSwap':
      return zh ? (many ? '寄居蟹又换了几次新家。' : '一只寄居蟹换了一个新家。') : many ? 'a hermit crab changed shells a few times.' : 'a hermit crab moved into a new shell.';
    case 'octopusInk':
      return zh ? (many ? '章鱼受了几次惊，喷了墨。' : '章鱼受了惊，喷出一团墨。') : many ? 'the octopus was startled a few times and inked.' : 'the octopus was startled and puffed some ink.';
    case 'firstSeen': {
      const key = String(p?.sp ?? '');
      if (key.startsWith('b:')) {
        const name = pageName(key, lang);
        return zh ? `第一次看到了「${name}」。` : `for the first time you saw this: ${name.charAt(0).toLowerCase() + name.slice(1)}.`;
      }
      return zh ? `第一次注意到了${sp(key)}。` : `you noticed ${sp(key)} for the first time.`;
    }
    case 'visitor': {
      const id = String(p?.id ?? '');
      const a = pick(lang, VISITOR_A[id] ?? ['一位客人', 'a visitor']);
      const pl = PLURAL.has(id);
      const trace = p?.trace === 'turtleTracks' ? (zh ? '沙滩上留下了一串爪印。' : ' It left a trail of flipper marks on the beach.') : p?.trace === 'cuttlebone' ? (zh ? '沙滩上多了一块白白的乌贼骨。' : ' A white cuttlebone washed up on the beach.') : '';
      if (p?.seen) return zh ? `${a}游了过来，你看见了${pl ? '它们' : '它'}。` : `${a} came by, and you saw ${pl ? 'them' : 'it'}.`;
      return zh ? `${a}来过。${trace}` : `${a} came by.${trace}`;
    }
    case 'game': {
      const g = String(p?.id ?? '');
      if (g === 'hide') return zh ? '和章鱼玩了一会儿捉迷藏。' : 'you played hide and seek with the octopus.';
      return zh ? '在海边打了一会儿水漂。' : 'you skipped a few stones.';
    }
    case 'reset':
      return zh ? '这片海回到了最初的样子。' : 'the sea went back to how it first was.';
    case 'summary':
      return zh ? `这一天发生了 ${Number(p?.n ?? 0)} 件小事。` : `${Number(p?.n ?? 0)} small things happened that day.`;
    default:
      return zh ? '发生了一件小事。' : 'something small happened.';
  }
}

/** First word of the line, capitalised for English when the time word is used as a prefix. */
export function memorySentence(hour: number | undefined, line: string, lang: Lang) {
  if (hour === undefined || Number.isNaN(hour)) return lang === 'zh' ? line : line.charAt(0).toUpperCase() + line.slice(1);
  return lang === 'zh' ? `${timeWord(hour, lang)}，${line}` : `${timeWord(hour, lang)}, ${line}`;
}

// --------------------------------------------------------------------------- my ocean

/** Conditions at the moment something was made — the source of its automatic name. */
export interface BirthMeta {
  /** In-world hour. */
  h: number;
  /** Rain 0..1, wind 0..1, night 0..1 at the time. */
  rain: number;
  wind: number;
  night: number;
  /** Made before the journal existed (old saves): named without a time. */
  old?: boolean;
}

const THING: Record<string, L & { verbZh?: string; verbEn?: string }> = {
  island: Object.assign(['小沙洲', 'little sandbar'] as L, { verbZh: '诞生的', verbEn: 'born' }),
  dune: Object.assign(['沙丘', 'sand dune'] as L, { verbZh: '堆起的', verbEn: 'piled up' }),
  anemone: Object.assign(['海葵', 'anemone'] as L, { verbZh: '种下的', verbEn: 'planted' }),
  cave: Object.assign(['礁洞石', 'cave rock'] as L, { verbZh: '搬来的', verbEn: 'set down' }),
  shell: Object.assign(['空贝壳', 'empty shell'] as L, { verbZh: '留在沙上的', verbEn: 'left on the sand' }),
  branching: Object.assign(['鹿角珊瑚', 'staghorn coral'] as L, { verbZh: '种下的', verbEn: 'planted' }),
  brain: Object.assign(['脑珊瑚', 'brain coral'] as L, { verbZh: '种下的', verbEn: 'planted' }),
  fan: Object.assign(['海扇', 'sea fan'] as L, { verbZh: '种下的', verbEn: 'planted' }),
  seagrass: Object.assign(['海草', 'seagrass'] as L, { verbZh: '种下的', verbEn: 'planted' }),
  rock: Object.assign(['礁石', 'reef rock'] as L, { verbZh: '放下的', verbEn: 'set down' }),
};

/** Automatic, gentle name from how and when it was made, e.g. 「雨天下午诞生的小沙洲」. */
export function creationName(kind: string, b: BirthMeta, lang: Lang): string {
  const t = THING[kind] ?? THING.rock;
  const noun = pick(lang, t);
  if (lang === 'zh') {
    if (b.old) return `从前${t.verbZh}${noun}`;
    const when = b.night > 0.6 ? (b.rain > 0.35 ? '雨夜' : '月光下') : `${b.rain > 0.35 ? '雨天' : b.wind > 0.6 ? '起风的' : ''}${timeWord(b.h, 'zh')}`;
    return `${when}${t.verbZh}${noun}`;
  }
  if (b.old) return `a ${noun} ${t.verbEn} a while ago`;
  const part = timeWord(b.h, 'en').replace(/^(At|In the|Around) /, '').toLowerCase();
  const weather = b.rain > 0.35 ? 'rainy ' : b.wind > 0.6 ? 'windy ' : '';
  if (b.night > 0.6) return `a ${noun} ${t.verbEn} ${b.rain > 0.35 ? 'one rainy night' : 'under the moon'}`;
  return `a ${noun} ${t.verbEn} one ${weather}${part === 'dawn' ? 'dawn' : part === 'noon' ? 'noon' : part}`;
}

export const JOURNAL_UI: Record<string, L> = {
  title: ['海洋日记', 'Ocean Journal'],
  memory: ['世界记忆', 'World Memory'],
  mine: ['我的海洋', 'My Ocean'],
  memoryNote: ['这片海见过的事', 'what this sea has seen'],
  mineNote: ['你在这里创造的东西', 'what you made here'],
  memoryEmpty: ['还没有什么故事。这片海会慢慢记下发生的事。', 'No stories yet. The sea will slowly write down what happens.'],
  mineEmpty: ['你还没有在这里创造什么。试试在俯视里用沙子堆一座小岛吧。', 'Nothing made here yet. Try raising a little island with the sand tool in Top View.'],
  rename: ['点一下可以改名字', 'Click to rename'],
  book: ['观察手记', 'Field Notebook'],
  bookNote: ['你亲眼见过的', 'what you have seen yourself'],
  bookEmpty: ['还没有记下什么。把鼠标在一只生物上停一会儿，或者点一点它。', 'Nothing noted yet. Rest the pointer on a creature for a moment, or click it.'],
  firstSeen: ['第一次见到', 'First seen'],
  close: ['合上日记', 'Close the journal'],
  open: ['海洋日记（J）', 'Ocean Journal (J)'],
};
export const uiText = (k: keyof typeof JOURNAL_UI, lang: Lang) => pick(lang, JOURNAL_UI[k]);
