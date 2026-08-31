import { describe, expect, it } from 'vitest';
import reducer, { setStoreManaged } from './updateSlice';

describe('updateSlice Store status', () => {
  it('marks Store as the update authority without an installable version', () => {
    const state = reducer(undefined, setStoreManaged());
    expect(state.status).toBe('store-managed');
    expect(state.availableVersion).toBeNull();
    expect(state.installing).toBe(false);
  });
});
