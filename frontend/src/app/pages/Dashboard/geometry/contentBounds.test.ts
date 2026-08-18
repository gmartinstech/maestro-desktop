import { describe, expect, it } from 'vitest';
import { computeContentBounds } from '@/app/pages/Dashboard/geometry/contentBounds';

describe('computeContentBounds', () => {
  it('includes element cards in the bounding box', () => {
    const bounds = computeContentBounds({}, {}, {}, {}, null, {
      e1: {
        element_id: 'e1', kind: 'image', asset_id: '', title: 'A',
        x: 100, y: 200, width: 300, height: 400, zOrder: 1,
      },
    });
    expect(bounds).toEqual({ minX: 100, minY: 200, maxX: 400, maxY: 600 });
  });

  it('returns undefined for a genuinely empty canvas', () => {
    expect(computeContentBounds({}, {}, {}, {}, null, {})).toBeUndefined();
  });
});
