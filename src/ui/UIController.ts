import type { App } from '../core/App';
import type { WaterPresetId } from '../config';
import { PRESET_LIST } from '../water/WaterColor';
import { TOOL_TAB, type BrushSettings, type ObjectMode, type PanelTab, type SandMode, type Tool } from '../interaction/ToolStateManager';
import { WorldStore } from '../platform/WorldStore';
import { PLACE_TYPES, type PlaceType } from '../world/Reef';
import { POP_LIMITS } from '../creatures/CreatureManager';
import { SEA_LEVEL_RANGE, type TideMode, type TimeMode } from '../core/EnvironmentController';
import { ICONS } from './icons';
import type { StringKey } from '../features/i18n';
import { L, T, TA, tr, trAction, uiLang, zhOf as tr2 } from './lang';

const TOOLS: Record<Tool, { en: string; zh: string; icon: string; key: string }> = {
  default: { en: 'Water', zh: '水面', icon: ICONS.water, key: '1' },
  current: { en: 'Current', zh: '水流', icon: ICONS.current, key: '2' },
  feed: { en: 'Feed', zh: '喂食', icon: ICONS.feed, key: '3' },
  bubbles: { en: 'Bubbles', zh: '气泡', icon: ICONS.bubbles, key: '4' },
  magnify: { en: 'Magnifier', zh: '放大镜', icon: ICONS.magnifier, key: '8' },
  sand: { en: 'Sand', zh: '沙子', icon: ICONS.sand, key: '5' },
  place: { en: 'Place', zh: '摆放', icon: ICONS.place, key: '6' },
  select: { en: 'Objects', zh: '物件', icon: ICONS.objects, key: '7' },
};

const SAND_MODES: { id: SandMode; en: string; zh: string; icon: string }[] = [
  { id: 'add', en: 'Add', zh: '加沙', icon: ICONS.add },
  { id: 'remove', en: 'Erase', zh: '擦除', icon: ICONS.erase },
  { id: 'smooth', en: 'Smooth', zh: '抹平', icon: ICONS.smooth },
  { id: 'island', en: 'Island', zh: '小岛', icon: ICONS.island },
];

const LIFE: { key: string; en: string; zh: string }[] = [
  { key: 'silverside', en: 'Silverside school', zh: '银汉鱼群' },
  { key: 'cardinal', en: 'Cardinalfish school', zh: '天竺鲷群' },
  { key: 'clown', en: 'Clownfish', zh: '小丑鱼' },
  { key: 'tang', en: 'Blue tang', zh: '蓝刺尾鲷' },
  { key: 'butterfly', en: 'Butterflyfish', zh: '蝴蝶鱼' },
  { key: 'angel', en: 'Angelfish', zh: '神仙鱼' },
  { key: 'jelly', en: 'Jellyfish', zh: '水母' },
  { key: 'crab', en: 'Crabs', zh: '螃蟹' },
  { key: 'hermit', en: 'Hermit crabs', zh: '寄居蟹' },
];

/** V2: the new species, grouped under Life → Extra (bilingual labels via i18n). */
const LIFE_EXTRA: { key: string; i18n: StringKey }[] = [
  { key: 'sergeant', i18n: 'pop.sergeant' },
  { key: 'parrot', i18n: 'pop.parrot' },
  { key: 'wrasse', i18n: 'pop.wrasse' },
  { key: 'lagoonCrab', i18n: 'pop.lagoonCrab' },
  { key: 'shrimp', i18n: 'pop.shrimp' },
  { key: 'urchin', i18n: 'pop.urchin' },
  { key: 'cucumber', i18n: 'pop.cucumber' },
  { key: 'gardenEel', i18n: 'pop.gardenEel' },
  { key: 'snapper', i18n: 'pop.snapper' },
  { key: 'barracuda', i18n: 'pop.barracuda' },
  { key: 'grouper', i18n: 'pop.grouper' },
];

const GEAR =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

/** Which brush sliders each tool shows, with tool-specific labels. */
function sliderSpec(tool: Tool, sand: SandMode): { key: keyof BrushSettings; label: () => string; fmt?: (v: number) => string }[] {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const depth = { key: 'depth' as const, label: () => L('Depth (front–back)', '前后深度'), fmt: (v: number) => (v < 0.2 ? L('front', '靠前') : v > 0.8 ? L('back', '靠后') : pct(v)) };
  const size = { key: 'size' as const, label: () => L('Brush size', '笔刷大小'), fmt: pct };
  switch (tool) {
    case 'current':
      return [{ key: 'amount', label: () => L('Strength', '强度'), fmt: pct }, size, depth];
    case 'feed':
      return [{ key: 'amount', label: () => L('Pellets', '食物颗粒'), fmt: (v) => String(Math.round(3 + v * 13)) }, depth];
    case 'bubbles':
      return [{ key: 'amount', label: () => L('Flow', '气泡量'), fmt: pct }, { key: 'size', label: () => L('Spread', '范围'), fmt: pct }, depth];
    case 'sand':
      if (sand === 'island') return [{ key: 'size', label: () => L('Island size', '小岛大小'), fmt: pct }, depth];
      return [{ key: 'amount', label: () => (sand === 'add' ? L('Flow rate', '出沙量') : L('Strength', '强度')), fmt: pct }, size, depth];
    case 'place':
      return [depth];
    default:
      return [];
  }
}

function hint(app: App): string {
  const top = app.cam.view === 'top';
  const where = top ? L('Click sets the exact X–Z spot.', '点击处就是放置的位置。') : L('Wheel = depth · Shift+wheel = size.', '滚轮调前后深度 · Shift+滚轮调大小。');
  switch (app.tools.tool) {
    case 'default':
      return top
        ? L('Press and drag across the surface to plough waves. Hover a creature to see what it is doing; click it to interact.', '在水面上按住拖动可以推出波浪。鼠标停在生物上可以看它在做什么，点一下和它互动。')
        : L(
            'Hover to ripple · drag to lift or press · rest on a creature to meet it, click or hold to interact.',
            '划过水面起涟漪 · 拖动把水托起或压下 · 鼠标停在生物上它会注意到你，点击或按住和它互动。',
          );
    case 'current':
      return `${L('Drag through the water to paint a current — draw a loop for a swirl. At night it lights up the plankton.', '在水里拖动画出水流，画一个圈会形成漩涡。夜里会点亮浮游生物。')} ${where}`;
    case 'feed':
      return `${L('Click over the water to drop food.', '在水面上点击投放食物。')} ${where}`;
    case 'bubbles':
      return `${L('Hold on the seabed for a rising bubble stream.', '在海底按住，冒出一串气泡。')} ${where}`;
    case 'sand':
      return `${
        {
          add: L('Hold to pour sand; higher flow = more sand.', '按住倒沙子，出沙量越大沙越多。'),
          remove: L('Erase only added sand — the original seabed is protected.', '只擦除加上去的沙，原本的海底不会被擦掉。'),
          smooth: L('Brush to soften peaks and fill small hollows.', '刷过去可以抹平沙堆、填平小坑。'),
          island: L('Click to place a sand bar; it can surface at low tide and flood at high tide.', '点击放一个小沙洲，退潮时露出水面，涨潮时被淹没。'),
        }[app.tools.sandMode]
      } ${where}`;
    case 'place': {
      const t = PLACE_TYPES.find((p) => p.id === app.tools.placeType);
      return `${L('Click open seabed to place', '点击空的海底放置')}: ${tr(t?.label ?? '')} — ${tr(t?.note ?? '')}. ${where}`;
    }
    case 'magnify':
      return L('Hover to look closer — click to pin the lens in place (it stays live), click again to unpin.', '移动鼠标凑近看，点击把放大镜固定在原处（画面仍然是动的），再点一次取消固定。');
    case 'select':
      return app.tools.objectMode === 'remove'
        ? L('Click an object to remove it (undo restores it).', '点击物件把它移除（可以撤销）。')
        : top
          ? L('Drag corals, rocks, shells, anemones or seagrass anywhere in X–Z.', '拖动珊瑚、礁石、贝壳、海葵或海草到任意位置。')
          : L('Drag objects sideways; mouse wheel while dragging moves them in depth.', '左右拖动物件，拖动时滚动滚轮可以调前后。');
  }
}

/**
 * "Ocean Studio": one place for every control. The top bar (views, drift, map, sound, journal,
 * undo / redo, settings) is always there; the body below it (Interact / Create / Life / Nature /
 * World) folds away. Every label follows the one language switch. Lightweight DOM, no framework.
 */
export class UIController {
  private root: HTMLElement;
  private panel: HTMLElement;
  private ambientBtn: HTMLButtonElement;
  private toastEl: HTMLElement;
  private tipEl: HTMLElement;
  private toastTimer = 0;
  private resetArmed = 0;
  private collapsed = false;
  private propsKey = '';

  get rootEl() {
    return this.root;
  }

  constructor(private app: App, host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'ui-root';
    this.root.innerHTML = this.template();
    host.appendChild(this.root);
    // labels of the i18n-keyed controls follow the language switch; dynamic text re-renders
    app.i18n.onChange(() => {
      this.root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((e) => (e.textContent = app.i18n.t(e.dataset.i18n as StringKey)));
      this.propsKey = '';
      this.refresh();
    });
    this.panel = this.root.querySelector('.panel')!;
    this.ambientBtn = this.root.querySelector('.ambient-exit')!;
    this.toastEl = this.root.querySelector('.toast')!;
    this.tipEl = this.root.querySelector('.tip')!;
    this.bind();
    app.tools.onChange(() => this.refresh());
    app.env.onChange(() => this.refresh());
    app.history.onChange(() => this.refresh());
    app.cam.onChange(() => this.refresh());
    this.refresh();
  }

  private toolButtons(tab: PanelTab) {
    return (Object.keys(TOOLS) as Tool[])
      .filter((t) => TOOL_TAB[t] === tab)
      .map((t) => `<button class="tool" data-tool="${t}" ${TA(`${TOOLS[t].en} (${TOOLS[t].key})`, `${TOOLS[t].zh}（${TOOLS[t].key}）`)} aria-pressed="false">${TOOLS[t].icon}${T(TOOLS[t].en, TOOLS[t].zh)}</button>`)
      .join('');
  }

  private range(attr: string, en: string, zh: string, min: number, max: number, step: number) {
    // the attr must not contain quotes inside its value (attr looks like data-env="time")
    return `<div class="prop"><div class="field-label">${T(en, zh)}<span class="value" data-out="${attr.replace(/["']/g, '')}"></span></div>
      <input class="range" type="range" min="${min}" max="${max}" step="${step}" ${attr} ${TA(en, zh)}></div>`;
  }

  private template() {
    const swatches = PRESET_LIST.map((p) =>
      p.id === 'custom'
        ? `<label class="swatch custom" data-preset="custom" ${TA(p.label, '自定义颜色')} style="background:${p.swatch}"><input type="color" value="#22b8c8"></label>`
        : `<button class="swatch" data-preset="${p.id}" ${TA(p.label, tr2(p.label))} style="background:${p.swatch}"></button>`,
    ).join('');
    const sandModes = SAND_MODES.map((m) => `<button data-sand="${m.id}" ${TA(m.en, m.zh)}>${m.icon}${T(m.en, m.zh)}</button>`).join('');
    const places = PLACE_TYPES.map((p) => `<button class="chip" data-place="${p.id}" ${TA(p.note, tr2(p.note))}>${T(p.label, tr2(p.label))}</button>`).join('');
    const life = LIFE.map((l) => this.range(`data-pop="${l.key}"`, l.en, l.zh, POP_LIMITS[l.key][0], POP_LIMITS[l.key][1], 1)).join('');
    const t = (k: StringKey) => this.app.i18n.t(k);
    const extra = LIFE_EXTRA.map(
      (l) => `<div class="prop"><div class="field-label"><span data-i18n="${l.i18n}">${t(l.i18n)}</span><span class="value" data-out="data-pop=${l.key}"></span></div>
      <input class="range" type="range" min="${POP_LIMITS[l.key][0]}" max="${POP_LIMITS[l.key][1]}" step="1" data-pop="${l.key}" aria-label="${t(l.i18n)}"></div>`,
    ).join('');
    return `
    <aside class="panel" aria-label="Ocean Studio">
      <header class="panel-bar">
        <div class="bar-row">
          <div class="bar-views" data-slot="views"></div>
          <button class="icon-btn collapse" ${TA('Show / hide the studio (H)', '展开 / 收起控制面板（H）')}>${ICONS.chevronRight}</button>
        </div>
        <div class="bar-row">
          <div class="bar-toggles" data-slot="toggles"></div>
          <i class="nav-sep"></i>
          <button class="icon-btn undo">${ICONS.undo}</button>
          <button class="icon-btn redo">${ICONS.redo}</button>
          <button class="icon-btn settings" ${TA('Settings', '设置')}>${GEAR}</button>
        </div>
      </header>
      <div class="panel-body">
        <nav class="tabs segmented five" role="tablist">
          <button data-tab="interact" role="tab">${T('Interact', '互动')}</button>
          <button data-tab="create" role="tab">${T('Create', '创作')}</button>
          <button data-tab="life" role="tab">${T('Life', '生物')}</button>
          <button data-tab="nature" role="tab">${T('Nature', '自然')}</button>
          <button data-tab="world" role="tab">${T('World', '世界')}</button>
        </nav>
        <section class="tab-page" data-page="interact"><div class="tool-grid">${this.toolButtons('interact')}</div></section>
        <section class="tab-page" data-page="create">
          <div class="tool-grid three">${this.toolButtons('create')}</div>
          <div class="segmented four sand-sub" role="group">${sandModes}</div>
          <div class="chips place-sub">${places}</div>
          <div class="segmented object-sub" role="group">
            <button data-objmode="move">${ICONS.select}${T('Move', '移动')}</button>
            <button data-objmode="remove">${ICONS.erase}${T('Remove', '移除')}</button>
          </div>
        </section>
        <section class="props"></section>
        <p class="hint"></p>
        <section class="tab-page" data-page="life">
          ${life}
          <div class="row toggles">
            <label class="switch"><input type="checkbox" data-pop-toggle="ray">${T('Stingray', '魟鱼')}</label>
            <label class="switch"><input type="checkbox" data-pop-toggle="octopus">${T('Octopus', '章鱼')}</label>
          </div>
          <details class="fold extra-life">
            <summary><span data-i18n="life.extra">${t('life.extra')}</span><small data-i18n="life.extraNote">${t('life.extraNote')}</small></summary>
            ${extra}
          </details>
          <p class="hint small">${T('New arrivals swim in from the edge; removed ones swim away. Rest the pointer on a creature to see what it is doing.', '新来的会从画面边缘游进来，减少的会自己游走。鼠标停在生物上可以看它在做什么。')}</p>
        </section>
        <section class="tab-page" data-page="nature">
          ${this.range('data-env="time"', 'Time of day', '时间', 0, 24, 0.05)}
          <div class="segmented three time-seg" role="group">
            <button data-timemode="manual">${T('Manual', '手动')}</button><button data-timemode="cycle">${T('Day cycle', '昼夜循环')}</button><button data-timemode="clock">${T('PC clock', '电脑时间')}</button>
          </div>
          ${this.range('data-env="sea"', 'Sea level', '海平面', SEA_LEVEL_RANGE[0], SEA_LEVEL_RANGE[1], 0.01)}
          <div class="segmented tide-seg" role="group">
            <button data-tidemode="manual">${T('Manual', '手动')}</button><button data-tidemode="auto">${T('Tide cycle', '潮汐循环')}</button>
          </div>
          ${this.range('data-env="wind"', 'Wind strength', '风力', 0, 100, 1)}
          ${this.range('data-env="rain"', 'Rain', '雨', 0, 100, 1)}
          <div class="field-label gap">${T('Water colour', '水的颜色')}<span class="value preset-name"></span></div>
          <div class="swatches">${swatches}</div>
        </section>
        <section class="tab-page" data-page="world">
          <div class="field-label">${T('Mode', '模式')}</div>
          <div class="segmented mode" role="group">
            <button data-mode="play">${ICONS.play}${T('Play', '互动')}</button>
            <button data-mode="ambient">${ICONS.ambient}${T('Ambient', '观赏')}</button>
          </div>
          <div class="field-label gap">${T('World', '世界存档')}<span class="value saved-at"></span></div>
          <div class="row three">
            <button class="btn save" ${TA('Save sand, objects, creatures and nature settings (restored on next start)', '保存沙子、物件、生物和自然设置（下次打开时恢复）')}>${ICONS.save}${T('Save', '保存')}</button>
            <button class="btn load" ${TA('Load the saved world', '读取保存的世界')}>${ICONS.load}${T('Load', '读取')}</button>
            <button class="btn reset" ${TA('Reset to the original diorama', '恢复成最初的样子')}>${ICONS.reset}<span class="reset-label"></span></button>
          </div>
          <div class="links"><button class="link export">${T('Export file', '导出文件')}</button><button class="link import">${T('Import file', '导入文件')}</button><input class="import-file" type="file" accept="application/json,.json" hidden></div>
        </section>
      </div>
    </aside>
    <button class="ambient-exit" ${TA('Back to Play mode (A)', '回到互动模式（A）')}>${ICONS.play}${T('Play', '互动')}</button>
    <div class="toast" role="status" aria-live="polite"></div>
    <div class="tip" aria-hidden="true"></div>`;
  }

  private q<T extends HTMLElement>(s: string) {
    return this.root.querySelector(s) as T;
  }
  private all<T extends HTMLElement>(s: string) {
    return Array.from(this.root.querySelectorAll(s)) as T[];
  }

  private bind() {
    const app = this.app;
    // clicks on the controls never reach the scene
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.all<HTMLButtonElement>('[data-tool]').forEach((b) =>
      b.addEventListener('click', () => {
        app.interaction.cancelAll();
        app.tools.setTool(b.dataset.tool as Tool);
      }),
    );
    this.all<HTMLButtonElement>('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => {
        app.interaction.cancelAll();
        app.tools.setTab(b.dataset.tab as PanelTab);
      }),
    );
    this.all<HTMLButtonElement>('[data-sand]').forEach((b) => b.addEventListener('click', () => app.tools.setSandMode(b.dataset.sand as SandMode)));
    this.all<HTMLButtonElement>('[data-place]').forEach((b) => b.addEventListener('click', () => app.tools.setPlaceType(b.dataset.place as PlaceType)));
    this.all<HTMLButtonElement>('[data-objmode]').forEach((b) => b.addEventListener('click', () => app.tools.setObjectMode(b.dataset.objmode as ObjectMode)));
    this.all<HTMLButtonElement>('button[data-preset]').forEach((b) => b.addEventListener('click', () => app.env.setPreset(b.dataset.preset as WaterPresetId)));
    const color = this.q<HTMLInputElement>('.swatch.custom input');
    color.value = app.env.customColor;
    color.addEventListener('input', () => app.env.setCustomColor(color.value));
    color.addEventListener('click', () => app.env.setCustomColor(color.value));
    // nature sliders
    this.all<HTMLInputElement>('[data-env]').forEach((inp) =>
      inp.addEventListener('input', () => {
        const v = Number(inp.value);
        switch (inp.dataset.env) {
          case 'time':
            app.env.setTime(v);
            app.env.setTimeMode('manual');
            break;
          case 'sea':
            app.env.setSeaLevel(v);
            break;
          case 'wind':
            app.env.setWind(v);
            break;
          case 'rain':
            app.env.setRain(v);
            break;
        }
      }),
    );
    this.all<HTMLButtonElement>('[data-timemode]').forEach((b) => b.addEventListener('click', () => app.env.setTimeMode(b.dataset.timemode as TimeMode)));
    this.all<HTMLButtonElement>('[data-tidemode]').forEach((b) => b.addEventListener('click', () => app.env.setTideMode(b.dataset.tidemode as TideMode)));
    // life
    this.all<HTMLInputElement>('[data-pop]').forEach((inp) =>
      inp.addEventListener('input', () => {
        app.creatures.setPopulation(inp.dataset.pop!, Number(inp.value));
        app.saveSettings();
        this.refresh();
      }),
    );
    this.all<HTMLInputElement>('[data-pop-toggle]').forEach((inp) =>
      inp.addEventListener('change', () => {
        app.creatures.setPopulation(inp.dataset.popToggle!, inp.checked ? 1 : 0);
        app.saveSettings();
        this.refresh();
      }),
    );
    this.q<HTMLButtonElement>('.undo').addEventListener('click', () => this.undo());
    this.q<HTMLButtonElement>('.redo').addEventListener('click', () => this.redo());
    this.q<HTMLButtonElement>('.settings').addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      this.openSettings();
    });
    this.q<HTMLButtonElement>('.save').addEventListener('click', () => {
      this.toast(app.saveWorld() ? L('World saved — it will be restored next time', '已保存，下次打开时会恢复') : L('Could not save (storage unavailable)', '无法保存（存储不可用）'));
      this.refresh();
    });
    this.q<HTMLButtonElement>('.load').addEventListener('click', () => this.toast(app.loadWorld() ? L('Saved world loaded', '已读取保存的世界') : L('No saved world yet', '还没有保存过')));
    this.q<HTMLButtonElement>('.export').addEventListener('click', () => WorldStore.exportFile(app));
    const file = this.q<HTMLInputElement>('.import-file');
    this.q<HTMLButtonElement>('.import').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f) {
        app.interaction.cancelAll();
        const ok = await WorldStore.importFile(app, f);
        if (ok) {
          app.history.clear();
          app.creatures.reset();
        }
        this.toast(ok ? L('World imported', '已导入') : L('That file is not a compatible world', '这个文件不是可用的世界存档'));
        this.refresh();
      }
      file.value = '';
    });
    this.q<HTMLButtonElement>('.reset').addEventListener('click', () => {
      if (performance.now() < this.resetArmed) {
        this.resetArmed = 0;
        app.resetWorld();
        this.toast(L('World reset', '已重置'));
      } else {
        this.resetArmed = performance.now() + 3000;
        this.toast(L('Click Reset again to restore the original diorama', '再点一次“重置”恢复成最初的样子'));
      }
      this.refresh();
    });
    this.all<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => app.tools.setMode(b.dataset.mode as 'play' | 'ambient')));
    this.q<HTMLButtonElement>('.collapse').addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      this.setCollapsed(!this.collapsed);
    });
    this.ambientBtn.addEventListener('click', () => app.tools.setMode('play'));
    this.q<HTMLElement>('.props').addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.brush) app.tools.setBrush({ [t.dataset.brush]: Number(t.value) / 100 } as Partial<BrushSettings>);
    });
    window.addEventListener('pointermove', (e) => {
      const near = window.innerWidth - e.clientX < 180 && window.innerHeight - e.clientY < 120;
      this.ambientBtn.classList.toggle('near', near);
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Opens the studio on World → Preferences. */
  openSettings() {
    this.app.tools.setTab('world');
    this.setCollapsed(false);
    const prefs = this.root.querySelector<HTMLDetailsElement>('details.prefs');
    if (prefs) {
      prefs.open = true;
      window.setTimeout(() => prefs.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
    }
  }

  private onKey(e: KeyboardEvent) {
    const app = this.app;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) {
      e.preventDefault();
      this.redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      this.undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'escape' && app.games.active) {
      app.games.exit();
      return;
    }
    if (k === 'escape' && app.featureUI?.noteOpen) {
      app.featureUI.closeNote();
      return;
    }
    const map: Record<string, Tool> = { '1': 'default', '2': 'current', '3': 'feed', '4': 'bubbles', '5': 'sand', '6': 'place', '7': 'select', '8': 'magnify' };
    if (map[k] && app.tools.mode === 'play' && !app.games.active) {
      app.interaction.cancelAll();
      app.tools.setTool(map[k]);
    } else if (k === 'v') app.cam.toggle();
    else if (k === 'f' && !app.games.active) app.cam.setView(app.cam.view === 'full' ? 'focus' : 'full');
    else if (k === 'n') app.env.setTime(app.env.atm.night > 0.5 ? 13 : 21.5);
    else if (k === '[' || k === ']') app.tools.setBrush({ size: app.tools.brush.size + (k === ']' ? 0.05 : -0.05) });
    else if (k === 'h' && app.tools.mode === 'play') this.setCollapsed(!this.collapsed);
    else if (k === 'a') app.tools.setMode(app.tools.mode === 'play' ? 'ambient' : 'play');
    else if (k === 'escape' && app.tools.mode === 'play') {
      app.interaction.cancelAll();
      app.tools.setTool('default');
    }
  }

  private undo() {
    if (this.app.tools.mode !== 'play') return;
    const e = this.app.undo();
    this.toast(e ? `${L('Undid', '已撤销')}: ${trAction(e.label)}` : L('Nothing to undo', '没有可以撤销的'));
  }
  private redo() {
    if (this.app.tools.mode !== 'play') return;
    const e = this.app.redo();
    this.toast(e ? `${L('Redid', '已重做')}: ${trAction(e.label)}` : L('Nothing to redo', '没有可以重做的'));
  }

  setCollapsed(c: boolean) {
    this.collapsed = c;
    this.app.saveSettings();
    this.refresh();
  }
  get isCollapsed() {
    return this.collapsed;
  }

  toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2400);
  }

  /** Creature inspector tooltip near the pointer. */
  showTip(text: string, x: number, y: number) {
    if (this.app.tools.mode !== 'play') return this.hideTip();
    this.tipEl.textContent = text;
    this.tipEl.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 16)}px)`;
    this.tipEl.classList.add('show');
  }
  hideTip() {
    this.tipEl.classList.remove('show');
  }

  private renderProps() {
    const app = this.app;
    const tab = app.tools.tab;
    const specs = tab === 'interact' || tab === 'create' ? sliderSpec(app.tools.tool, app.tools.sandMode) : [];
    const top = app.cam.view === 'top';
    const key = `${tab}|${app.tools.tool}|${app.tools.sandMode}|${top}|${uiLang()}`;
    const box = this.q<HTMLElement>('.props');
    if (key !== this.propsKey) {
      this.propsKey = key;
      box.innerHTML = specs
        .map((s) => {
          const off = s.key === 'depth' && top;
          return `<div class="prop${off ? ' disabled' : ''}">
            <div class="field-label"><span>${s.label()}</span><span class="value" data-val="${s.key}"></span></div>
            <input class="range" type="range" min="0" max="100" step="1" data-brush="${s.key}" ${off ? 'disabled' : ''} aria-label="${s.label()}">
          </div>`;
        })
        .join('');
      box.hidden = specs.length === 0;
    }
    for (const s of specs) {
      const v = app.tools.brush[s.key];
      const input = box.querySelector<HTMLInputElement>(`[data-brush="${s.key}"]`);
      if (input) {
        if (document.activeElement !== input) input.value = String(Math.round(v * 100));
        input.style.setProperty('--fill', `${v * 100}%`);
      }
      const label = box.querySelector<HTMLElement>(`[data-val="${s.key}"]`);
      if (label) label.textContent = s.key === 'depth' && top ? L('set by click', '点击决定') : s.fmt ? s.fmt(v) : '';
    }
  }

  private setRange(sel: string, value: number, min: number, max: number, text: string) {
    const inp = this.q<HTMLInputElement>(sel);
    if (!inp) return;
    if (document.activeElement !== inp) inp.value = String(value);
    inp.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`);
    const attr = sel.slice(1, -1);
    const out = this.root.querySelector(`[data-out="${attr.replace(/["']/g, '')}"]`) as HTMLElement | null;
    if (out) out.textContent = text;
  }

  refresh() {
    const app = this.app;
    const ambient = app.tools.mode === 'ambient';
    const tab = app.tools.tab;
    const top = app.cam.view === 'top';
    const env = app.env;
    this.root.classList.toggle('ambient', ambient);
    this.panel.classList.toggle('collapsed', this.collapsed);
    this.panel.classList.toggle('hidden', ambient);
    this.ambientBtn.classList.toggle('visible', ambient);
    if (ambient) this.hideTip();
    const col = this.q<HTMLButtonElement>('.collapse');
    col.classList.toggle('flipped', this.collapsed);
    this.all<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    this.all<HTMLElement>('.tab-page').forEach((p) => (p.hidden = p.dataset.page !== tab));
    this.all<HTMLButtonElement>('[data-tool]').forEach((b) => {
      const on = b.dataset.tool === app.tools.tool;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = ambient;
    });
    const sub = this.q<HTMLElement>('.sand-sub');
    sub.classList.toggle('open', app.tools.tool === 'sand');
    sub.querySelectorAll<HTMLButtonElement>('[data-sand]').forEach((b) => b.classList.toggle('active', b.dataset.sand === app.tools.sandMode));
    this.q<HTMLElement>('.place-sub').hidden = app.tools.tool !== 'place';
    this.all<HTMLButtonElement>('[data-place]').forEach((b) => b.classList.toggle('active', b.dataset.place === app.tools.placeType));
    this.q<HTMLElement>('.object-sub').hidden = app.tools.tool !== 'select';
    this.all<HTMLButtonElement>('[data-objmode]').forEach((b) => b.classList.toggle('active', b.dataset.objmode === app.tools.objectMode));
    this.renderProps();
    const hintEl = this.q<HTMLElement>('.hint');
    const toolTab = tab === 'interact' || tab === 'create';
    hintEl.textContent = toolTab ? hint(app) : '';
    hintEl.hidden = !toolTab;
    // life
    for (const l of [...LIFE, ...LIFE_EXTRA]) {
      const v = app.creatures.population[l.key];
      const [mn, mx] = POP_LIMITS[l.key];
      this.setRange(`[data-pop="${l.key}"]`, v, mn, mx, String(v));
    }
    this.all<HTMLInputElement>('[data-pop-toggle]').forEach((c) => (c.checked = app.creatures.population[c.dataset.popToggle!] > 0));
    // nature
    this.setRange('[data-env="time"]', env.timeOfDay, 0, 24, `${env.timeLabel()}${env.atm.night > 0.5 ? L(' · night', ' · 夜晚') : env.atm.dusk > 0.4 ? L(' · dusk', ' · 黄昏') : ''}`);
    this.all<HTMLButtonElement>('[data-timemode]').forEach((b) => b.classList.toggle('active', b.dataset.timemode === env.timeMode));
    this.setRange('[data-env="sea"]', env.seaLevelTarget, SEA_LEVEL_RANGE[0], SEA_LEVEL_RANGE[1], `${env.seaLevelTarget >= 0 ? '+' : ''}${env.seaLevelTarget.toFixed(2)} · ${tr(env.tideLabel())}`);
    this.all<HTMLButtonElement>('[data-tidemode]').forEach((b) => b.classList.toggle('active', b.dataset.tidemode === env.tideMode));
    this.setRange('[data-env="wind"]', env.windTarget, 0, 100, `${Math.round(env.windTarget)} · ${tr(env.windLabel())}`);
    this.setRange(
      '[data-env="rain"]',
      env.rainTarget,
      0,
      100,
      env.rainTarget < 1 ? L('Dry', '无雨') : env.rainTarget < 35 ? L('Drizzle', '小雨') : env.rainTarget < 70 ? L('Rain', '中雨') : L('Downpour', '暴雨'),
    );
    this.all<HTMLElement>('[data-preset]').forEach((b) => b.classList.toggle('active', b.dataset.preset === env.preset));
    this.q<HTMLElement>('.preset-name').textContent = tr(PRESET_LIST.find((p) => p.id === env.preset)?.label ?? '');
    // world
    const undo = this.q<HTMLButtonElement>('.undo');
    undo.disabled = !app.history.canUndo || ambient;
    undo.title = app.history.canUndo ? `${L('Undo', '撤销')} ${trAction(app.history.peekLabel() ?? '')} (Ctrl+Z)` : L('Nothing to undo', '没有可以撤销的');
    const redo = this.q<HTMLButtonElement>('.redo');
    redo.disabled = !app.history.canRedo || ambient;
    redo.title = app.history.canRedo ? `${L('Redo', '重做')} ${trAction(app.history.peekRedoLabel() ?? '')} (Ctrl+Y)` : L('Nothing to redo', '没有可以重做的');
    const savedAt = WorldStore.savedAt();
    this.q<HTMLElement>('.saved-at').textContent = savedAt
      ? `${L('saved', '已保存于')} ${new Date(savedAt).toLocaleString(uiLang() === 'zh' ? 'zh-CN' : [], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      : L('not saved yet', '还没有保存');
    this.q<HTMLButtonElement>('.load').disabled = !savedAt;
    const reset = this.q<HTMLButtonElement>('.reset');
    const armed = performance.now() < this.resetArmed;
    reset.classList.toggle('armed', armed);
    this.q<HTMLElement>('.reset-label').textContent = armed ? L('Confirm', '确认') : L('Reset', '重置');
    if (armed) window.setTimeout(() => this.refresh(), 3050);
    this.all<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === app.tools.mode));
  }
}
