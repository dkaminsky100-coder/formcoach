import type { FaultId } from './faults';
import type { RepEvent } from './repStateMachine';

/** Target seconds for down / pause at the bottom / up. */
export interface TempoTarget {
  down: number;
  pause: number;
  up: number;
}

export const TEMPO_PRESETS = {
  free: null,
  standard: { down: 2, pause: 0, up: 1 },
  controlled: { down: 3, pause: 1, up: 1 },
} as const satisfies Record<string, TempoTarget | null>;

export type TempoPreset = keyof typeof TEMPO_PRESETS;

/** Descent faster than this fraction of the target is "too fast". */
const FAST_RATIO = 0.6;
/** Pause shorter than this fraction of the target is "no pause". */
const PAUSE_RATIO = 0.5;

export function tempoFaults(rep: RepEvent, target: TempoTarget | null): FaultId[] {
  if (!target) return [];
  const out: FaultId[] = [];
  if (rep.tDown < target.down * FAST_RATIO) out.push('fast_descent');
  if (target.pause > 0 && rep.tPause < target.pause * PAUSE_RATIO) out.push('no_pause');
  return out;
}

export function tempoLabel(t: TempoTarget | null): string {
  return t ? `${t.down}-${t.pause}-${t.up}` : 'free';
}
