import { describe, expect, it } from 'vitest';
import reducer, { setFullscreenCardId, clearFullscreenCardId, setDrawerCardId, clearDrawerCardId } from '@/shared/state/tempStateSlice';

describe('tempState fullscreenCardId', () => {
  it('starts null', () => {
    const state = reducer(undefined, { type: '@@INIT' });
    expect(state.fullscreenCardId).toBeNull();
  });

  it('setFullscreenCardId stores the card key', () => {
    const state = reducer(undefined, setFullscreenCardId('view-abc123'));
    expect(state.fullscreenCardId).toBe('view-abc123');
  });

  it('clearFullscreenCardId resets to null when the id matches', () => {
    const withId = reducer(undefined, setFullscreenCardId('view-abc123'));
    const cleared = reducer(withId, clearFullscreenCardId('view-abc123'));
    expect(cleared.fullscreenCardId).toBeNull();
  });

  it('clearFullscreenCardId is a no-op when a different card owns the slot', () => {
    const withId = reducer(undefined, setFullscreenCardId('view-abc123'));
    const unchanged = reducer(withId, clearFullscreenCardId('view-other'));
    expect(unchanged.fullscreenCardId).toBe('view-abc123');
  });
});

describe('tempState drawerCardId', () => {
  it('starts null', () => {
    const state = reducer(undefined, { type: '@@INIT' });
    expect(state.drawerCardId).toBeNull();
  });

  it('setDrawerCardId stores the card id', () => {
    const state = reducer(undefined, setDrawerCardId('session-abc123'));
    expect(state.drawerCardId).toBe('session-abc123');
  });

  it('clearDrawerCardId resets to null when the id matches', () => {
    const withId = reducer(undefined, setDrawerCardId('session-abc123'));
    const cleared = reducer(withId, clearDrawerCardId('session-abc123'));
    expect(cleared.drawerCardId).toBeNull();
  });

  it('clearDrawerCardId is a no-op when a different card owns the slot', () => {
    const withId = reducer(undefined, setDrawerCardId('session-abc123'));
    const unchanged = reducer(withId, clearDrawerCardId('session-other'));
    expect(unchanged.drawerCardId).toBe('session-abc123');
  });
});
