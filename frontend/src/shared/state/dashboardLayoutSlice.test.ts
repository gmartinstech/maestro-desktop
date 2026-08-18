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
