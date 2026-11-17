/** Interact tools act on water and creatures; Create tools edit the world. */
import type { PlaceType } from '../world/Reef';

export type Tool = 'default' | 'current' | 'feed' | 'bubbles' | 'magnify' | 'sand' | 'select' | 'place';
export type ObjectMode = 'move' | 'remove';
export type SandMode = 'add' | 'remove' | 'smooth' | 'island';
export type AppMode = 'play' | 'ambient';
export type PanelTab = 'interact' | 'create' | 'life' | 'nature' | 'world';

export const TOOL_TAB: Record<Tool, PanelTab> = {
  default: 'interact',
  current: 'interact',
  feed: 'interact',
  bubbles: 'interact',
  magnify: 'interact',
  sand: 'create',
  select: 'create',
  place: 'create',
};

/** Brush parameters shared by Sand, Current, Feed and Bubbles (all 0..1). */
export interface BrushSettings {
  /** Flow rate / strength / quantity. */
  amount: number;
  size: number;
  /** Front View depth plane: 0 = front glass, 1 = far side. Top View ignores it (click sets x–z). */
  depth: number;
}

type Listener = () => void;

/** Single source of truth for the active tool, sub-tool, brush, panel tab and app mode. */
export class ToolStateManager {
  tool: Tool = 'default';
  sandMode: SandMode = 'add';
  mode: AppMode = 'play';
  tab: PanelTab = 'interact';
  placeType: PlaceType = 'anemone';
  objectMode: ObjectMode = 'move';
  brush: BrushSettings = { amount: 0.6, size: 0.45, depth: 0.4 };
  private listeners: Listener[] = [];

  onChange(fn: Listener) {
    this.listeners.push(fn);
  }
  emit() {
    for (const l of this.listeners) l();
  }
  setTool(t: Tool) {
    if (this.tool === t && this.tab === TOOL_TAB[t]) return;
    this.tool = t;
    this.tab = TOOL_TAB[t];
    this.emit();
  }
  setSandMode(m: SandMode) {
    this.sandMode = m;
    this.tool = 'sand';
    this.tab = 'create';
    this.emit();
  }
  setTab(t: PanelTab) {
    this.tab = t;
    if ((t === 'create' || t === 'interact') && TOOL_TAB[this.tool] !== t) this.tool = t === 'create' ? 'sand' : 'default';
    this.emit();
  }
  setPlaceType(t: PlaceType) {
    this.placeType = t;
    this.tool = 'place';
    this.tab = 'create';
    this.emit();
  }
  setObjectMode(m: ObjectMode) {
    this.objectMode = m;
    this.tool = 'select';
    this.tab = 'create';
    this.emit();
  }
  setBrush(p: Partial<BrushSettings>) {
    Object.assign(this.brush, p);
    for (const k of Object.keys(this.brush) as (keyof BrushSettings)[]) this.brush[k] = Math.max(0, Math.min(1, this.brush[k]));
    this.emit();
  }
  setMode(m: AppMode) {
    if (this.mode === m) return;
    this.mode = m;
    this.emit();
  }
}
