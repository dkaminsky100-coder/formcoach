import type { TempoTarget } from '../engine/tempo';
import type { AudioEngine } from './AudioEngine';

/** Standing time between metronome reps (s). */
const REST_S = 1;

/**
 * Beeps the target tempo so the user can follow it:
 * high tick = start going down, mid = bottom (start of pause), low = start coming up.
 */
export class Metronome {
  private timer = 0;

  constructor(private readonly audio: AudioEngine) {}

  get running(): boolean {
    return this.timer !== 0;
  }

  start(tempo: TempoTarget): void {
    this.stop();
    const cycle = tempo.down + tempo.pause + tempo.up + REST_S;
    const play = () => {
      this.audio.beep(1200, 0.06);
      this.audio.beep(800, 0.06, tempo.down);
      if (tempo.pause > 0) this.audio.beep(800, 0.06, tempo.down + tempo.pause);
      this.audio.beep(500, 0.08, tempo.down + tempo.pause);
    };
    play();
    this.timer = window.setInterval(play, cycle * 1000);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = 0;
  }
}
