import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/Engine';
import { createExercise } from '../src/engine/exercises';
import type { ExerciseId } from '../src/engine/exercises/ExerciseModel';
import { STRICTNESS, type Strictness } from '../src/engine/faults';
import { WorkoutTracker, type RepSummary } from '../src/engine/WorkoutTracker';
import { decodeFrame, parseRecording } from '../src/pose/recording';

/**
 * Regression tests from recordings. To add one:
 *   1. In the app, press "● Rec", do a set, press it again → a .json lands in Downloads.
 *   2. Copy it into tests/fixtures/ and add <same name>.expected.json describing what should happen:
 *        { "reps": 5, "partials": 1, "repFaults": [[], ["knee_valgus"], ...] }   (repFaults optional)
 *      Optional: "exercise" (else the recording's own), "depth", "strictness".
 *   3. npm test
 */

interface Expected {
  reps: number;
  partials: number;
  repFaults?: string[][];
  exercise?: ExerciseId;
  depth?: string;
  strictness?: Strictness;
}

const DIR = 'tests/fixtures';
const cases = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => f.endsWith('.expected.json'))
      .map((f) => f.replace(/\.expected\.json$/, ''))
      .filter((name) => existsSync(`${DIR}/${name}.json`))
  : [];

describe('recorded fixtures', () => {
  it('has fixtures to check', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)('%s', (name) => {
    const rec = parseRecording(JSON.parse(readFileSync(`${DIR}/${name}.json`, 'utf8')));
    const exp = JSON.parse(readFileSync(`${DIR}/${name}.expected.json`, 'utf8')) as Expected;
    const model = createExercise(exp.exercise ?? rec.exercise ?? 'squat');
    if (exp.depth) model.depth = exp.depth;
    const tracker = new WorkoutTracker(model);
    if (exp.strictness) tracker.sensitivity = STRICTNESS[exp.strictness];

    const engine = new Engine();
    const reps: RepSummary[] = [];
    for (const f of rec.frames) {
      const pose = decodeFrame(f, rec.width, rec.height);
      const { rep } = tracker.update(pose ? engine.process(pose) : null, f.t + 1);
      if (rep) reps.push(rep);
    }

    expect({ reps: tracker.state().reps, partials: tracker.state().partials }).toEqual({
      reps: exp.reps,
      partials: exp.partials,
    });
    if (exp.repFaults) expect(reps.map((r) => r.faults)).toEqual(exp.repFaults);
  });
});
