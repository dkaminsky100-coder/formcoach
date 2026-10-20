import { describe, expect, it } from 'vitest';
import { RepStateMachine, type RepEvent } from '../src/engine/repStateMachine';

/** Drives the FSM with a progress curve p(t) and its exact derivative. */
function run(fsm: RepStateMachine, p: (s: number) => number | null, seconds: number, fps = 30, t0 = 0) {
  const events: RepEvent[] = [];
  const dt = 1 / fps;
  for (let s = 0; s <= seconds; s += dt) {
    const v = p(s);
    const prev = p(Math.max(0, s - dt));
    const vel = v !== null && prev !== null ? (v - prev) / dt : 0;
    const e = fsm.update(v, vel, t0 + s * 1000);
    if (e) events.push(e);
  }
  return events;
}

/** One rep: 1 s rest, 1 s down to `depth`, 0.5 s hold, 1 s up, 1 s rest (4.5 s total). */
const rep = (depth: number) => (s: number) => {
  if (s < 1) return 0;
  if (s < 2) return depth * (1 - Math.cos(Math.PI * (s - 1))) / 2;
  if (s < 2.5) return depth;
  if (s < 3.5) return depth * (1 + Math.cos(Math.PI * (s - 2.5))) / 2;
  return 0;
};

describe('RepStateMachine', () => {
  it('counts a full rep and reports tempo', () => {
    const fsm = new RepStateMachine();
    const [e, ...rest] = run(fsm, rep(1.1), 4.5);
    expect(rest).toHaveLength(0);
    expect(e.counted).toBe(true);
    expect(e.count).toBe(1);
    expect(e.maxDepth).toBeCloseTo(1.1, 2);
    expect(e.tDown).toBeGreaterThan(0.6);
    expect(e.tDown).toBeLessThan(1.4);
    expect(e.tUp).toBeGreaterThan(0.6);
    expect(e.tUp).toBeLessThan(1.4);
    expect(fsm.phase).toBe('top');
  });

  it('goes through every phase in order', () => {
    const fsm = new RepStateMachine();
    const seen: string[] = [];
    const p = rep(1);
    for (let s = 0; s <= 4.5; s += 1 / 30) {
      const v = (p(s) - p(Math.max(0, s - 1 / 30))) * 30;
      fsm.update(p(s), v, s * 1000);
      if (seen[seen.length - 1] !== fsm.phase) seen.push(fsm.phase);
    }
    expect(seen).toEqual(['top', 'descending', 'bottom', 'ascending', 'top']);
  });

  it('reports a shallow rep without counting it', () => {
    const fsm = new RepStateMachine();
    const [e] = run(fsm, rep(0.6), 4.5);
    expect(e.counted).toBe(false);
    expect(e.issue).toBe('shallow');
    expect(fsm.count).toBe(0);
    expect(fsm.partials).toBe(1);
  });

  it('ignores small fidgets', () => {
    const fsm = new RepStateMachine();
    expect(run(fsm, rep(0.2), 4.5)).toHaveLength(0);
    expect(fsm.partials).toBe(0);
  });

  it('ignores single-frame noise spikes', () => {
    const fsm = new RepStateMachine();
    const spiky = (s: number) => (Math.round(s * 30) % 20 === 0 ? 0.8 : 0.02);
    expect(run(fsm, spiky, 5)).toHaveLength(0);
    expect(fsm.phase).toBe('top');
  });

  it('freezes during a short tracking loss and still counts the rep', () => {
    const fsm = new RepStateMachine();
    const p = rep(1);
    const gappy = (s: number) => (s > 2.1 && s < 2.4 ? null : p(s));
    const events = run(fsm, gappy, 4.5);
    expect(events.map((e) => e.counted)).toEqual([true]);
  });

  it('abandons the rep after a long tracking loss', () => {
    const fsm = new RepStateMachine();
    const p = rep(1);
    const lost = (s: number) => (s > 2.1 && s < 4 ? null : s >= 4 ? 0 : p(s));
    expect(run(fsm, lost, 5)).toHaveLength(0);
    expect(fsm.phase).toBe('top');
  });

  it('abandons a rep held too long (e.g. sat down)', () => {
    const fsm = new RepStateMachine({ maxRepMs: 3000 });
    const sit = (s: number) => (s < 1 ? 0 : Math.min(1, s - 1));
    expect(run(fsm, sit, 6)).toHaveLength(0);
    expect(fsm.phase).toBe('top');
  });

  it('after an abandoned rep, waits for the user to stand before counting again', () => {
    const fsm = new RepStateMachine({ maxRepMs: 3000 });
    // Sit for 5 s, stand up, then do a normal rep.
    const p = rep(1);
    const seq = (s: number) => (s < 1 ? 0 : s < 6 ? Math.min(1, s - 1) : s < 7 ? 0 : p(s - 7));
    const events = run(fsm, seq, 7 + 4.5);
    expect(events.map((e) => e.counted)).toEqual([true]);
  });

  it('flags reps that are too fast', () => {
    const fsm = new RepStateMachine({ minRepMs: 3000 });
    const [e] = run(fsm, rep(1), 4.5);
    expect(e.issue).toBe('too_fast');
    expect(e.counted).toBe(false);
  });

  it('counts consecutive reps', () => {
    const fsm = new RepStateMachine();
    const p = rep(1);
    const many = (s: number) => p(s % 4.5);
    const events = run(fsm, many, 4.5 * 5 - 0.1);
    expect(events.filter((e) => e.counted)).toHaveLength(5);
    expect(fsm.count).toBe(5);
  });

  it('reset clears the counter', () => {
    const fsm = new RepStateMachine();
    run(fsm, rep(1), 4.5);
    fsm.reset();
    expect(fsm.count).toBe(0);
    expect(fsm.phase).toBe('top');
  });
});
