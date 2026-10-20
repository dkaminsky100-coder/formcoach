export type Phase = 'top' | 'descending' | 'bottom' | 'ascending';

/** Why a rep wasn't counted. */
export type RepIssue = 'shallow' | 'too_fast';

export interface RepEvent {
  /** Counted reps so far, including this one if counted. */
  count: number;
  counted: boolean;
  issue: RepIssue | null;
  /** Deepest progress reached (1 = target depth). */
  maxDepth: number;
  tStart: number;
  tEnd: number;
  /** Phase durations in seconds: down (eccentric), pause at the bottom, up (concentric). */
  tDown: number;
  tPause: number;
  tUp: number;
}

export interface RepConfig {
  /** Progress above which a descent can start. */
  enter: number;
  /** Progress below which the user is back at the top (hysteresis: < enter). */
  exit: number;
  /** Minimum depth before a bottom (turnaround) is recognised. */
  bottomMin: number;
  /** Dips shallower than this are ignored as fidgeting rather than reported as partial reps. */
  partialMin: number;
  /** Depth needed for the rep to count. */
  depthOk: number;
  /** Progress velocity (1/s) that counts as moving down / up. */
  vMove: number;
  /** Velocity at or below which the descent has stopped. */
  vStill: number;
  /** Consecutive frames a transition condition must hold. */
  confirmFrames: number;
  minRepMs: number;
  /** A rep still unfinished after this long is abandoned (user sat down, walked off…). */
  maxRepMs: number;
  /** Tracking lost for longer than this abandons the current rep. */
  lostResetMs: number;
}

export const DEFAULT_REP_CONFIG: RepConfig = {
  enter: 0.15,
  exit: 0.1,
  bottomMin: 0.35,
  partialMin: 0.3,
  depthOk: 0.92,
  vMove: 0.1,
  vStill: 0.05,
  confirmFrames: 3,
  minRepMs: 600,
  maxRepMs: 10_000,
  lostResetMs: 1500,
};

/**
 *   top ──(p>enter, moving down)──► descending ──(stopped, deep enough)──► bottom
 *    ▲                                  │ (back above exit: shallow dip)       │ (moving up)
 *    └───────────(p<exit) rep complete ◄┴──────────── ascending ◄─────────────┘
 *
 * Fed progress p (0 = top, 1 = target depth) and its velocity each frame. While p is null
 * (not measurable) the machine freezes instead of guessing.
 */
export class RepStateMachine {
  private readonly c: RepConfig;
  private _phase: Phase = 'top';
  private _count = 0;
  private _partials = 0;
  private _maxDepth = 0;
  private streak = 0;
  private repStart = 0;
  private bottomAt: number | null = null;
  private ascentAt: number | null = null;
  private lostSince: number | null = null;
  /** False after an abandoned rep until the user is back at the top, so a held squat doesn't re-trigger. */
  private armed = true;

  constructor(config: Partial<RepConfig> = {}) {
    this.c = { ...DEFAULT_REP_CONFIG, ...config };
  }

  get phase(): Phase {
    return this._phase;
  }

  get count(): number {
    return this._count;
  }

  get partials(): number {
    return this._partials;
  }

  /** Deepest progress in the rep in progress (0 at the top). */
  get maxDepth(): number {
    return this._phase === 'top' ? 0 : this._maxDepth;
  }

  get config(): Readonly<RepConfig> {
    return this.c;
  }

  /** Drop the rep in progress (e.g. a different person appeared); wait for the top before counting again. */
  cancel(): void {
    this.abandon(false);
  }

  reset(): void {
    this.abandon();
    this._count = 0;
    this._partials = 0;
    this.lostSince = null;
  }

  update(p: number | null, v: number, t: number): RepEvent | null {
    const c = this.c;
    if (p === null) {
      this.lostSince ??= t;
      if (this._phase !== 'top' && t - this.lostSince > c.lostResetMs) this.abandon(false);
      return null;
    }
    this.lostSince = null;

    if (this._phase !== 'top') {
      this._maxDepth = Math.max(this._maxDepth, p);
      if (t - this.repStart > c.maxRepMs) {
        this.abandon(false);
        return null;
      }
    }

    switch (this._phase) {
      case 'top':
        if (!this.armed) {
          if (p < c.exit) this.armed = true;
          break;
        }
        if (this.confirm(p > c.enter && (v > c.vMove || p > c.bottomMin))) {
          this.go('descending');
          this.repStart = t;
          this._maxDepth = p;
          this.bottomAt = null;
          this.ascentAt = null;
        }
        break;
      case 'descending':
        if (p < c.exit) return this.finish(t);
        if (this.confirm(v <= c.vStill && this._maxDepth >= c.bottomMin)) {
          this.go('bottom');
          this.bottomAt = t;
        }
        break;
      case 'bottom':
        if (this.confirm(v < -c.vMove)) {
          this.go('ascending');
          this.ascentAt = t;
        }
        break;
      case 'ascending':
        if (this.confirm(p < c.exit)) return this.finish(t);
        break;
    }
    return null;
  }

  private confirm(cond: boolean): boolean {
    this.streak = cond ? this.streak + 1 : 0;
    return this.streak >= this.c.confirmFrames;
  }

  private go(phase: Phase): void {
    this._phase = phase;
    this.streak = 0;
  }

  private abandon(armed = true): void {
    this.go('top');
    this._maxDepth = 0;
    this.armed = armed;
  }

  private finish(t: number): RepEvent | null {
    const depth = this._maxDepth;
    this.abandon();
    if (depth < this.c.partialMin) return null;

    const issue: RepIssue | null =
      depth < this.c.depthOk ? 'shallow' : t - this.repStart < this.c.minRepMs ? 'too_fast' : null;
    if (issue === null) this._count++;
    else this._partials++;

    const bottom = this.bottomAt ?? t;
    const ascent = this.ascentAt ?? bottom;
    return {
      count: this._count,
      counted: issue === null,
      issue,
      maxDepth: depth,
      tStart: this.repStart,
      tEnd: t,
      tDown: (bottom - this.repStart) / 1000,
      tPause: (ascent - bottom) / 1000,
      tUp: (t - ascent) / 1000,
    };
  }
}
