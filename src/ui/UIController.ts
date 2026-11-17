import type { App } from '../core/App';
import type { WaterPresetId } from '../config';
import { PRESET_LIST } from '../water/WaterColor';
import { TOOL_TAB, type BrushSettings, type ObjectMode, type PanelTab, type SandMode, type Tool } from '../interaction/ToolStateManager';
import { WorldStore } from '../platform/WorldStore';
import { PLACE_TYPES, type PlaceType } from '../world/Reef';
import { POP_LIMITS } from '../creatures/CreatureManager';
import { SEA_LEVEL_RANGE, type TideMode, type TimeMode } from '../core/EnvironmentController';
import { ICONS } from './icons';

const TOOLS: Record<Tool, { label: string; icon: string; key: string }> = {
  default: { label: 'Water', icon: ICONS.water, key: '1' },
  current: { label: 'Current', icon: ICONS.current, key: '2' },
  feed: { label: 'Feed', icon: ICONS.feed, key: '3' },
  bubbles: { label: 'Bubbles', icon: ICONS.bubbles, key: '4' },
  magnify: { label: 'Magnifier', icon: ICONS.magnifier, key: '8' },
  sand: { label: 'Sand', icon: ICONS.sand, key: '5' },
  place: { label: 'Place', icon: ICONS.place, key: '6' },
  select: { label: 'Objects', icon: ICONS.objects, key: '7' },
};

const SAND_MODES: { id: SandMode; label: string; icon: string }[] = [
  { id: 'add', label: 'Add', icon: ICONS.add },
  { id: 'remove', label: 'Erase', icon: ICONS.erase },
  { id: 'smooth', label: 'Smooth', icon: ICONS.smooth },
  { id: 'island', label: 'Island', icon: ICONS.island },
];

const LIFE: { key: string; label: string }[] = [
  { key: 'silverside', label: 'Silverside school' },
  { key: 'cardinal', label: 'Cardinalfish school' },
  { key: 'clown', label: 'Clownfish' },
  { key: 'tang', label: 'Blue tang' },
  { key: 'butterfly', label: 'Butterflyfish' },
  { key: 'angel', label: 'Angelfish' },
  { key: 'jelly', label: 'Jellyfish' },
  { key: 'crab', label: 'Crabs' },
  { key: 'hermit', label: 'Hermit crabs' },
];

/** Which brush sliders each tool shows, with tool-specific labels. */
function sliderSpec(tool: Tool, sand: SandMode): { key: keyof BrushSettings; label: string; fmt?: (v: number) => string }[] {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const depth = { key: 'depth' as const, label: 'Depth (Z)', fmt: (v: number) => (v < 0.2 ? 'front' : v > 0.8 ? 'back' : pct(v)) };
  switch (tool) {
    case 'current':
      return [{ key: 'amount', label: 'Strength', fmt: pct }, { key: 'size', label: 'Brush size', fmt: pct }, depth];
    case 'feed':
      return [{ key: 'amount', label: 'Pellets', fmt: (v) => String(Math.round(3 + v * 13)) }, depth];
    case 'bubbles':
      return [{ key: 'amount', label: 'Flow', fmt: pct }, { key: 'size', label: 'Spread', fmt: pct }, depth];
    case 'sand':
      if (sand === 'island') return [{ key: 'size', label: 'Island size', fmt: pct }, depth];
      return [{ key: 'amount', label: sand === 'add' ? 'Flow rate' : 'Strength', fmt: pct }, { key: 'size', label: 'Brush size', fmt: pct }, depth];
    case 'place':
      return [depth];
    default:
      return [];
  }
}

function hint(app: App): string {
  const top = app.cam.view === 'top';
  const where = top ? 'Click sets the exact X–Z spot.' : 'Wheel = depth · Shift+wheel = size.';
  switch (app.tools.tool) {
    case 'default':
      return top ? 'Press and drag across the surface to plough waves. Hover a creature to see what it is doing; click it to interact.' : 'Hover to ripple · drag to lift or press · hover a creature to inspect, click to interact.';
    case 'current':
      return `Drag through the water to paint a current — draw a loop for a swirl. At night it lights up the plankton. ${where}`;
    case 'feed':
      return `Click over the water to drop food. ${where}`;
    case 'bubbles':
      return `Hold on the seabed for a rising bubble stream. ${where}`;
    case 'sand':
      return {
        add: `Hold to pour sand; higher flow = more sand. ${where}`,
        remove: `Erase only added sand — the original seabed is protected. ${where}`,
        smooth: `Brush to soften peaks and fill small hollows. ${where}`,
        island: `Click to place a sand bar; it can surface at low tide and flood at high tide. ${where}`,
      }[app.tools.sandMode];
    case 'place': {
      const t = PLACE_TYPES.find((p) => p.id === app.tools.placeType);
      return `Click open seabed to place: ${t?.label} — ${t?.note}. ${where}`;
    }
    case 'magnify':
      return 'Hover to look closer — click to pin the lens in place (it stays live), click again to unpin.';
    case 'select':
      return app.tools.objectMode === 'remove'
        ? 'Click an object to remove it (undo restores it).'
        : top
          ? 'Drag corals, rocks, shells, anemones or seagrass anywhere in X–Z.'
          : 'Drag objects sideways; mouse wheel while dragging moves them in depth.';
  }
}

/**
 * "Ocean Studio" sidebar: Interact / Create / Life / Nature / World tabs, contextual tool
 * properties, Front / Top view toggle, Undo / Redo, Save / Load World, and the creature
 * inspector tooltip. Lightweight DOM, no framework.
 */
export class UIController {
  private root: HTMLElement;
  private panel: HTMLElement;
  private openBtn: HTMLButtonElement;
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
    this.panel = this.root.querySelector('.panel')!;
    this.openBtn = this.root.querySelector('.panel-open')!;
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
      .map((t) => `<button class="tool" data-tool="${t}" title="${TOOLS[t].label} (${TOOLS[t].key})" aria-pressed="false">${TOOLS[t].icon}<span>${TOOLS[t].label}</span></button>`)
      .join('');
  }

  private range(attr: string, label: string, min: number, max: number, step: number) {
    // the label key must not contain quotes (attr looks like data-env="time")
    return `<div class="prop"><div class="field-label"><span>${label}</span><span class="value" data-out="${attr.replace(/["']/g, '')}"></span></div>
      <input class="range" type="range" min="${min}" max="${max}" step="${step}" ${attr} aria-label="${label}"></div>`;
  }

  private template() {
    const swatches = PRESET_LIST.map((p) =>
      p.id === 'custom'
        ? `<label class="swatch custom" data-preset="custom" title="${p.label}" style="background:${p.swatch}"><input type="color" aria-label="Custom water colour" value="#22b8c8"></label>`
        : `<button class="swatch" data-preset="${p.id}" title="${p.label}" aria-label="${p.label}" style="background:${p.swatch}"></button>`,
    ).join('');
    const sandModes = SAND_MODES.map((m) => `<button data-sand="${m.id}" title="${m.label}">${m.icon}<span>${m.label}</span></button>`).join('');
    const places = PLACE_TYPES.map((p) => `<button class="chip" data-place="${p.id}" title="${p.note}">${p.label}</button>`).join('');
    const life = LIFE.map((l) => this.range(`data-pop="${l.key}"`, l.label, POP_LIMITS[l.key][0], POP_LIMITS[l.key][1], 1)).join('');
    return `
    <aside class="panel" aria-label="Ocean Studio">
      <header class="panel-head">
        <div class="brand">${ICONS.logo}<div><strong>Ocean Studio</strong><small class="view-name">Front view</small></div></div>
        <div class="head-actions">
          <button class="icon-btn view-toggle" title="Switch Front / Top view (V)" aria-label="Switch view"></button>
          <button class="icon-btn undo" title="Undo (Ctrl+Z)" aria-label="Undo">${ICONS.undo}</button>
          <button class="icon-btn redo" title="Redo (Ctrl+Y)" aria-label="Redo">${ICONS.redo}</button>
          <button class="icon-btn collapse" title="Hide panel (H)" aria-label="Hide panel">${ICONS.chevronRight}</button>
        </div>
      </header>
      <nav class="tabs segmented five" role="tablist">
        <button data-tab="interact" role="tab">Interact</button>
        <button data-tab="create" role="tab">Create</button>
        <button data-tab="life" role="tab">Life</button>
        <button data-tab="nature" role="tab">Nature</button>
        <button data-tab="world" role="tab">World</button>
      </nav>
      <section class="tab-page" data-page="interact"><div class="tool-grid">${this.toolButtons('interact')}</div></section>
      <section class="tab-page" data-page="create">
        <div class="tool-grid three">${this.toolButtons('create')}</div>
        <div class="segmented four sand-sub" role="group" aria-label="Sand tool">${sandModes}</div>
        <div class="chips place-sub">${places}</div>
        <div class="segmented object-sub" role="group" aria-label="Objects">
          <button data-objmode="move">${ICONS.select}<span>Move</span></button>
          <button data-objmode="remove">${ICONS.erase}<span>Remove</span></button>
        </div>
      </section>
      <section class="props"></section>
      <p class="hint"></p>
      <section class="tab-page" data-page="life">
        ${life}
        <div class="row toggles">
          <label class="switch"><input type="checkbox" data-pop-toggle="ray"><span>Stingray</span></label>
          <label class="switch"><input type="checkbox" data-pop-toggle="octopus"><span>Octopus</span></label>
        </div>
        <p class="hint small">New arrivals swim in from the edge; removed ones swim away. Hover a creature to see its mood.</p>
      </section>
      <section class="tab-page" data-page="nature">
        ${this.range('data-env="time"', 'Time of day', 0, 24, 0.05)}
        <div class="segmented three time-seg" role="group" aria-label="Time mode">
          <button data-timemode="manual">Manual</button><button data-timemode="cycle">Day cycle</button><button data-timemode="clock">PC clock</button>
        </div>
        ${this.range('data-env="sea"', 'Sea level', SEA_LEVEL_RANGE[0], SEA_LEVEL_RANGE[1], 0.01)}
        <div class="segmented tide-seg" role="group" aria-label="Tide mode">
          <button data-tidemode="manual">Manual</button><button data-tidemode="auto">Tide cycle</button>
        </div>
        ${this.range('data-env="wind"', 'Wind strength', 0, 100, 1)}
        ${this.range('data-env="rain"', 'Rain', 0, 100, 1)}
        <div class="field-label gap"><span>Water color</span><span class="value preset-name"></span></div>
        <div class="swatches">${swatches}</div>
      </section>
      <section class="tab-page" data-page="world">
        <div class="field-label"><span>Camera & mode</span></div>
        <div class="segmented view-seg" role="group" aria-label="Camera view">
          <button data-view="front">${ICONS.viewFront}<span>Front</span></button>
          <button data-view="top">${ICONS.viewTop}<span>Top</span></button>
        </div>
        <div class="segmented mode" role="group" aria-label="Mode">
          <button data-mode="play">${ICONS.play}<span>Play</span></button>
          <button data-mode="ambient">${ICONS.ambient}<span>Ambient</span></button>
        </div>
        <div class="field-label gap"><span>World</span><span class="value saved-at"></span></div>
        <div class="row three">
          <button class="btn save" title="Save sand, objects, creatures and nature settings (restored on next start)">${ICONS.save}<span>Save</span></button>
          <button class="btn load" title="Load the saved world">${ICONS.load}<span>Load</span></button>
          <button class="btn reset" title="Reset to the original diorama">${ICONS.reset}<span>Reset</span></button>
        </div>
        <div class="links"><button class="link export">Export file</button><button class="link import">Import file</button><input class="import-file" type="file" accept="application/json,.json" hidden></div>
      </section>
    </aside>
    <button class="panel-open" title="Show controls (H)" aria-label="Show controls">${ICONS.sliders}</button>
    <button class="ambient-exit" title="Back to Play mode (A)">${ICONS.play}<span>Play</span></button>
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
    this.q<HTMLButtonElement>('.view-toggle').addEventListener('click', () => app.cam.toggle());
    this.all<HTMLButtonElement>('[data-view]').forEach((b) => b.addEventListener('click', () => app.cam.setView(b.dataset.view as 'front' | 'top')));
    this.q<HTMLButtonElement>('.save').addEventListener('click', () => {
      this.toast(app.saveWorld() ? 'World saved — it will be restored next time' : 'Could not save (storage unavailable)');
      this.refresh();
    });
    this.q<HTMLButtonElement>('.load').addEventListener('click', () => this.toast(app.loadWorld() ? 'Saved world loaded' : 'No saved world yet'));
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
        this.toast(ok ? 'World imported' : 'That file is not a compatible world');
        this.refresh();
      }
      file.value = '';
    });
    this.q<HTMLButtonElement>('.reset').addEventListener('click', () => {
      if (performance.now() < this.resetArmed) {
        this.resetArmed = 0;
        app.resetWorld();
        this.toast('World reset');
      } else {
        this.resetArmed = performance.now() + 3000;
        this.toast('Click Reset again to restore the original diorama');
      }
      this.refresh();
    });
    this.all<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => app.tools.setMode(b.dataset.mode as 'play' | 'ambient')));
    this.q<HTMLButtonElement>('.collapse').addEventListener('click', () => this.setCollapsed(true));
    this.openBtn.addEventListener('click', () => this.setCollapsed(false));
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
    this.toast(e ? `Undid: ${e.label}` : 'Nothing to undo');
  }
  private redo() {
    if (this.app.tools.mode !== 'play') return;
    const e = this.app.redo();
    this.toast(e ? `Redid: ${e.label}` : 'Nothing to redo');
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
    const key = `${tab}|${app.tools.tool}|${app.tools.sandMode}|${top}`;
    const box = this.q<HTMLElement>('.props');
    if (key !== this.propsKey) {
      this.propsKey = key;
      box.innerHTML = specs
        .map((s) => {
          const off = s.key === 'depth' && top;
          return `<div class="prop${off ? ' disabled' : ''}">
            <div class="field-label"><span>${s.label}</span><span class="value" data-val="${s.key}"></span></div>
            <input class="range" type="range" min="0" max="100" step="1" data-brush="${s.key}" ${off ? 'disabled' : ''} aria-label="${s.label}">
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
      if (label) label.textContent = s.key === 'depth' && top ? 'set by click' : s.fmt ? s.fmt(v) : '';
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
    this.panel.classList.toggle('collapsed', this.collapsed || ambient);
    this.openBtn.classList.toggle('visible', this.collapsed && !ambient);
    this.ambientBtn.classList.toggle('visible', ambient);
    if (ambient) this.hideTip();
    this.q<HTMLElement>('.view-name').textContent = top ? 'Top view · editing' : 'Front view';
    const vt = this.q<HTMLButtonElement>('.view-toggle');
    vt.innerHTML = top ? ICONS.viewFront : ICONS.viewTop;
    vt.title = top ? 'Back to Front view (V)' : 'Top view for editing (V)';
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
    for (const l of LIFE) {
      const v = app.creatures.population[l.key];
      const [mn, mx] = POP_LIMITS[l.key];
      this.setRange(`[data-pop="${l.key}"]`, v, mn, mx, String(v));
    }
    this.all<HTMLInputElement>('[data-pop-toggle]').forEach((c) => (c.checked = app.creatures.population[c.dataset.popToggle!] > 0));
    // nature
    this.setRange('[data-env="time"]', env.timeOfDay, 0, 24, `${env.timeLabel()}${env.atm.night > 0.5 ? ' · night' : env.atm.dusk > 0.4 ? ' · dusk' : ''}`);
    this.all<HTMLButtonElement>('[data-timemode]').forEach((b) => b.classList.toggle('active', b.dataset.timemode === env.timeMode));
    this.setRange('[data-env="sea"]', env.seaLevelTarget, SEA_LEVEL_RANGE[0], SEA_LEVEL_RANGE[1], `${env.seaLevelTarget >= 0 ? '+' : ''}${env.seaLevelTarget.toFixed(2)} · ${env.tideLabel()}`);
    this.all<HTMLButtonElement>('[data-tidemode]').forEach((b) => b.classList.toggle('active', b.dataset.tidemode === env.tideMode));
    this.setRange('[data-env="wind"]', env.windTarget, 0, 100, `${Math.round(env.windTarget)} · ${env.windLabel()}`);
    this.setRange('[data-env="rain"]', env.rainTarget, 0, 100, env.rainTarget < 1 ? 'Dry' : env.rainTarget < 35 ? 'Drizzle' : env.rainTarget < 70 ? 'Rain' : 'Downpour');
    this.all<HTMLElement>('[data-preset]').forEach((b) => b.classList.toggle('active', b.dataset.preset === env.preset));
    this.q<HTMLElement>('.preset-name').textContent = PRESET_LIST.find((p) => p.id === env.preset)?.label ?? '';
    // world
    this.all<HTMLButtonElement>('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === app.cam.view));
    const undo = this.q<HTMLButtonElement>('.undo');
    undo.disabled = !app.history.canUndo || ambient;
    undo.title = app.history.canUndo ? `Undo ${app.history.peekLabel()} (Ctrl+Z)` : 'Nothing to undo';
    const redo = this.q<HTMLButtonElement>('.redo');
    redo.disabled = !app.history.canRedo || ambient;
    redo.title = app.history.canRedo ? `Redo ${app.history.peekRedoLabel()} (Ctrl+Y)` : 'Nothing to redo';
    const savedAt = WorldStore.savedAt();
    this.q<HTMLElement>('.saved-at').textContent = savedAt
      ? `saved ${new Date(savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      : 'not saved yet';
    this.q<HTMLButtonElement>('.load').disabled = !savedAt;
    const reset = this.q<HTMLButtonElement>('.reset');
    const armed = performance.now() < this.resetArmed;
    reset.classList.toggle('armed', armed);
    reset.querySelector('span')!.textContent = armed ? 'Confirm' : 'Reset';
    if (armed) window.setTimeout(() => this.refresh(), 3050);
    this.all<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === app.tools.mode));
  }
}
