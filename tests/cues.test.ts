import { describe, expect, it } from 'vitest';
import type { ActiveFault, FaultId } from '../src/engine/faults';
import type { RepSummary } from '../src/engine/WorkoutTracker';
import { CueOrchestrator } from '../src/feedback/CueOrchestrator';

const fault = (id: FaultId, cue: string = id): ActiveFault => ({ id, cue, joints: [], guides: [] });

const rep = (over: Partial<RepSummary>): RepSummary => ({
  count: 1, counted: true, issue: null, maxDepth: 1, tStart: 0, tEnd: 3000,
  tDown: 1.5, tPause: 0.2, tUp: 1, faults: [], score: 100, side: null, ...over,
});

describe('CueOrchestrator', () => {
  it('calls out a fault the moment it appears, once', () => {
    const c = new CueOrchestrator();
    const a = c.onFrame([fault('knee_valgus', 'Knees out')], 0);
    expect(a?.speak).toBe('Knees out');
    expect(a?.interrupt).toBe(true);
    expect(c.onFrame([fault('knee_valgus', 'Knees out')], 33)).toBeNull(); // still active, not repeated
  });

  it('picks the most important fault when several appear together', () => {
    const c = new CueOrchestrator();
    const a = c.onFrame([fault('heel_lift', 'Heels down'), fault('knee_valgus', 'Knees out')], 0);
    expect(a?.speak).toBe('Knees out');
  });

  it('leaves a gap between corrections', () => {
    const c = new CueOrchestrator({ speechGapMs: 1200 });
    c.onFrame([fault('knee_valgus')], 0);
    expect(c.onFrame([fault('knee_valgus'), fault('forward_lean')], 500)).toBeNull();
  });

  it('does not repeat the same correction within the cooldown', () => {
    const c = new CueOrchestrator({ cooldownMs: 4000 });
    c.onFrame([fault('knee_valgus')], 0);
    c.onFrame([], 1000);
    expect(c.onFrame([fault('knee_valgus')], 2000)).toBeNull();
    c.onFrame([], 4500);
    expect(c.onFrame([fault('knee_valgus')], 5000)?.speak).toBe('knee_valgus');
  });

  it('always speaks the count, queued rather than interrupting', () => {
    const c = new CueOrchestrator();
    c.onFrame([fault('knee_valgus')], 0);
    const a = c.onRep(rep({ count: 3, faults: ['knee_valgus'], score: 75 }), 300);
    expect(a.speak).toBe('3'); // knees already called out mid-rep
    expect(a.interrupt).toBeFalsy();
    expect(a.banner?.kind).toBe('warn');
  });

  it('adds a tempo cue to the count when not yet said', () => {
    const c = new CueOrchestrator();
    const a = c.onRep(rep({ count: 2, faults: ['fast_descent'], score: 90 }), 0);
    expect(a.speak).toBe('2. Slow down');
  });

  it('praises a clean rep with its score', () => {
    const a = new CueOrchestrator().onRep(rep({ count: 4 }), 0);
    expect(a.speak).toBe('4');
    expect(a.banner).toEqual({ text: 'Good rep · 100', kind: 'good' });
  });

  it('says "Go lower" for a shallow rep', () => {
    const a = new CueOrchestrator().onRep(rep({ counted: false, issue: 'shallow', score: 0 }), 0);
    expect(a.speak).toBe('Go lower');
    expect(a.tone).toBe('partial');
  });
});
