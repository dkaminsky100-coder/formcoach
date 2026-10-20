import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';

describe('M0 setup', () => {
  it.each([
    'public/wasm/vision_wasm_internal.wasm',
    'public/models/pose_landmarker_lite.task',
    'public/models/pose_landmarker_full.task',
  ])('%s exists (run `npm run setup`)', (file) => {
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(0);
  });
});
