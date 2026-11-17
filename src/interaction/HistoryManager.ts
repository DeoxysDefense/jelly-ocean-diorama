import * as THREE from 'three';
import type { Selectable } from '../world/Reef';

export type HistoryEntry =
  | { kind: 'sediment'; label: string; before: Float32Array; after?: Float32Array }
  | { kind: 'move'; label: string; object: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; rotFrom: number; rotTo: number }
  | { kind: 'add' | 'remove'; label: string; sel: Selectable };

export interface HistoryTarget {
  snapshotSediment(): Float32Array;
  restoreSediment(s: Float32Array): void;
  restoreObject(o: THREE.Object3D, pos: THREE.Vector3, rotY: number): void;
  attach?(sel: Selectable): void;
  detach?(sel: Selectable): void;
}

/**
 * Undo / Redo for edit operations (sand strokes, island stamps, object moves).
 * One continuous mouse press is one entry. Bounded to keep memory flat.
 * Sediment entries capture the "after" state lazily at undo time, so grains that were still
 * falling when the stroke ended are part of the same step.
 */
export class HistoryManager {
  private stack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  readonly limit = 40;
  private listeners: (() => void)[] = [];

  constructor(private target: HistoryTarget) {}

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  push(e: HistoryEntry) {
    this.stack.push(e);
    if (this.stack.length > this.limit) this.stack.shift();
    this.redoStack.length = 0;
    this.emit();
  }

  get canUndo() {
    return this.stack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get size() {
    return this.stack.length;
  }
  peekLabel() {
    return this.stack[this.stack.length - 1]?.label ?? '';
  }
  peekRedoLabel() {
    return this.redoStack[this.redoStack.length - 1]?.label ?? '';
  }

  undo(): HistoryEntry | null {
    const e = this.stack.pop();
    if (!e) return null;
    if (e.kind === 'sediment') {
      e.after = this.target.snapshotSediment();
      this.target.restoreSediment(e.before);
    } else if (e.kind === 'move') this.target.restoreObject(e.object, e.from, e.rotFrom);
    else if (e.kind === 'add') this.target.detach?.(e.sel);
    else this.target.attach?.(e.sel);
    this.redoStack.push(e);
    this.emit();
    return e;
  }

  redo(): HistoryEntry | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    if (e.kind === 'sediment') {
      if (e.after) this.target.restoreSediment(e.after);
    } else if (e.kind === 'move') this.target.restoreObject(e.object, e.to, e.rotTo);
    else if (e.kind === 'add') this.target.attach?.(e.sel);
    else this.target.detach?.(e.sel);
    this.stack.push(e);
    this.emit();
    return e;
  }

  clear() {
    this.stack.length = 0;
    this.redoStack.length = 0;
    this.emit();
  }
}
