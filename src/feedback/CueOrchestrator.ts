import { FAULT_INFO, type ActiveFault, type FaultId } from '../engine/faults';
import type { RepIssue } from '../engine/repStateMachine';
import type { RepSummary } from '../engine/WorkoutTracker';

export type Tone = 'rep' | 'warn' | 'partial';

export interface CueAction {
  speak?: string;
  /** Interrupt whatever is being said (corrections) or queue after it (rep counts). */
  interrupt?: boolean;
  tone?: Tone;
  banner?: { text: string; kind: 'good' | 'warn' };
}

export interface CueOptions {
  /** Minimum gap between spoken corrections (ms). Rep counts ignore it. */
  speechGapMs: number;
  /** The same correction isn't repeated within this time (ms). */
  cooldownMs: number;
}

const DEFAULTS: CueOptions = { speechGapMs: 1200, cooldownMs: 4000 };

export const ISSUE_TEXT: Record<RepIssue, string> = {
  shallow: 'Go lower',
  too_fast: 'Too fast - control the rep',
};

/**
 * Decides what to say and show, so feedback is timely but not nagging:
 * one correction at a time, most important first, each with a cooldown;
 * rep counts are always spoken.
 */
export class CueOrchestrator {
  private readonly opts: CueOptions;
  private lastCueAt = -Infinity;
  private readonly lastById = new Map<FaultId, number>();
  /** Faults already called out during the current rep (not repeated at rep end). */
  private readonly cuedThisRep = new Set<FaultId>();
  private prevActive = new Set<FaultId>();

  constructor(opts: Partial<CueOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /** Mid-rep: call out a fault the moment it becomes active, if allowed. */
  onFrame(active: readonly ActiveFault[], t: number): CueAction | null {
    const newlyActive = active.filter((f) => !this.prevActive.has(f.id));
    this.prevActive = new Set(active.map((f) => f.id));
    if (newlyActive.length === 0 || t - this.lastCueAt < this.opts.speechGapMs) return null;

    const pick = [...newlyActive]
      .sort((a, b) => FAULT_INFO[a.id].priority - FAULT_INFO[b.id].priority)
      .find((f) => this.offCooldown(f.id, t));
    if (!pick) return null;

    this.markCued(pick.id, t);
    return { speak: pick.cue, interrupt: true, tone: 'warn', banner: { text: pick.cue, kind: 'warn' } };
  }

  onRep(rep: RepSummary, t: number): CueAction {
    const cued = new Set(this.cuedThisRep);
    this.cuedThisRep.clear();

    if (!rep.counted) {
      const text = rep.issue ? ISSUE_TEXT[rep.issue] : 'Not counted';
      this.lastCueAt = t;
      return { speak: text, interrupt: true, tone: 'partial', banner: { text, kind: 'warn' } };
    }

    const count = String(rep.count);
    if (rep.faults.length === 0) {
      return { speak: count, tone: 'rep', banner: { text: `Good rep · ${rep.score}`, kind: 'good' } };
    }

    // Faults not already called out mid-rep (typically tempo) ride along with the count.
    const fresh = [...rep.faults]
      .filter((f) => !cued.has(f) && this.offCooldown(f, t))
      .sort((a, b) => FAULT_INFO[a].priority - FAULT_INFO[b].priority)[0];
    const top = [...rep.faults].sort((a, b) => FAULT_INFO[a].priority - FAULT_INFO[b].priority)[0];
    if (fresh) this.markCued(fresh, t);

    return {
      speak: fresh ? `${count}. ${FAULT_INFO[fresh].cue}` : count,
      tone: 'rep',
      banner: { text: `${rep.score} · ${FAULT_INFO[fresh ?? top].title}`, kind: 'warn' },
    };
  }

  reset(): void {
    this.lastCueAt = -Infinity;
    this.lastById.clear();
    this.cuedThisRep.clear();
    this.prevActive.clear();
  }

  private offCooldown(id: FaultId, t: number): boolean {
    return t - (this.lastById.get(id) ?? -Infinity) >= this.opts.cooldownMs;
  }

  private markCued(id: FaultId, t: number): void {
    this.lastCueAt = t;
    this.lastById.set(id, t);
    this.cuedThisRep.add(id);
  }
}
