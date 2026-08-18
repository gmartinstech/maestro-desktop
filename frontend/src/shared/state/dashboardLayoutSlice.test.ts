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

import reducerEl, {
  addElement, setElementPosition, setElementSize, removeElement, bringToFront, addNote as addNoteEl, moveCards,
} from '@/shared/state/dashboardLayoutSlice';

describe('element reducers', () => {
  it('addElement creates a card with the default size and a title', () => {
    const state = reducerEl(undefined, addElement({ kind: 'image', title: 'Diagram', expandedSessionIds: [] }));
    const els = Object.values(state.elements);
    expect(els).toHaveLength(1);
    expect(els[0].kind).toBe('image');
    expect(els[0].title).toBe('Diagram');
    expect(els[0].width).toBe(320);
    expect(els[0].height).toBe(240);
    expect(state.pendingFocusElementId).toBe(els[0].element_id);
  });

  it('a second element does not land on top of the first', () => {
    const one = reducerEl(undefined, addElement({ kind: 'image', title: 'A', expandedSessionIds: [] }));
    const two = reducerEl(one, addElement({ kind: 'image', title: 'B', expandedSessionIds: [] }));
    const [a, b] = Object.values(two.elements);
    const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    expect(overlaps).toBe(false);
  });

  it('an element does not land on top of an existing note', () => {
    const withNote = reducerEl(undefined, addNoteEl({ expandedSessionIds: [] }));
    const n = Object.values(withNote.notes)[0];
    const withEl = reducerEl(withNote, addElement({ kind: 'image', title: 'A', expandedSessionIds: [] }));
    const e = Object.values(withEl.elements)[0];
    const overlaps = n.x < e.x + e.width && n.x + n.width > e.x && n.y < e.y + e.height && n.y + n.height > e.y;
    expect(overlaps).toBe(false);
  });

  it('setElementPosition moves it', () => {
    const s0 = reducerEl(undefined, addElement({ kind: 'image', title: 'A', expandedSessionIds: [] }));
    const id = Object.values(s0.elements)[0].element_id;
    const s1 = reducerEl(s0, setElementPosition({ elementId: id, x: 42, y: 84 }));
    expect(s1.elements[id].x).toBe(42);
    expect(s1.elements[id].y).toBe(84);
  });

  it('setElementSize clamps to the minimum', () => {
    const s0 = reducerEl(undefined, addElement({ kind: 'image', title: 'A', expandedSessionIds: [] }));
    const id = Object.values(s0.elements)[0].element_id;
    const s1 = reducerEl(s0, setElementSize({ elementId: id, width: 10, height: 10 }));
    expect(s1.elements[id].width).toBe(160);
    expect(s1.elements[id].height).toBe(120);
  });

  it('removeElement deletes it', () => {
    const s0 = reducerEl(undefined, addElement({ kind: 'image', title: 'A', expandedSessionIds: [] }));
    const id = Object.values(s0.elements)[0].element_id;
    const s1 = reducerEl(s0, removeElement({ elementId: id }));
    expect(s1.elements[id]).toBeUndefined();
  });

  it('bringToFront raises an element above every other card', () => {
    const s0 = reducerEl(undefined, addNoteEl({ expandedSessionIds: [] }));
    const s1 = reducerEl(s0, addElement({ kind: 'image', title: 'A', expandedSessionIds: [] }));
    const noteId = Object.values(s1.notes)[0].note_id;
    const elId = Object.values(s1.elements)[0].element_id;
    const s2 = reducerEl(s1, bringToFront({ id: noteId, type: 'note' }));
    const s3 = reducerEl(s2, bringToFront({ id: elId, type: 'element' }));
    expect(s3.elements[elId].zOrder).toBeGreaterThan(s3.notes[noteId].zOrder);
  });

  it('moveCards commits a delta to an element in a multi-drag selection', () => {
    const s0 = reducerEl(undefined, addElement({ kind: 'image', title: 'A', expandedSessionIds: [] }));
    const el = Object.values(s0.elements)[0];
    const s1 = reducerEl(s0, moveCards({ items: [{ id: el.element_id, type: 'element' }], dx: 15, dy: -7 }));
    expect(s1.elements[el.element_id].x).toBe(el.x + 15);
    expect(s1.elements[el.element_id].y).toBe(el.y - 7);
  });
});
