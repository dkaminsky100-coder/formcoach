/**
 * Low-latency beeps (Web Audio, synthesised - no sound files) and spoken words
 * (speechSynthesis with a local voice, so it works offline).
 * Construct it inside a click handler so the browser allows audio.
 */
export class AudioEngine {
  private readonly ctx: AudioContext | null;
  private voice: SpeechSynthesisVoice | null = null;
  muted = false;

  constructor() {
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {
      // No Web Audio: beeps are skipped, speech still works.
    }
    this.ctx = ctx;
    if ('speechSynthesis' in window) {
      this.pickVoice();
      speechSynthesis.addEventListener('voiceschanged', this.pickVoice);
    }
  }

  /** Call from any user gesture in case the context started suspended. */
  unlock(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  tone(kind: 'rep' | 'warn' | 'partial'): void {
    if (kind === 'rep') {
      this.beep(880, 0.09);
    } else if (kind === 'warn') {
      this.beep(520, 0.12);
    } else {
      this.beep(330, 0.1);
      this.beep(330, 0.1, 0.14);
    }
  }

  /**
   * `interrupt`: cut off whatever is being said (corrections must be timely).
   * Otherwise queue after it, but never behind more than one utterance (a stale count is useless).
   */
  say(text: string, interrupt = true): void {
    if (this.muted || !('speechSynthesis' in window)) return;
    if (interrupt || speechSynthesis.pending) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.15;
    if (this.voice) u.voice = this.voice;
    speechSynthesis.speak(u);
  }

  beep(freq: number, seconds: number, delay = 0, volume = 0.18): void {
    const ctx = this.ctx;
    if (this.muted || !ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // Short attack/decay envelope avoids clicks.
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + seconds + 0.02);
  }

  close(): void {
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      speechSynthesis.removeEventListener('voiceschanged', this.pickVoice);
    }
    void this.ctx?.close();
  }

  private pickVoice = (): void => {
    const english = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
    this.voice = english.find((v) => v.localService) ?? english[0] ?? null;
  };
}
