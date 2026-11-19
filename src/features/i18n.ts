import type { Lang } from './Prefs';

/**
 * Localization for the V3 features (Ocean Mail notes, mini games, island life, preferences).
 * The rest of the UI stays English for now; new strings live here so they switch instantly.
 */
const STRINGS = {
  'mail.fact': ['海洋冷知识', 'Ocean fact'],
  'mail.fortune': ['幸运纸条', 'Fortune'],
  'mail.thought': ['给你的小纸条', 'A gentle thought'],
  'mail.from': ['来自远方的漂流瓶', 'Found in a drifting bottle'],
  'mail.close': ['收起纸条', 'Close note'],
  'mail.found': ['一只漂流瓶漂了过来……', 'A bottle is drifting by…'],
  'game.exit': ['退出', 'Exit'],
  'skip.title': ['打水漂', 'Stone Skipping'],
  'skip.help': ['按住并向后拖动瞄准，松开投出 · 滚轮调整方向', 'Press and drag back to aim, release to throw · wheel turns the throw'],
  'skip.helpTop': ['按住并向后拖动瞄准，松开投出 · 滚轮调整仰角', 'Press and drag back to aim, release to throw · wheel sets the angle'],
  'skip.skips': ['次弹跳', 'skips'],
  'skip.skip1': ['次弹跳', 'skip'],
  'skip.best': ['最佳', 'Best'],
  'skip.sank': ['扑通！直接沉下去了', 'Plop! Straight in'],
  'skip.new': ['新纪录！', 'New best!'],
  'skip.power': ['力度', 'Power'],
  'hide.title': ['章鱼捉迷藏', 'Octopus Hide & Seek'],
  'hide.counting': ['章鱼正在躲藏……', 'The octopus is hiding…'],
  'hide.find': ['找到章鱼吧', 'Find the octopus'],
  'hide.help': ['点击你认为章鱼藏着的地方 · 放大镜可以帮忙', 'Click where you think it is hiding · try the magnifier'],
  'hide.hint': ['提示', 'Hint'],
  'hide.hint1': ['它就在这片区域附近', 'It is somewhere in this area'],
  'hide.hint2': ['看，有几个小气泡……', 'Look — a few little bubbles…'],
  'hide.hint3': ['一闪而过的轮廓！', 'A quick glimpse!'],
  'hide.miss': ['不在这里……再看看', 'Not here… keep looking'],
  'hide.found': ['找到啦！', 'Found it!'],
  'hide.again': ['再玩一次', 'Play again'],
  'hide.magnifier': ['放大镜', 'Magnifier'],
  'mag.pin': ['点击固定 / 取消固定', 'Click to pin / unpin'],
  'mag.pinned': ['已固定', 'Pinned'],
  'island.next': ['下一个椰子', 'Next coconut'],
  'island.full': ['树上挂满了', 'Trees are full'],
  'island.off': ['已暂停', 'Paused'],
  'island.ripe': ['个成熟椰子', 'ripe coconuts'],
  'view.full': ['全景', 'Full'],
  'view.focus': ['近景', 'Focus'],
  'view.top': ['俯视', 'Top'],
  'view.fullTip': ['全景：看看整片群岛（F）· 双击某处推近', 'Full View: the whole archipelago (F) · double-click a spot to glide in'],
  'view.focusTip': ['近景：右键 / 中键拖动或按住空格拖动平移，方向键也可以 · 双击居中', 'Focus View: right / middle drag or Space + drag to pan, arrow keys too · double-click to centre'],
  'view.topTip': ['俯视：编辑用 · 滚轮缩放，右键 / 中键拖动平移（V）', 'Top View for editing · wheel zooms, right / middle drag pans (V)'],
  'nav.drift': ['慢慢漂移：没人操作时，镜头沿着群岛缓缓移动', 'Slow drift: when nobody is around, the view glides along the islands'],
  'nav.map': ['显示 / 隐藏小地图', 'Show / hide the mini map'],
  'nav.sound': ['环境声：海浪、礁石的细碎声响（音量在 世界 → 偏好设置）', 'Ambient sound: waves and reef crackle (volume in World → Preferences)'],
  'journal.open': ['海洋日记（J）', 'Ocean Journal (J)'],
  'life.extra': ['更多生物', 'Extra species'],
  'life.extraNote': ['潟湖与深海', 'lagoon & deep water'],
  'pop.sergeant': ['军士鱼群', 'Sergeant majors'],
  'pop.parrot': ['鹦嘴鱼', 'Parrotfish'],
  'pop.wrasse': ['月眉鱼（隆头鱼）', 'Moon wrasses'],
  'pop.lagoonCrab': ['潟湖螃蟹', 'Lagoon crabs'],
  'pop.shrimp': ['清洁虾', 'Cleaner shrimp'],
  'pop.urchin': ['海胆', 'Sea urchins'],
  'pop.cucumber': ['海参', 'Sea cucumbers'],
  'pop.gardenEel': ['花园鳗', 'Garden eels'],
  'pop.snapper': ['黄尾笛鲷群', 'Yellowtail snappers'],
  'pop.barracuda': ['梭鱼', 'Barracudas'],
  'pop.grouper': ['石斑鱼', 'Groupers'],
  'nav.mapTip': ['点一下或拖动，镜头就到那里', 'Click or drag to move the view there'],
} as const;

export type StringKey = keyof typeof STRINGS;

export class I18n {
  private listeners: (() => void)[] = [];
  constructor(public lang: Lang) {}

  t(key: StringKey): string {
    const s = STRINGS[key];
    return this.lang === 'zh' ? s[0] : s[1];
  }

  set(lang: Lang) {
    if (lang === this.lang) return;
    this.lang = lang;
    for (const l of this.listeners) l();
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }
}
