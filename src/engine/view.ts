import type { View } from './types';

/** Shoulder spread ÷ torso length: ~0.8 facing the camera, ~0.1 side-on. */
export const FRONT_MIN_SPREAD = 0.5;
export const SIDE_MAX_SPREAD = 0.25;

export function classifyView(shoulderSpread: number | null): View {
  if (shoulderSpread === null || !Number.isFinite(shoulderSpread)) return 'unknown';
  if (shoulderSpread >= FRONT_MIN_SPREAD) return 'front';
  if (shoulderSpread <= SIDE_MAX_SPREAD) return 'side';
  return 'oblique';
}

/** Commits to a new view only after it has been seen for `confirmFrames` consecutive frames. */
export class ViewTracker {
  private current: View = 'unknown';
  private candidate: View = 'unknown';
  private count = 0;

  constructor(private readonly confirmFrames = 8) {}

  update(raw: View): View {
    if (raw === this.current) {
      this.candidate = raw;
      this.count = 0;
      return this.current;
    }
    if (raw === this.candidate) {
      this.count++;
    } else {
      this.candidate = raw;
      this.count = 1;
    }
    if (this.count >= this.confirmFrames) {
      this.current = raw;
      this.count = 0;
    }
    return this.current;
  }

  get view(): View {
    return this.current;
  }

  reset(): void {
    this.current = 'unknown';
    this.candidate = 'unknown';
    this.count = 0;
  }
}
