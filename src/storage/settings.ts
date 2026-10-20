import type { ExerciseId } from '../engine/exercises/ExerciseModel';
import type { Strictness } from '../engine/faults';
import type { TempoPreset } from '../engine/tempo';
import type { ModelVariant } from '../pose/landmarker';

/** Preferences remembered between sessions (localStorage, this browser only). */
export interface Settings {
  model: 'auto' | ModelVariant;
  muted: boolean;
  tempo: TempoPreset;
  strictness: Strictness;
  /** Selected depth option per exercise. */
  depth: Partial<Record<ExerciseId, string>>;
  showStats: boolean;
  showAnalysis: boolean;
}

const KEY = 'formcoach.settings.v1';

const DEFAULTS: Settings = {
  model: 'auto',
  muted: false,
  tempo: 'free',
  strictness: 'normal',
  depth: {},
  showStats: false,
  showAnalysis: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, depth: {} };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed, depth: { ...parsed.depth } };
  } catch {
    // Storage blocked or corrupt: fall back to defaults rather than failing.
    return { ...DEFAULTS, depth: {} };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not persisted this time; the app keeps working.
  }
  return next;
}
