import type { Phase } from './repStateMachine';
import type { EngineFrame, View } from './types';

export type FaultId =
  | 'knee_valgus'
  | 'forward_lean'
  | 'heel_lift'
  | 'weight_shift'
  | 'hip_sag'
  | 'hip_pike'
  | 'torso_lean'
  | 'fast_descent'
  | 'no_pause';

export interface FaultInfo {
  /** Spoken / banner cue. */
  cue: string;
  /** Short name for summaries. */
  title: string;
  /** Points deducted from the rep score. */
  weight: number;
  /** Lower = more important when several cues compete (safety first). */
  priority: number;
}

export const FAULT_INFO: Record<FaultId, FaultInfo> = {
  knee_valgus: { cue: 'Knees out', title: 'Knees caving in', weight: 25, priority: 1 },
  forward_lean: { cue: 'Chest up', title: 'Leaning forward', weight: 20, priority: 2 },
  heel_lift: { cue: 'Heels down', title: 'Heels lifting', weight: 15, priority: 3 },
  weight_shift: { cue: 'Even weight', title: 'Shifting to one side', weight: 15, priority: 4 },
  hip_sag: { cue: 'Hips up', title: 'Hips sagging', weight: 25, priority: 1 },
  hip_pike: { cue: 'Hips down', title: 'Hips too high', weight: 15, priority: 3 },
  torso_lean: { cue: 'Stay upright', title: 'Leaning forward', weight: 20, priority: 2 },
  fast_descent: { cue: 'Slow down', title: 'Too fast on the way down', weight: 10, priority: 5 },
  no_pause: { cue: 'Pause at the bottom', title: 'No pause at the bottom', weight: 5, priority: 6 },
};

/** How readily form issues are flagged. Thresholds were tuned on simulated bodies; this adapts them to real ones. */
export const STRICTNESS = {
  relaxed: 0.75,
  normal: 1,
  strict: 1.3,
} as const;

export type Strictness = keyof typeof STRICTNESS;

/** 100 minus the weight of each distinct fault, floored at 0. */
export function repScore(faults: readonly FaultId[]): number {
  const unique = new Set(faults);
  let score = 100;
  for (const f of unique) score -= FAULT_INFO[f].weight;
  return Math.max(0, score);
}

export interface FaultReading {
  /** Measured value ÷ threshold: ≥ 1 means the fault is present. */
  ratio: number;
  /** Landmarks to highlight while the fault is active. */
  joints: number[];
  /** Reference lines to draw (landmark index pairs), e.g. hip→ankle for knee tracking. */
  guides?: Array<[number, number]>;
}

/** Reference values captured while the user stands at the top, used by relative checks. */
export interface Baseline {
  /** toe.y − heel.y per side (px) when standing flat. */
  heelToe: { left: number | null; right: number | null };
  /** Hip-over-feet lateral offset ÷ stance width when standing. */
  shift: number | null;
}

export interface FaultContext {
  phase: Phase;
  progress: number;
  baseline: Baseline;
}

/** A per-frame check. Cue text, score weight and priority come from FAULT_INFO. */
export interface FaultDef {
  id: FaultId;
  views: readonly View[];
  /** Only evaluated once the rep is at least this deep (progress). */
  minProgress: number;
  measure(frame: EngineFrame, ctx: FaultContext): FaultReading | null;
}

export interface ActiveFault {
  id: FaultId;
  cue: string;
  joints: number[];
  guides: Array<[number, number]>;
}

export interface FaultMonitorOptions {
  /** A reading must stay over threshold this long before the fault turns on (ms). */
  onsetMs: number;
  /** Once on, the fault stays on until the ratio drops below this (hysteresis). */
  clearRatio: number;
  /** Time active within one rep for the fault to be recorded against that rep (ms). */
  repMinMs: number;
}

const DEFAULTS: FaultMonitorOptions = { onsetMs: 150, clearRatio: 0.8, repMinMs: 200 };

interface FaultState {
  overSince: number | null;
  active: boolean;
  repActiveMs: number;
  last: FaultReading | null;
}

/** Debounces per-frame fault readings and accumulates which faults occurred in each rep. */
export class FaultMonitor {
  private readonly opts: FaultMonitorOptions;
  private readonly states = new Map<FaultId, FaultState>();
  private lastT: number | null = null;
  /** Multiplies every reading: > 1 flags issues sooner (strict), < 1 later (relaxed). */
  sensitivity = 1;

  constructor(
    private readonly defs: readonly FaultDef[],
    opts: Partial<FaultMonitorOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
    for (const d of defs) this.states.set(d.id, { overSince: null, active: false, repActiveMs: 0, last: null });
  }

  /** Start accumulating a new rep. */
  beginRep(): void {
    for (const s of this.states.values()) s.repActiveMs = 0;
  }

  /** Faults that were active long enough during the rep just finished. */
  endRep(): FaultId[] {
    const out: FaultId[] = [];
    for (const d of this.defs) {
      const s = this.states.get(d.id)!;
      if (s.repActiveMs >= this.opts.repMinMs) out.push(d.id);
      s.repActiveMs = 0;
    }
    return out;
  }

  update(frame: EngineFrame | null, ctx: FaultContext | null, t: number): ActiveFault[] {
    const dt = this.lastT === null ? 0 : Math.min(100, Math.max(0, t - this.lastT));
    this.lastT = t;
    const active: ActiveFault[] = [];

    for (const d of this.defs) {
      const s = this.states.get(d.id)!;
      const reading =
        frame && ctx && ctx.phase !== 'top' && ctx.progress >= d.minProgress && d.views.includes(frame.features.view)
          ? d.measure(frame, ctx)
          : null;

      if (!reading) {
        s.overSince = null;
        s.active = false;
        s.last = null;
        continue;
      }
      s.last = reading;
      const ratio = reading.ratio * this.sensitivity;

      if (s.active) {
        if (ratio < this.opts.clearRatio) {
          s.active = false;
          s.overSince = null;
        }
      } else if (ratio >= 1) {
        s.overSince ??= t;
        if (t - s.overSince >= this.opts.onsetMs) s.active = true;
      } else {
        s.overSince = null;
      }

      if (s.active) {
        s.repActiveMs += dt;
        active.push({ id: d.id, cue: FAULT_INFO[d.id].cue, joints: reading.joints, guides: reading.guides ?? [] });
      }
    }
    return active;
  }

  reset(): void {
    for (const s of this.states.values()) Object.assign(s, { overSince: null, active: false, repActiveMs: 0, last: null });
    this.lastT = null;
  }
}

export function emptyBaseline(): Baseline {
  return { heelToe: { left: null, right: null }, shift: null };
}
