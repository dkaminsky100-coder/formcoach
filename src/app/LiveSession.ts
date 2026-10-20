import { Engine } from '../engine/Engine';
import type { ExerciseId, ExerciseModel } from '../engine/exercises/ExerciseModel';
import { createExercise } from '../engine/exercises';
import { SetupFlow, type Calibration, type SetupStatus } from '../engine/setup';
import type { SetSource } from '../engine/summary';
import type { EngineFrame, RawPose } from '../engine/types';
import { WorkoutTracker, type RepSummary, type WorkoutState } from '../engine/WorkoutTracker';
import { createLandmarker, type Delegate, type LoadedLandmarker, type ModelVariant } from '../pose/landmarker';
import { CameraSource, VideoFileSource, type MediaSource, type PoseFrame } from '../pose/PoseSource';
import { decodeFrame, Recorder, type Recording } from '../pose/recording';
import { PerfMonitor, QUALITY_LADDER, type PerfSnapshot } from '../perf/PerfMonitor';
import { Overlay } from '../render/Overlay';

export type ModelChoice = 'auto' | ModelVariant;

/** Where frames come from. */
export type SourceSpec =
  | { kind: 'camera' }
  | { kind: 'video'; file: File }
  | { kind: 'recording'; recording: Recording; name: string };

export interface SessionStatus extends PerfSnapshot {
  model: ModelVariant;
  delegate: Delegate;
  skip: number;
  auto: boolean;
  width: number;
  height: number;
  personVisible: boolean;
}

export interface SessionHandlers {
  onFrame?: (frame: EngineFrame | null) => void;
  /** Called every processed frame; `rep` is set on the frame a rep (or partial rep) completes. */
  onWorkout?: (state: WorkoutState, rep: RepSummary | null, t: number) => void;
  onQualityChange?: (message: string) => void;
  /** Called every processed frame while in setup mode. */
  onSetup?: (status: SetupStatus) => void;
  /** Setup finished: counting starts now. */
  onCalibrated?: (cal: Calibration) => void;
  /** A video file or recording reached its end. */
  onEnded?: () => void;
  /** The camera stopped unexpectedly. */
  onSourceLost?: () => void;
}

/** setup: checklist + calibration; active: counting; paused: tracking shown, nothing counted. */
export type SessionMode = 'setup' | 'active' | 'paused';

/** Brightness is sampled every N camera frames on a tiny canvas. */
const LUMINANCE_EVERY = 10;

/** Owns source → pose model → engine → overlay for one session (live camera or file replay). */
export class LiveSession {
  private readonly media: MediaSource | null;
  private readonly overlay: Overlay;
  private readonly perf = new PerfMonitor({ warmupSamples: 10 });
  private readonly recorder = new Recorder();
  readonly engine = new Engine();
  private _exercise: ExerciseModel;
  private _workout: WorkoutTracker;
  private _setup: SetupFlow;
  private _mode: SessionMode;
  private luminance: number | null = null;
  private lumCtx: CanvasRenderingContext2D | null = null;
  private lm: LoadedLandmarker | null = null;
  private swapping = false;
  private running = false;
  private choice: ModelChoice;
  private ladderIndex = 0;
  private skip = 1;
  private frameCount = 0;
  private lastTimestamp = 0;
  private lastFrame: EngineFrame | null = null;
  private rafId = 0;
  private replayIndex = 0;
  private replayClock = 0;
  private replayWall = 0;
  /** Playback speed for recordings. */
  speed = 1;

  constructor(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    choice: ModelChoice,
    exercise: ExerciseId,
    readonly source: SourceSpec,
    private readonly handlers: SessionHandlers = {},
  ) {
    this.media =
      source.kind === 'camera'
        ? new CameraSource(video)
        : source.kind === 'video'
          ? new VideoFileSource(video, source.file)
          : null;
    // Only the selfie camera is shown mirrored.
    this.overlay = new Overlay(canvas, source.kind === 'camera');
    this.choice = choice;
    this._exercise = createExercise(exercise);
    this._workout = new WorkoutTracker(this._exercise);
    this._setup = new SetupFlow(this._exercise);
    // Files are analysed as-is: no setup checklist, standing posture is learned.
    this._mode = source.kind === 'camera' ? 'setup' : 'active';
  }

  get kind(): SetSource {
    return this.source.kind;
  }

  get video(): HTMLVideoElement | null {
    return this.media?.video ?? null;
  }

  get exercise(): ExerciseModel {
    return this._exercise;
  }

  get workout(): WorkoutTracker {
    return this._workout;
  }

  get setup(): SetupFlow {
    return this._setup;
  }

  get frameSize(): { width: number; height: number } {
    if (this.source.kind === 'recording') return this.source.recording;
    return { width: this.media?.width ?? 0, height: this.media?.height ?? 0 };
  }

  /** Switch exercise: fresh counter and calibration, back to setup (camera only). */
  setExercise(id: ExerciseId): void {
    const tempo = this._workout.tempo;
    this._exercise = createExercise(id);
    this._workout = new WorkoutTracker(this._exercise);
    this._workout.tempo = tempo;
    this._setup = new SetupFlow(this._exercise);
    this._mode = this.source.kind === 'camera' ? 'setup' : 'active';
  }

  get mode(): SessionMode {
    return this._mode;
  }

  /** Back to the checklist and calibration. Rep counting pauses until it completes. */
  beginSetup(): void {
    this._mode = 'setup';
    this.setup.reset();
  }

  /** Start counting without calibrating (learned defaults are used). */
  skipSetup(): void {
    this._mode = 'active';
  }

  /** Stop counting (e.g. while the set summary is shown); tracking keeps drawing. */
  pause(): void {
    if (this._mode === 'active') this._mode = 'paused';
    if (this.source.kind === 'video') this.media?.video.pause();
  }

  resume(): void {
    if (this._mode === 'paused') this._mode = 'active';
    const v = this.media?.video;
    if (this.source.kind === 'video' && v && !v.ended) void v.play();
  }

  get recording(): boolean {
    return this.recorder.active;
  }

  get recordedFrames(): number {
    return this.recorder.frameCount;
  }

  startRecording(): void {
    const { width, height } = this.frameSize;
    this.recorder.start(width, height, this._exercise.id);
  }

  stopRecording(): Recording | null {
    return this.recorder.stop();
  }

  async start(): Promise<void> {
    if (this.source.kind === 'recording') {
      const { width, height } = this.source.recording;
      this.overlay.resize(width, height);
      this.running = true;
      this.replayWall = performance.now();
      this.rafId = requestAnimationFrame(this.replayTick);
      return;
    }
    const media = this.media!;
    const initial: ModelVariant = this.choice === 'auto' ? QUALITY_LADDER[0].model : this.choice;
    // Load the model and open the camera / file in parallel; both take a moment.
    const [lm] = await Promise.all([createLandmarker(initial), media.start()]);
    this.lm = lm;
    this.overlay.resize(media.width, media.height);
    if (this.source.kind === 'video') media.video.onended = () => this.handlers.onEnded?.();
    if (media instanceof CameraSource) media.onLost = () => this.handlers.onSourceLost?.();
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.recorder.stop();
    if (this.media) this.media.video.onended = null;
    this.media?.stop();
    this.lm?.landmarker.close();
    this.lm = null;
    this.engine.reset();
    this.workout.reset();
    this.setup.reset();
    this.lastFrame = null;
    this.overlay.clear();
  }

  /** Manual override from the UI; 'auto' re-enables adaptive quality starting from the top step. */
  async setModel(choice: ModelChoice): Promise<void> {
    this.choice = choice;
    this.ladderIndex = 0;
    this.skip = 1;
    const target = choice === 'auto' ? QUALITY_LADDER[0].model : choice;
    await this.swapModel(target);
  }

  /** Latest analysed frame, or null when no person is tracked. */
  get latest(): EngineFrame | null {
    return this.lastFrame;
  }

  status(): SessionStatus {
    const { width, height } = this.frameSize;
    return {
      ...this.perf.snapshot(),
      model: this.lm?.model ?? 'full',
      delegate: this.lm?.delegate ?? 'GPU',
      skip: this.skip,
      auto: this.choice === 'auto',
      width,
      height,
      personVisible: this.lastFrame !== null,
    };
  }

  private schedule(): void {
    if (!this.running || !this.media) return;
    const video = this.media.video;
    if ('requestVideoFrameCallback' in video) {
      video.requestVideoFrameCallback((now) => this.onVideoFrame(now));
    } else {
      this.rafId = requestAnimationFrame((now) => this.onVideoFrame(now));
    }
  }

  private onVideoFrame(now: number): void {
    if (!this.running || !this.media) return;
    this.schedule();

    const video = this.media.video;
    if (!this.lm || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    this.perf.recordCameraFrame(now);
    this.overlay.resize(video.videoWidth, video.videoHeight);
    if (this.frameCount++ % this.skip !== 0) return;

    // detectForVideo requires strictly increasing timestamps.
    const ts = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = ts;

    const t0 = performance.now();
    const result = this.lm.landmarker.detectForVideo(video, ts);
    this.perf.recordInference(performance.now() - t0, now);

    const image = result.landmarks[0];
    const pose: PoseFrame | null = image
      ? { t: ts, image, world: result.worldLandmarks[0] ?? [], width: video.videoWidth, height: video.videoHeight }
      : null;
    if (this._mode === 'setup' && this.frameCount % LUMINANCE_EVERY === 1) this.luminance = this.sampleLuminance(video);
    this.handlePose(pose, ts);
    this.maybeAdapt(now);
  }

  /** Replays a recording in (scaled) real time, skipping the pose model entirely. */
  private replayTick = (now: number): void => {
    if (this.source.kind !== 'recording' || !this.running) return;
    const { frames, width, height } = this.source.recording;
    if (this._mode !== 'paused') this.replayClock += (now - this.replayWall) * this.speed;
    this.replayWall = now;
    while (this.replayIndex < frames.length && frames[this.replayIndex].t <= this.replayClock) {
      const f = frames[this.replayIndex++];
      this.perf.recordCameraFrame(now);
      this.handlePose(decodeFrame(f, width, height), f.t + 1);
    }
    if (this.replayIndex >= frames.length) {
      this.handlers.onEnded?.();
      return;
    }
    this.rafId = requestAnimationFrame(this.replayTick);
  };

  private handlePose(pose: RawPose | null, ts: number): void {
    if (this.recorder.active) this.recorder.add(pose, ts);
    const frame = pose ? this.engine.process(pose) : null;
    this.lastFrame = frame;

    if (this._mode === 'setup') {
      const { status, calibration } = this.setup.update(frame, this.luminance, ts);
      this.overlay.draw(frame);
      this.handlers.onFrame?.(frame);
      this.handlers.onSetup?.(status);
      if (calibration) {
        this.workout.addCalibration(calibration);
        this._mode = 'active';
        this.handlers.onCalibrated?.(calibration);
      }
    } else if (this._mode === 'paused') {
      this.overlay.draw(frame);
      this.handlers.onFrame?.(frame);
    } else {
      const { state, rep } = this.workout.update(frame, ts);
      this.overlay.draw(frame, state.activeFaults);
      this.handlers.onFrame?.(frame);
      this.handlers.onWorkout?.(state, rep, ts);
    }
  }

  /** Mean brightness (0-255) of a 32×18 thumbnail of the frame. */
  private sampleLuminance(video: HTMLVideoElement): number | null {
    try {
      if (!this.lumCtx) {
        const c = document.createElement('canvas');
        c.width = 32;
        c.height = 18;
        this.lumCtx = c.getContext('2d', { willReadFrequently: true });
      }
      const ctx = this.lumCtx;
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, 32, 18);
      const d = ctx.getImageData(0, 0, 32, 18).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      return sum / (d.length / 4);
    } catch {
      return null;
    }
  }

  private maybeAdapt(now: number): void {
    if (this.choice !== 'auto' || this.swapping) return;
    if (!this.perf.shouldDowngrade(now, this.skip)) return;
    if (this.ladderIndex >= QUALITY_LADDER.length - 1) return;

    const prev = QUALITY_LADDER[this.ladderIndex];
    const next = QUALITY_LADDER[++this.ladderIndex];
    this.skip = next.skip;
    this.perf.resetInference();
    if (next.model !== prev.model) void this.swapModel(next.model);
    this.handlers.onQualityChange?.(
      `Lowering quality to keep up: ${next.model} model${next.skip > 1 ? `, every ${next.skip}nd frame` : ''}`,
    );
  }

  /** Loads the new model while the old one keeps running, then swaps. */
  private async swapModel(model: ModelVariant): Promise<void> {
    if (this.lm?.model === model || this.source.kind === 'recording') return;
    this.swapping = true;
    try {
      const next = await createLandmarker(model);
      if (!this.running) {
        next.landmarker.close();
        return;
      }
      const old = this.lm;
      this.lm = next;
      this.lastTimestamp = 0;
      this.perf.resetInference();
      old?.landmarker.close();
    } finally {
      this.swapping = false;
    }
  }
}
