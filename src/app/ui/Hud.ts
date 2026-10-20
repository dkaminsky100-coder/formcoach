import type { WorkoutState } from '../../engine/WorkoutTracker';
import type { CueAction } from '../../feedback/CueOrchestrator';

/** The gauge spans progress 0…GAUGE_MAX, so the target line (p = 1) sits below the top. */
const GAUGE_MAX = 1.25;

const PHASE_LABEL = {
  top: 'Ready',
  descending: 'Down',
  bottom: 'Bottom',
  ascending: 'Up',
} as const;

export const HUD_HTML = `
  <div class="hud-reps" id="hudReps">
    <span class="hud-label" id="hudExercise">SQUATS</span>
    <span class="hud-count" id="hudCount">0</span>
    <span class="hud-sub" id="hudPartials"></span>
    <span class="hud-score" id="hudScore"></span>
  </div>
  <div class="hud-gauge" id="hudGauge" title="Depth">
    <div class="hud-gauge-track">
      <div class="hud-gauge-fill" id="hudFill"></div>
      <div class="hud-gauge-best" id="hudBest"></div>
      <div class="hud-gauge-target" style="bottom: ${(100 / GAUGE_MAX).toFixed(1)}%"></div>
    </div>
    <span class="hud-phase" id="hudPhase">Ready</span>
  </div>
  <div class="hud-faults" id="hudFaults"></div>
  <div class="hud-banner" id="hudBanner"></div>
`;

const scoreClass = (s: number) => (s >= 85 ? 'good' : s >= 60 ? 'ok' : 'bad');

/** Rep counter, score, depth gauge, live fault chips and feedback banner over the video. */
export class Hud {
  private readonly label: HTMLElement;
  private readonly count: HTMLElement;
  private readonly partials: HTMLElement;
  private readonly score: HTMLElement;
  private readonly reps: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly best: HTMLElement;
  private readonly phase: HTMLElement;
  private readonly gauge: HTMLElement;
  private readonly faults: HTMLElement;
  private readonly banner: HTMLElement;
  private faultKey = '';
  private bannerTimer = 0;
  private pulseTimer = 0;

  constructor(root: HTMLElement) {
    const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
    this.label = $('hudExercise');
    this.count = $('hudCount');
    this.partials = $('hudPartials');
    this.score = $('hudScore');
    this.reps = $('hudReps');
    this.fill = $('hudFill');
    this.best = $('hudBest');
    this.phase = $('hudPhase');
    this.gauge = $('hudGauge');
    this.faults = $('hudFaults');
    this.banner = $('hudBanner');
  }

  setExercise(counterLabel: string): void {
    this.label.textContent = counterLabel;
  }

  update(s: WorkoutState): void {
    this.count.textContent = String(s.reps);
    const legs = s.legCounts && s.reps > 0 ? `L ${s.legCounts.left} · R ${s.legCounts.right}` : '';
    const partial = s.partials ? `${s.partials} not counted` : '';
    this.partials.innerHTML = [legs && `<span class="legs">${legs}</span>`, partial].filter(Boolean).join('<br>');
    if (s.lastRep?.counted && s.avgScore !== null) {
      this.score.innerHTML = `last <b class="${scoreClass(s.lastRep.score)}">${s.lastRep.score}</b> · avg <b class="${scoreClass(s.avgScore)}">${Math.round(s.avgScore)}</b>`;
    } else if (s.reps === 0) {
      this.score.textContent = '';
    }

    const pct = (p: number) => `${(Math.min(p, GAUGE_MAX) / GAUGE_MAX) * 100}%`;
    const measurable = s.progress !== null;
    this.gauge.classList.toggle('inactive', !measurable);
    this.fill.style.height = pct(s.progress ?? 0);
    this.best.style.bottom = pct(s.repDepth);
    this.best.hidden = s.repDepth <= 0;
    this.gauge.classList.toggle('deep', s.repDepth >= s.depthOk);
    this.phase.textContent = measurable ? PHASE_LABEL[s.phase] : '-';

    const key = s.activeFaults.map((f) => f.id).join();
    if (key !== this.faultKey) {
      this.faultKey = key;
      this.faults.innerHTML = s.activeFaults.map((f) => `<span class="hud-chip">${f.cue}</span>`).join('');
    }
  }

  apply(action: CueAction): void {
    if (action.banner) this.show(action.banner.text, action.banner.kind, action.banner.kind === 'good' ? 1000 : 1800);
    if (action.tone === 'rep') this.pulse(action.banner?.kind === 'warn' ? 'bad' : 'good');
    if (action.tone === 'partial') this.pulse('bad');
  }

  show(text: string, kind: 'good' | 'warn', ms: number): void {
    this.banner.textContent = text;
    this.banner.className = `hud-banner show ${kind}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), ms);
  }

  dispose(): void {
    clearTimeout(this.bannerTimer);
    clearTimeout(this.pulseTimer);
  }

  private pulse(kind: 'good' | 'bad'): void {
    this.reps.classList.remove('pulse-good', 'pulse-bad');
    void this.reps.offsetWidth; // restart the CSS animation
    this.reps.classList.add(`pulse-${kind}`);
    clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => this.reps.classList.remove(`pulse-${kind}`), 600);
  }
}
