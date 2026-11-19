import type { Lang } from '../features/Prefs';

/**
 * One language for the whole interface. Static markup is written with `T(en, zh)` (a span that
 * carries both texts) and `TA(en, zh)` (title / aria-label); `applyLang()` re-labels everything in
 * place when the language changes, so no panel needs rebuilding. Dynamic text uses `L(en, zh)`.
 */
let current: Lang = 'zh';

export const uiLang = () => current;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The string for the current language. */
export const L = (en: string, zh: string) => (current === 'zh' ? zh : en);

/** A text span that follows the language switch. */
export const T = (en: string, zh: string) => `<span data-en="${esc(en)}" data-zh="${esc(zh)}">${esc(L(en, zh))}</span>`;

/** title + aria-label attributes that follow the language switch. */
export const TA = (en: string, zh: string) => {
  const t = esc(L(en, zh));
  return `title="${t}" aria-label="${t}" data-en-title="${esc(en)}" data-zh-title="${esc(zh)}"`;
};

/** Switches the language and re-labels every `T` / `TA` element under `root`. */
export function setUiLang(lang: Lang, root: ParentNode = document) {
  current = lang;
  root.querySelectorAll<HTMLElement>('[data-en]').forEach((e) => {
    e.textContent = (lang === 'zh' ? e.dataset.zh : e.dataset.en) ?? '';
  });
  root.querySelectorAll<HTMLElement>('[data-en-title]').forEach((e) => {
    const t = (lang === 'zh' ? e.dataset.zhTitle : e.dataset.enTitle) ?? '';
    e.title = t;
    e.setAttribute('aria-label', t);
  });
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
}

/** Translations of short English texts produced by the simulation (labels, moods, names). */
const ZH: Record<string, string> = {
  // water colours
  'Tropical Turquoise': '热带碧绿',
  'Lagoon Blue': '泻湖蓝',
  'Deep Ocean Blue': '深海蓝',
  'Sea Glass Green': '海玻璃绿',
  'Warm Sunset': '暖色黄昏',
  'Custom Color': '自定义颜色',
  // placeable things
  Anemone: '海葵',
  'Clownfish may move in': '小丑鱼可能会搬进来',
  'Cave rock': '洞穴礁石',
  'The octopus may adopt it': '章鱼可能把它当家',
  'Empty shell': '空贝壳',
  'Hermit crabs may switch': '寄居蟹可能会换壳',
  Staghorn: '鹿角珊瑚',
  'Branching coral': '分枝状珊瑚',
  'Brain coral': '脑珊瑚',
  'Massive coral': '块状珊瑚',
  'Sea fan': '海扇',
  'Sways in the current': '随水流摇摆',
  Seagrass: '海草',
  'Fish swim through it': '鱼会从中穿过',
  Rock: '礁石',
  'Reef rock': '礁石',
  // weather words
  Calm: '无风',
  'Light breeze': '微风',
  Breezy: '和风',
  Windy: '大风',
  Strong: '强风',
  'Low tide': '低潮',
  Ebbing: '退潮中',
  'Mid tide': '平潮',
  Rising: '涨潮中',
  'High tide': '高潮',
  // undo / redo labels
  'Add sand': '加沙',
  'Erase sand': '擦除沙子',
  'Smooth sand': '抹平沙子',
  'Island stamp': '盖小岛',
  'Move object': '移动物件',
  'Remove object': '移除物件',
  'Place object': '摆放物件',
  // creature moods (hover inspector)
  Leaving: '正要离开',
  Startled: '受了惊吓',
  'Noticed food': '发现了食物',
  'Hungry · feeding': '饿了 · 在吃东西',
  Resting: '在休息',
  Curious: '好奇地看着你',
  'Moved into a new anemone': '搬进了新的海葵',
  'Guarding its anemone': '守着自己的海葵',
  'Wandering off': '游到别处去了',
  'Schooling slowly (night)': '夜里慢慢结群游',
  Hungry: '饿了',
  Schooling: '结群游动',
  Cruising: '悠闲地游',
  'Lying in wait': '埋伏中',
  Hunting: '在捕猎',
  'glowing softly': '微微发光',
  drifting: '随水漂浮',
  'Picking at the sand': '在沙里找吃的',
  Scuttling: '横着走',
  'Heading for food': '朝食物走去',
  Eating: '在吃东西',
  Fleeing: '在逃跑',
  'Claws up!': '举起了钳子！',
  Digging: '在挖沙',
  'Exploring the tide line': '在潮水线边转悠',
  'Buried in the sand': '把自己埋进了沙里',
  'Ambling about': '慢慢溜达',
  'Taking a rest': '歇一会儿',
  'Hiding in its shell': '缩进了壳里',
  'House-hunting': '在找新房子',
  'Inspecting a shell': '在检查一个贝壳',
  'Moving into a new shell!': '正在搬进新壳！',
  'Hiding in its cave': '躲在洞里',
  'Hiding in the den': '躲在窝里',
  'Peeking out': '探出头来',
  'Checking out a new cave': '在看一个新洞',
  Crawling: '在爬',
  Exploring: '在探索',
  'Buried in the sand (camouflaged)': '埋在沙里伪装',
  'Retreating!': '在撤退！',
  'Out of view': '在画面外',
  Gliding: '滑翔',
  'swaying in the current': '随水流摇摆',
  'hiding in their burrows': '缩在洞里',
  'resting in a crevice': '在石缝里休息',
  'grazing algae (night)': '夜里啃藻类',
  'crawling slowly': '慢慢爬',
  resting: '在休息',
  'sifting the sand': '在筛沙子',
  hopping: '一跳一跳',
  'waiting for a fish to clean': '等鱼来做清洁',
  'nibbling seagrass': '在啃海草',
  'up for a breath': '浮上去换气',
  'swimming away': '游走了',
  'cruising slowly': '慢慢游',
  somersaulting: '在翻跟头',
  gliding: '在滑翔',
  'playing far out': '在远处嬉戏',
  'passing far behind': '从远处游过',
  'holding on to the seagrass': '抓着海草',
  'flashing waves of colour': '身上流过一阵阵花纹',
  hovering: '悬停着',
  'breathing at its crevice': '在石缝口呼吸',
  'peeking out': '探出头来',
  'gliding over the waves': '贴着浪面滑翔',
  'a visiting school': '来访的鱼群',
};

/** A label in the current language (English labels without a translation stay as they are). */
export const tr = (en: string) => (current === 'zh' ? (ZH[en] ?? en) : en);

/** An undo / redo label ("Place Staghorn", "Add sand") in the current language. */
export function trAction(label: string) {
  if (current !== 'zh') return label;
  const m = /^(Place|Move|Remove) (.+)$/.exec(label);
  if (m) return ({ Place: '摆放', Move: '移动', Remove: '移除' } as Record<string, string>)[m[1]] + tr(m[2]);
  return tr(label);
}

/** The Chinese of a fixed English label, whatever the current language (for `T(en, zhOf(en))`). */
export const zhOf = (en: string) => ZH[en] ?? en;
