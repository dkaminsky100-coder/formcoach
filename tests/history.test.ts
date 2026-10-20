import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/Engine';
import { SquatModel } from '../src/engine/exercises/squat';
import { setsToCsv, summarizeSet, topFaults, type SetMeta } from '../src/engine/summary';
import type { RawPose } from '../src/engine/types';
import { WorkoutTracker, type RepSummary } from '../src/engine/WorkoutTracker';
import { decodeFrame, encodeFrame, parseRecording, Recorder, type Recording } from '../src/pose/recording';
import { simulate } from './helpers/simulate';
import { squatSequence, type RepSpec } from './helpers/squatSequence';

const meta: SetMeta = {
  id: 'set-1',
  date: new Date('2026-10-20T10:00:00Z'),
  exercise: 'squat',
  exerciseName: 'Squat',
  depthLabel: 'Parallel (knee 95°)',
  tempoLabel: 'free',
  source: 'camera',
};

const clean: RepSpec = { bottomKnee: 85 };
const valgus: RepSpec = { bottomKnee: 85, faults: { kneeInM: 0.09 } };
const shallow: RepSpec = { bottomKnee: 130 };

describe('set summary', () => {
  const { events } = simulate([clean, valgus, shallow, valgus, clean], { view: 'front' });
  const rec = summarizeSet(events, meta);

  it('counts reps, partials and scores', () => {
    expect(rec.reps).toBe(4);
    expect(rec.partials).toBe(1);
    expect(rec.avgScore).toBe(88); // (100 + 75 + 75 + 100) / 4 = 87.5
    expect(rec.bestScore).toBe(100);
    expect(rec.repList).toHaveLength(5);
    expect(rec.repList[2]).toMatchObject({ n: 3, counted: false, issue: 'shallow' });
  });

  it('ranks the issues to work on', () => {
    expect(rec.faultCounts).toEqual({ knee_valgus: 2 });
    expect(topFaults(rec)).toEqual([{ id: 'knee_valgus', title: 'Knees caving in', count: 2 }]);
  });

  it('averages tempo over counted reps and measures set time', () => {
    expect(rec.avgTempo!.down).toBeGreaterThan(0.6);
    expect(rec.avgTempo!.up).toBeGreaterThan(0.4);
    expect(rec.durationS).toBeGreaterThan(10);
    expect(rec.durationS).toBeLessThan(20);
  });

  it('handles a set with no counted reps', () => {
    const r = summarizeSet(simulate([shallow]).events, meta);
    expect(r).toMatchObject({ reps: 0, partials: 1, avgScore: null, avgTempo: null, legCounts: null });
  });

  it('records per-leg counts when reps have a side', () => {
    const reps = events.map((e, i) => ({ ...e, side: i % 2 ? 'right' : 'left' }) as RepSummary);
    expect(summarizeSet(reps, meta).legCounts).toEqual({ left: 2, right: 2 }); // partial (3rd) excluded
  });
});

describe('CSV export', () => {
  const rec = summarizeSet(simulate([clean, valgus]).events, meta);

  it('has a header and one row per rep', () => {
    const lines = setsToCsv([rec, { ...rec, id: 'set-2' }]).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'date,exercise,set_id,rep,counted,issue,score,depth_pct,down_s,pause_s,up_s,faults,leg,depth_target,tempo_target,source',
    );
    expect(lines).toHaveLength(1 + 4);
    expect(lines[1].startsWith('2026-10-20T10:00:00.000Z,Squat,set-1,1,true,,100,')).toBe(true);
  });

  it('quotes cells that contain commas or quotes', () => {
    const tricky = { ...rec, exerciseName: 'Squat, "goblet"' };
    expect(setsToCsv([tricky])).toContain('"Squat, ""goblet"""');
  });
});

describe('landmark recordings', () => {
  const pose = (t: number): RawPose => squatSequence([clean], { view: 'side' })[Math.round(t / 33.3)].pose!;

  it('round-trips a frame (to 5 decimal places)', () => {
    const p = pose(2000);
    const back = decodeFrame(encodeFrame(p, 123), p.width, p.height)!;
    expect(back.t).toBe(123);
    expect(back.image).toHaveLength(33);
    expect(back.world).toHaveLength(33);
    back.image.forEach((lm, i) => {
      expect(lm.x).toBeCloseTo(p.image[i].x, 4);
      expect(lm.visibility).toBeCloseTo(p.image[i].visibility!, 4);
    });
  });

  it('keeps "no person" frames', () => {
    expect(decodeFrame(encodeFrame(null, 50), 1280, 720)).toBeNull();
  });

  it('records relative timestamps', () => {
    const r = new Recorder();
    r.start(1280, 720, 'squat');
    r.add(pose(0), 5000);
    r.add(null, 5033);
    r.add(pose(66), 5066);
    const rec = r.stop()!;
    expect(rec.frames.map((f) => f.t)).toEqual([0, 33, 66]);
    expect(rec.exercise).toBe('squat');
    expect(r.active).toBe(false);
  });

  it('rejects files that are not recordings', () => {
    expect(() => parseRecording({ hello: 1 })).toThrow('not a FormCoach landmark recording');
    expect(() => parseRecording({ version: 1, width: 1, height: 1, frames: [{ t: 0, image: [1, 2], world: [] }] })).toThrow(
      'damaged',
    );
  });

  it('replays to exactly the same result as the live run', () => {
    const reps = [clean, valgus, shallow, clean];
    const live = simulate(reps, { view: 'front' }).events;

    // Record the same session, serialise, parse, and replay it.
    const r = new Recorder();
    r.start(1280, 720, 'squat');
    for (const f of squatSequence(reps, { view: 'front' })) r.add(f.pose, f.t);
    const parsed = parseRecording(JSON.parse(JSON.stringify(r.stop())));
    const engine = new Engine();
    const tracker = new WorkoutTracker(new SquatModel());
    const replayed: RepSummary[] = [];
    for (const f of parsed.frames) {
      const p = decodeFrame(f, parsed.width, parsed.height);
      const { rep } = tracker.update(p ? engine.process(p) : null, f.t + 1);
      if (rep) replayed.push(rep);
    }
    expect(replayed.map((e) => [e.counted, e.issue, e.faults])).toEqual(live.map((e) => [e.counted, e.issue, e.faults]));
  });

  it('writes sample recordings to tests/fixtures', () => {
    const write = (name: string, reps: RepSpec[], view: 'side' | 'front') => {
      const r = new Recorder();
      r.start(1280, 720, 'squat');
      for (const f of squatSequence(reps, { view })) r.add(f.pose, f.t);
      const rec: Recording = r.stop()!;
      mkdirSync('tests/fixtures', { recursive: true });
      writeFileSync(`tests/fixtures/${name}.json`, JSON.stringify(rec));
      return rec;
    };
    expect(write('squat-side-5-clean', [clean, clean, clean, clean, clean], 'side').frames.length).toBeGreaterThan(400);
    expect(write('squat-front-mixed', [clean, valgus, shallow, clean], 'front').frames.length).toBeGreaterThan(300);
  });
});
