import { describe, expect, it } from 'vitest';
import { OneEuroFilter } from '../src/engine/math/oneEuro';
import { angle2D, angle3D, inclination2D, inclination3D, lineOffset2D } from '../src/engine/math/vec';

const P = (x: number, y: number, z = 0) => ({ x, y, z });

describe('joint angles', () => {
  it('measures right angles', () => {
    expect(angle2D(P(1, 0), P(0, 0), P(0, 1))).toBeCloseTo(90, 6);
    expect(angle3D(P(1, 0, 0), P(0, 0, 0), P(0, 0, 1))).toBeCloseTo(90, 6);
  });

  it('is precise near straight (180°) and fully folded (0°)', () => {
    expect(angle2D(P(-1, 0), P(0, 0), P(1, 0))).toBeCloseTo(180, 6);
    expect(angle2D(P(-1, 0), P(0, 0), P(1, 1e-4))).toBeCloseTo(180 - 0.0057, 3);
    expect(angle2D(P(1, 0), P(0, 0), P(2, 0))).toBeCloseTo(0, 6);
  });

  it('is invariant to scale and translation', () => {
    const a = angle2D(P(1, 2), P(3, 5), P(7, 4));
    expect(angle2D(P(10 + 3, 20 + 6), P(10 + 9, 20 + 15), P(10 + 21, 20 + 12))).toBeCloseTo(a, 6);
  });

  it('2D ignores depth while 3D uses it', () => {
    // A knee bent toward the camera looks straight in 2D.
    const hip = P(0, -1, 0), knee = P(0, 0, -0.5), ankle = P(0, 1, 0);
    expect(angle2D(hip, knee, ankle)).toBeCloseTo(180, 6);
    expect(angle3D(hip, knee, ankle)).toBeLessThan(130);
  });

  it('inclination from vertical', () => {
    expect(inclination2D(P(0, 0), P(0, -10))).toBeCloseTo(0, 6);
    expect(inclination2D(P(0, 0), P(10, -10))).toBeCloseTo(45, 6);
    expect(inclination2D(P(0, 0), P(-10, -10))).toBeCloseTo(45, 6);
    expect(inclination3D(P(0, 0, 0), P(0, -1, 1))).toBeCloseTo(45, 6);
  });

  it('signed line offset', () => {
    // Line heading down the screen (+y): screen-right (+x) is on its left-hand side.
    expect(lineOffset2D(P(1, 5), P(0, 0), P(0, 10))).toBeCloseTo(1, 6);
    expect(lineOffset2D(P(-1, 5), P(0, 0), P(0, 10))).toBeCloseTo(-1, 6);
  });
});

describe('OneEuroFilter', () => {
  const dt = 1 / 30;

  it('passes a constant signal through unchanged', () => {
    const f = new OneEuroFilter();
    for (let i = 0; i < 30; i++) expect(f.filter(5, dt)).toBe(5);
  });

  it('converges after a step', () => {
    const f = new OneEuroFilter(1.5, 0.02);
    f.filter(0, dt);
    let y = 0;
    for (let i = 0; i < 30; i++) y = f.filter(100, dt);
    expect(y).toBeGreaterThan(99);
  });

  it('reduces jitter on a still subject by more than half', () => {
    const f = new OneEuroFilter(1.5, 0.02);
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 6; // ±3 px
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = 400 + rand();
      raw.push(x);
      out.push(f.filter(x, dt));
    }
    const std = (a: number[]) => {
      const m = a.reduce((s, v) => s + v, 0) / a.length;
      return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
    };
    expect(std(out.slice(30))).toBeLessThan(std(raw.slice(30)) * 0.5);
  });

  it('keeps lag small on fast motion', () => {
    const f = new OneEuroFilter(1.5, 0.02);
    let x = 0, y = 0;
    for (let i = 0; i < 60; i++) {
      x = i * 20; // 600 px/s
      y = f.filter(x, dt);
    }
    expect(x - y).toBeLessThan(40); // under ~2 frames behind
  });

  it('holds its value when dt is not positive', () => {
    const f = new OneEuroFilter();
    f.filter(1, dt);
    expect(f.filter(50, 0)).toBe(1);
  });
});
