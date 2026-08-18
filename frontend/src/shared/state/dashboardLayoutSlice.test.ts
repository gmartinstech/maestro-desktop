import { describe, expect, it } from 'vitest';
import reducer, { addNote } from '@/shared/state/dashboardLayoutSlice';

describe('dashboardLayout harness', () => {
  it('addNote puts a note into the notes collection', () => {
    const state = reducer(undefined, addNote({ expandedSessionIds: [] }));
    const notes = Object.values(state.notes);
    expect(notes).toHaveLength(1);
    expect(notes[0].width).toBeGreaterThan(0);
    expect(notes[0].height).toBeGreaterThan(0);
  });
});

import reducerDefault, { fetchLayout, type ElementPosition } from '@/shared/state/dashboardLayoutSlice';

const anElement = (id: string): ElementPosition => ({
  element_id: id,
  kind: 'image',
  asset_id: '',
  title: 'Untitled',
  x: 10, y: 20, width: 320, height: 240,
  zOrder: 3,
});

describe('elements collection', () => {
  it('starts empty', () => {
    const state = reducerDefault(undefined, { type: '@@INIT' });
    expect(state.elements).toEqual({});
  });

  it('a fresh load replaces elements from the payload', () => {
    const payload = {
      cards: {}, viewCards: {}, browserCards: {}, workflowCards: {},
      workflowsHub: null, notes: {}, expandedSessionIds: [],
      elements: { e1: anElement('e1') },
    };
    const state = reducerDefault(undefined, {
      type: fetchLayout.fulfilled.type,
      payload,
      meta: { arg: { dashboardId: 'd1' } },
    });
    expect(state.elements.e1.title).toBe('Untitled');
  });

  it('a fresh load with no elements key does not crash (old saved layouts)', () => {
    const payload = {
      cards: {}, viewCards: {}, browserCards: {}, workflowCards: {},
      workflowsHub: null, notes: {}, expandedSessionIds: [],
    } as never;
    const state = reducerDefault(undefined, {
      type: fetchLayout.fulfilled.type,
      payload,
      meta: { arg: { dashboardId: 'd1' } },
    });
    expect(state.elements).toEqual({});
  });

  it('a reconnect refetch merges without clobbering a live element', () => {
    const withLive = reducerDefault(undefined, {
      type: fetchLayout.fulfilled.type,
      payload: {
        cards: {}, viewCards: {}, browserCards: {}, workflowCards: {},
        workflowsHub: null, notes: {}, expandedSessionIds: [],
        elements: { e1: { ...anElement('e1'), x: 999 } },
      },
      meta: { arg: { dashboardId: 'd1' } },
    });
    const merged = reducerDefault(withLive, {
      type: fetchLayout.fulfilled.type,
      payload: {
        cards: {}, viewCards: {}, browserCards: {}, workflowCards: {},
        workflowsHub: null, notes: {}, expandedSessionIds: [],
        elements: { e1: anElement('e1'), e2: anElement('e2') },
      },
      meta: { arg: { dashboardId: 'd1', isReconnect: true } },
    });
    expect(merged.elements.e1.x).toBe(999);   // live position preserved
    expect(merged.elements.e2).toBeDefined(); // missing card recovered
  });

  it('rescans element zOrder when computing nextZOrder', () => {
    const state = reducerDefault(undefined, {
      type: fetchLayout.fulfilled.type,
      payload: {
        cards: {}, viewCards: {}, browserCards: {}, workflowCards: {},
        workflowsHub: null, notes: {}, expandedSessionIds: [],
        elements: { e1: { ...anElement('e1'), zOrder: 7 } },
      },
      meta: { arg: { dashboardId: 'd1' } },
    });
    expect(state.nextZOrder).toBe(8);
  });
});
