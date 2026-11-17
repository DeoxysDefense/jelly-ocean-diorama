import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { HistoryManager } from '../src/interaction/HistoryManager';

describe('HistoryManager', () => {
  it('undoes in LIFO order and restores the right state', () => {
    const restored: string[] = [];
    const h = new HistoryManager({
      snapshotSediment: () => new Float32Array(1),
      restoreSediment: () => restored.push('sed'),
      restoreObject: (o, p) => {
        o.position.copy(p);
        restored.push('move');
      },
    });
    const obj = new THREE.Object3D();
    h.push({ kind: 'sediment', label: 'Add sand', before: new Float32Array(1) });
    h.push({ kind: 'move', label: 'Move', object: obj, from: new THREE.Vector3(1, 2, 3), to: new THREE.Vector3(4, 5, 6), rotFrom: 0, rotTo: 0 });
    expect(h.canUndo).toBe(true);
    h.undo();
    expect(obj.position.toArray()).toEqual([1, 2, 3]);
    h.undo();
    expect(restored).toEqual(['move', 'sed']);
    expect(h.undo()).toBeNull();
  });

  it('is bounded', () => {
    const h = new HistoryManager({ snapshotSediment: () => new Float32Array(1), restoreSediment: () => {}, restoreObject: () => {} });
    for (let i = 0; i < 100; i++) h.push({ kind: 'sediment', label: 'x', before: new Float32Array(1) });
    expect(h.size).toBe(h.limit);
  });
});

describe('HistoryManager redo', () => {
  it('redoes sediment and moves after undo, and a new push clears redo', () => {
    let state = new Float32Array([0]);
    const h = new HistoryManager({
      snapshotSediment: () => state.slice(),
      restoreSediment: (s) => (state = s.slice()),
      restoreObject: (o, p) => o.position.copy(p),
    });
    const before = state.slice();
    state[0] = 5;
    h.push({ kind: 'sediment', label: 'Add sand', before });
    h.undo();
    expect(state[0]).toBe(0);
    h.redo();
    expect(state[0]).toBe(5);
    h.undo();
    expect(h.canRedo).toBe(true);
    h.push({ kind: 'sediment', label: 'Other', before: state.slice() });
    expect(h.canRedo).toBe(false);
  });
});

describe('HistoryManager place / remove', () => {
  it('undo detaches a placed object and redo re-attaches it', () => {
    const attached = new Set<string>();
    const h = new HistoryManager({
      snapshotSediment: () => new Float32Array(1),
      restoreSediment: () => {},
      restoreObject: () => {},
      attach: (s) => attached.add(s.id),
      detach: (s) => attached.delete(s.id),
    });
    const sel = { id: 'user-1' } as any;
    attached.add('user-1');
    h.push({ kind: 'add', label: 'Place', sel });
    h.undo();
    expect(attached.has('user-1')).toBe(false);
    h.redo();
    expect(attached.has('user-1')).toBe(true);
    h.push({ kind: 'remove', label: 'Remove', sel });
    attached.delete('user-1');
    h.undo();
    expect(attached.has('user-1')).toBe(true);
  });
});
