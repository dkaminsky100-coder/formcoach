import { describe, expect, it } from 'vitest';
import { BONES, DRAWN_JOINTS, LANDMARK_COUNT, LM, boneSide, sideOf } from '../src/pose/landmarks';

describe('landmark topology', () => {
  it('only references valid indices', () => {
    for (const [a, b] of BONES) {
      expect(a).toBeLessThan(LANDMARK_COUNT);
      expect(b).toBeLessThan(LANDMARK_COUNT);
    }
    DRAWN_JOINTS.forEach((i) => expect(i).toBeLessThan(LANDMARK_COUNT));
  });

  it('has no duplicate bones', () => {
    const keys = BONES.map(([a, b]) => [Math.min(a, b), Math.max(a, b)].join('-'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('classifies sides', () => {
    expect(sideOf(LM.NOSE)).toBe('center');
    expect(sideOf(LM.L_KNEE)).toBe('left');
    expect(sideOf(LM.R_KNEE)).toBe('right');
    expect(boneSide([LM.L_KNEE, LM.L_ANKLE])).toBe('left');
    expect(boneSide([LM.L_HIP, LM.R_HIP])).toBe('center');
  });
});
