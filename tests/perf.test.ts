import { describe, expect, it } from 'vitest';
import { PerfMonitor, QUALITY_LADDER, RateCounter, RollingWindow } from '../src/perf/PerfMonitor';

describe('RollingWindow', () => {
  it('keeps only the last N samples', () => {
    const w = new RollingWindow(3);
    [1, 2, 3, 4, 5].forEach((v) => w.push(v));
    expect(w.length).toBe(3);
    expect(w.percentile(0)).toBe(3);
    expect(w.percentile(1)).toBe(5);
  });

  it('computes nearest-rank percentiles', () => {
    const w = new RollingWindow(100);
    for (let i = 1; i <= 100; i++) w.push(i);
    expect(w.percentile(0.5)).toBe(50);
    expect(w.percentile(0.95)).toBe(95);
  });

  it('is NaN when empty', () => {
    expect(new RollingWindow(5).percentile(0.5)).toBeNaN();
  });
});

describe('RateCounter', () => {
  it('measures 30 fps', () => {
    const r = new RateCounter();
    for (let i = 0; i <= 60; i++) r.tick(i * (1000 / 30));
    expect(r.rate).toBeCloseTo(30, 0);
  });
});

describe('PerfMonitor.shouldDowngrade', () => {
  const feed = (m: PerfMonitor, ms: number, from: number, frames: number) => {
    for (let i = 0; i < frames; i++) m.recordInference(ms, from + i * 33);
    return from + frames * 33;
  };

  it('stays put when inference is within budget', () => {
    const m = new PerfMonitor({ budgetMs: 40, sustainMs: 1000, minSamples: 10 });
    const t = feed(m, 20, 0, 200);
    expect(m.shouldDowngrade(t, 1)).toBe(false);
  });

  it('downgrades only after being over budget for the sustain period', () => {
    const m = new PerfMonitor({ budgetMs: 40, sustainMs: 1000, minSamples: 10 });
    let t = feed(m, 60, 0, 20);
    expect(m.shouldDowngrade(t, 1)).toBe(false); // starts the timer
    t = feed(m, 60, t, 10);
    expect(m.shouldDowngrade(t, 1)).toBe(false); // ~330 ms later
    t = feed(m, 60, t, 25);
    expect(m.shouldDowngrade(t, 1)).toBe(true);
  });

  it('scales the budget by frame skip', () => {
    const m = new PerfMonitor({ budgetMs: 40, sustainMs: 0, minSamples: 10 });
    const t = feed(m, 60, 0, 30);
    expect(m.shouldDowngrade(t, 2)).toBe(false);
  });

  it('ignores GPU warm-up inferences', () => {
    const m = new PerfMonitor({ budgetMs: 40, sustainMs: 0, minSamples: 10, warmupSamples: 5 });
    for (let i = 0; i < 5; i++) m.recordInference(5000, i * 33); // shader compilation
    const t = feed(m, 15, 5 * 33, 30);
    expect(m.snapshot().inferenceP95).toBe(15);
    expect(m.shouldDowngrade(t, 1)).toBe(false);
  });

  it('waits for fresh samples after a reset', () => {
    const m = new PerfMonitor({ budgetMs: 40, sustainMs: 0, minSamples: 10 });
    const t = feed(m, 60, 0, 30);
    m.resetInference();
    expect(m.shouldDowngrade(t, 1)).toBe(false);
  });
});

describe('QUALITY_LADDER', () => {
  it('starts at the most accurate setting and only gets cheaper', () => {
    expect(QUALITY_LADDER[0]).toEqual({ model: 'full', skip: 1 });
    for (let i = 1; i < QUALITY_LADDER.length; i++) {
      const prev = QUALITY_LADDER[i - 1];
      const cur = QUALITY_LADDER[i];
      expect(cur.skip >= prev.skip || (prev.model === 'full' && cur.model === 'lite')).toBe(true);
    }
  });
});
