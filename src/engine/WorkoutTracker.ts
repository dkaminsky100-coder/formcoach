import { BaselineTracker } from './baseline';
import type { ExerciseModel } from './exercises/ExerciseModel';
import { FaultMonitor, repScore, type ActiveFault, type FaultId } from './faults';
import { smoothingFactor } from './math/oneEuro';
import { RepStateMachine, type Phase, type RepConfig, type RepEvent } from './repStateMachine';
import type { Calibration } from './setup';
import { tempoFaults, type TempoTarget } from './tempo';
import type { BodySide, EngineFrame, View } from './types';

/** A completed rep (or partial rep) with its form assessment. */
export interface RepSummary extends RepEvent {
  /** Form faults recorded during the rep, including tempo. */
  faults: FaultId[];
  /** 0-100 for counted reps; 0 for partial reps. */
  score: number;
  /** Working leg (lunges), sampled at the deepest point. */
  side: BodySide | null;
}

export interface WorkoutState {
  exercise: string;
  phase: Phase;
  /** Current progress (0 top → 1 target depth), null when not measurable. */
  progress: number | null;
  /** Progress per second; positive = going down. */
  velocity: number;
  /** Deepest progress in the rep in progress. */
  repDepth: number;
  /** Depth needed for a rep to count. */
  depthOk: number;
  reps: number;
  partials: number;
  lastRep: RepSummary | null;
  /** Average score of counted reps, null before the first. */
  avgScore: number | null;
  /** Faults happening right now (debounced). */
  activeFaults: ActiveFault[];
  /** Counted reps per working leg, for exercises that alternate legs; null otherwise. */
  legCounts: { left: number; right: number } | null;
}

/** Low-pass cutoff for the progress velocity (Hz). */
const VELOCITY_CUTOFF = 3;
/** Standing posture is only learned when this close to the top. */
const BASELINE_MAX_PROGRESS = 0.1;

/** Exercise model + rep state machine + form checks: EngineFrame stream → rep summaries. */
export class WorkoutTracker {
  private readonly fsm: RepStateMachine;
  private monitor: FaultMonitor;
  private readonly baseline = new BaselineTracker();
  private prevP: number | null = null;
  private prevT: number | null = null;
  private velocity = 0;
  private lastRep: RepSummary | null = null;
  private progress: number | null = null;
  private activeFaults: ActiveFault[] = [];
  private scoreSum = 0;
  private readonly calibrations = new Map<View, Calibration>();
  private appliedView: View | null = null;
  private repSide: BodySide | null = null;
  private repSideDepth = -1;
  private readonly legCounts = { left: 0, right: 0 };
  private repLog: RepSummary[] = [];
  tempo: TempoTarget | null = null;

  constructor(
    public model: ExerciseModel,
    config: Partial<RepConfig> = {},
  ) {
    this.fsm = new RepStateMachine(config);
    this.monitor = new FaultMonitor(model.faults);
  }

  /** Use a measured standing posture whenever the user is in this calibration's view. */
  addCalibration(cal: Calibration): void {
    this.calibrations.set(cal.view, cal);
    this.model.calibrate(cal);
    this.appliedView = null;
  }

  isCalibrated(view: View): boolean {
    return this.calibrations.has(view);
  }

  /** Fault threshold multiplier: > 1 flags issues sooner (strict), < 1 later (relaxed). */
  get sensitivity(): number {
    return this.monitor.sensitivity;
  }

  set sensitivity(v: number) {
    this.monitor.sensitivity = v;
  }

  update(frame: EngineFrame | null, t: number): { state: WorkoutState; rep: RepSummary | null } {
    if (frame?.identityChanged) {
      this.fsm.cancel();
      this.monitor.reset();
    }
    if (frame && frame.features.view !== this.appliedView) {
      // Heel and hip-centring baselines are view-specific: re-seed when the view changes.
      const cal = this.calibrations.get(frame.features.view);
      if (cal) this.baseline.seed(cal);
      this.appliedView = frame.features.view;
    }

    const p = frame ? this.model.progress(frame) : null;
    this.updateVelocity(p, t);
    this.progress = p;

    const before = this.fsm.phase;
    const event = this.fsm.update(p, this.velocity, t);
    const phase = this.fsm.phase;

    if (frame && p !== null && phase === 'top' && p < BASELINE_MAX_PROGRESS) this.baseline.observe(frame);
    if (before === 'top' && phase === 'descending') {
      this.monitor.beginRep();
      this.repSide = null;
      this.repSideDepth = -1;
    }
    if (frame && p !== null && phase !== 'top' && this.model.repSide && p > this.repSideDepth) {
      this.repSideDepth = p;
      this.repSide = this.model.repSide(frame) ?? this.repSide;
    }

    this.activeFaults = this.monitor.update(
      frame,
      p === null ? null : { phase, progress: p, baseline: this.baseline.value },
      t,
    );

    let rep: RepSummary | null = null;
    if (event) {
      const formFaults = this.monitor.endRep();
      const faults = event.counted ? [...formFaults, ...tempoFaults(event, this.tempo)] : formFaults;
      const score = event.counted ? repScore(faults) : 0;
      if (event.counted) this.scoreSum += score;
      const side = this.model.repSide ? this.repSide : null;
      if (event.counted && side) this.legCounts[side]++;
      rep = { ...event, faults, score, side };
      this.lastRep = rep;
      this.repLog.push(rep);
    }
    return { state: this.state(), rep };
  }

  state(): WorkoutState {
    const reps = this.fsm.count;
    return {
      exercise: this.model.name,
      phase: this.fsm.phase,
      progress: this.progress,
      velocity: this.velocity,
      repDepth: this.fsm.maxDepth,
      depthOk: this.fsm.config.depthOk,
      reps,
      partials: this.fsm.partials,
      lastRep: this.lastRep,
      avgScore: reps > 0 ? this.scoreSum / reps : null,
      activeFaults: this.activeFaults,
      legCounts: this.model.repSide ? { ...this.legCounts } : null,
    };
  }

  /** Every rep and partial rep of the current set, in order. */
  repHistory(): readonly RepSummary[] {
    return this.repLog;
  }

  /** Clears the counter and scores (keeps the learned standing posture). */
  resetCount(): void {
    this.repLog = [];
    this.fsm.reset();
    this.monitor.reset();
    this.lastRep = null;
    this.scoreSum = 0;
    this.activeFaults = [];
    this.legCounts.left = 0;
    this.legCounts.right = 0;
  }

  reset(): void {
    this.resetCount();
    this.model.reset();
    this.baseline.reset();
    this.calibrations.clear();
    this.appliedView = null;
    this.prevP = null;
    this.prevT = null;
    this.velocity = 0;
    this.progress = null;
  }

  private updateVelocity(p: number | null, t: number): void {
    if (p === null) {
      this.prevP = null;
      this.velocity = 0;
      return;
    }
    if (this.prevP !== null && this.prevT !== null && t > this.prevT) {
      const dt = (t - this.prevT) / 1000;
      const raw = (p - this.prevP) / dt;
      this.velocity += smoothingFactor(dt, VELOCITY_CUTOFF) * (raw - this.velocity);
    }
    this.prevP = p;
    this.prevT = t;
  }
}
