import * as THREE from 'three';
import type { App } from '../core/App';
import type { Tool } from '../interaction/ToolStateManager';
import { StoneSkippingGame } from './StoneSkipping';
import { OctopusHideSeekGame } from './HideSeek';
import type { StringKey } from './i18n';

export type GameId = 'skip' | 'hide';

/** What a mini game gets: input in normalised device coords + CSS pixels. */
export interface MiniGame {
  readonly id: GameId;
  start(): void;
  update(dt: number, time: number): void;
  pointerDown(ndc: THREE.Vector2, px: THREE.Vector2): void;
  pointerMove(ndc: THREE.Vector2, px: THREE.Vector2): void;
  pointerUp(ndc: THREE.Vector2, px: THREE.Vector2): void;
  wheel(delta: number): void;
  /** Re-renders HUD text (language switch). */
  refresh(): void;
  exit(): void;
}

export interface HudButton {
  id: string;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * Mini Activities host. Owns the active game (at most one), the small HUD pill at the top of
 * the screen, and the input priority: while a game runs it receives every pointer event on the
 * canvas, so a throw can never also drag the water, pour sand or select a coral. Exiting
 * (Esc / Exit) restores the previous tool and magnifier state and never touches the world.
 */
export class MiniGameManager {
  active: MiniGame | null = null;
  private prevTool: Tool = 'default';
  private prevMagnifier = false;
  private hud: HTMLElement;
  private titleEl: HTMLElement;
  private statusEl: HTMLElement;
  private subEl: HTMLElement;
  private btnEl: HTMLElement;
  private flashEl: HTMLElement;
  private flashT = 0;

  constructor(private app: App, host: HTMLElement) {
    this.hud = document.createElement('div');
    this.hud.className = 'game-hud';
    this.hud.innerHTML = `<div class="gh-main"><strong class="gh-title"></strong><span class="gh-status"></span></div><div class="gh-sub"></div><div class="gh-btns"></div>`;
    host.appendChild(this.hud);
    this.titleEl = this.hud.querySelector('.gh-title')!;
    this.statusEl = this.hud.querySelector('.gh-status')!;
    this.subEl = this.hud.querySelector('.gh-sub')!;
    this.btnEl = this.hud.querySelector('.gh-btns')!;
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'game-flash';
    host.appendChild(this.flashEl);
    app.i18n.onChange(() => this.active?.refresh());
  }

  t(k: StringKey) {
    return this.app.i18n.t(k);
  }

  start(id: GameId) {
    const app = this.app;
    if (this.active) this.exit();
    if (app.tools.mode !== 'play') app.tools.setMode('play');
    app.interaction.cancelAll();
    this.prevTool = app.tools.tool;
    this.prevMagnifier = app.magnifier.setGame(false);
    app.magnifier.setGame(this.prevMagnifier);
    if (app.tools.tool === 'magnify') app.tools.setTool('default');
    this.active = id === 'skip' ? new StoneSkippingGame(app, this) : new OctopusHideSeekGame(app, this);
    this.hud.classList.add('show');
    this.active.start();
    app.ui?.hideTip();
    app.featureUI?.refresh();
  }

  exit() {
    const g = this.active;
    if (!g) return;
    g.exit();
    this.active = null;
    this.hud.classList.remove('show');
    this.flashEl.classList.remove('show');
    const app = this.app;
    app.magnifier.setGame(this.prevMagnifier);
    app.magnifier.unpin();
    app.tools.setTool(this.prevTool);
    app.featureUI?.refresh();
  }

  // ---------------------------------------------------------------- HUD API for games
  setHud(title: string, status: string, sub: string, buttons: HudButton[]) {
    this.titleEl.textContent = title;
    this.statusEl.textContent = status;
    this.subEl.textContent = sub;
    this.subEl.hidden = !sub;
    this.btnEl.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = `gh-btn${b.primary ? ' primary' : ''}`;
      el.textContent = b.label;
      el.disabled = !!b.disabled;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        b.onClick();
      });
      this.btnEl.appendChild(el);
    }
  }
  setStatus(status: string) {
    this.statusEl.textContent = status;
  }
  setSub(sub: string) {
    this.subEl.textContent = sub;
    this.subEl.hidden = !sub;
  }
  /** Big soft centred text (e.g. "3 skips!"), fades by itself. */
  flash(text: string, seconds = 1.8) {
    this.flashEl.textContent = text;
    this.flashEl.classList.remove('show');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('show');
    this.flashT = seconds;
  }

  update(dt: number, time: number) {
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flashEl.classList.remove('show');
    }
    this.active?.update(dt, time);
  }
}
