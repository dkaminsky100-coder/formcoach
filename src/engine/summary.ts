import type { ExerciseId } from './exercises/ExerciseModel';
import { FAULT_INFO, type FaultId } from './faults';
import type { RepIssue } from './repStateMachine';
import type { BodySide } from './types';
import type { RepSummary } from './WorkoutTracker';

export type SetSource = 'camera' | 'video' | 'recording';

export interface RepRecord {
  n: number;
  counted: boolean;
  issue: RepIssue | null;
  score: number;
  /** Deepest point as % of target depth. */
  depthPct: number;
  tDown: number;
  tPause: number;
  tUp: number;
  faults: FaultId[];
  side: BodySide | null;
}

/** One finished set, as stored in history. */
export interface SetRecord {
  id: string;
  /** ISO timestamp of when the set was finished. */
  date: string;
  exercise: ExerciseId;
  exerciseName: string;
  depthLabel: string;
  tempoLabel: string;
  source: SetSource;
  reps: number;
  partials: number;
  avgScore: number | null;
  bestScore: number | null;
  durationS: number;
  avgTempo: { down: number; pause: number; up: number } | null;
  /** Counted reps each fault appeared in. */
  faultCounts: Partial<Record<FaultId, number>>;
  legCounts: { left: number; right: number } | null;
  repList: RepRecord[];
}

export interface SetMeta {
  id?: string;
  date?: Date;
  exercise: ExerciseId;
  exerciseName: string;
  depthLabel: string;
  tempoLabel: string;
  source: SetSource;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

export function summarizeSet(reps: readonly RepSummary[], meta: SetMeta): SetRecord {
  const date = meta.date ?? new Date();
  const counted = reps.filter((r) => r.counted);
  const scores = counted.map((r) => r.score);

  const faultCounts: Partial<Record<FaultId, number>> = {};
  for (const r of counted) for (const f of new Set(r.faults)) faultCounts[f] = (faultCounts[f] ?? 0) + 1;

  const sides = counted.map((r) => r.side).filter((s): s is BodySide => s !== null);
  const legCounts = sides.length
    ? { left: sides.filter((s) => s === 'left').length, right: sides.filter((s) => s === 'right').length }
    : null;

  return {
    id: meta.id ?? `${date.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    date: date.toISOString(),
    exercise: meta.exercise,
    exerciseName: meta.exerciseName,
    depthLabel: meta.depthLabel,
    tempoLabel: meta.tempoLabel,
    source: meta.source,
    reps: counted.length,
    partials: reps.length - counted.length,
    avgScore: scores.length ? Math.round(mean(scores)) : null,
    bestScore: scores.length ? Math.max(...scores) : null,
    durationS: reps.length ? r1((reps[reps.length - 1].tEnd - reps[0].tStart) / 1000) : 0,
    avgTempo: counted.length
      ? {
          down: r1(mean(counted.map((r) => r.tDown))),
          pause: r1(mean(counted.map((r) => r.tPause))),
          up: r1(mean(counted.map((r) => r.tUp))),
        }
      : null,
    faultCounts,
    legCounts,
    repList: reps.map((r, i) => ({
      n: i + 1,
      counted: r.counted,
      issue: r.issue,
      score: r.score,
      depthPct: Math.round(r.maxDepth * 100),
      tDown: r1(r.tDown),
      tPause: r1(r.tPause),
      tUp: r1(r.tUp),
      faults: [...new Set(r.faults)],
      side: r.side,
    })),
  };
}

/** Faults by how many reps they appeared in, most frequent first. */
export function topFaults(rec: SetRecord): Array<{ id: FaultId; title: string; count: number }> {
  return (Object.entries(rec.faultCounts) as Array<[FaultId, number]>)
    .map(([id, count]) => ({ id, title: FAULT_INFO[id].title, count }))
    .sort((a, b) => b.count - a.count || FAULT_INFO[a.id].priority - FAULT_INFO[b.id].priority);
}

const csvCell = (v: string | number | boolean | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per rep, so it opens straight into a spreadsheet. */
export function setsToCsv(sets: readonly SetRecord[]): string {
  const header = [
    'date', 'exercise', 'set_id', 'rep', 'counted', 'issue', 'score', 'depth_pct',
    'down_s', 'pause_s', 'up_s', 'faults', 'leg', 'depth_target', 'tempo_target', 'source',
  ];
  const rows = sets.flatMap((s) =>
    s.repList.map((r) => [
      s.date, s.exerciseName, s.id, r.n, r.counted, r.issue, r.score, r.depthPct,
      r.tDown, r.tPause, r.tUp, r.faults.map((f) => FAULT_INFO[f].title).join('; '), r.side,
      s.depthLabel, s.tempoLabel, s.source,
    ]),
  );
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
