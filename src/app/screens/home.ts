import { EXERCISES } from '../../engine/exercises';
import type { ExerciseId } from '../../engine/exercises/ExerciseModel';
import { missingAssets } from '../../pose/assets';
import { parseRecording } from '../../pose/recording';
import { loadSettings, saveSettings } from '../../storage/settings';
import type { ModelChoice, SourceSpec } from '../LiveSession';

export interface HomeHandlers {
  onStart: (model: ModelChoice, exercise: ExerciseId, source: SourceSpec) => void;
  onHistory: () => void;
}

const BLURB: Record<ExerciseId, string> = {
  squat: 'Side-on or facing the camera',
  pushup: 'Side-on, head to one side',
  lunge: 'Side-on or facing the camera',
};

export function renderHome(
  root: HTMLElement,
  { onStart, onHistory }: HomeHandlers,
  error?: string,
  lastExercise: ExerciseId = 'squat',
): void {
  root.innerHTML = `
    <section class="home">
      <h1>FormCoach</h1>
      <p class="subtitle">Real-time workout form feedback - runs entirely on this computer.</p>
      <div class="card">
        <div class="field">Exercise
          <div class="exercise-picker" id="picker">
            ${EXERCISES.map(
              (e) => `
              <label class="exercise-option">
                <input type="radio" name="exercise" value="${e.id}" ${e.id === lastExercise ? 'checked' : ''} />
                <span class="exercise-name">${e.name}</span>
                <span class="exercise-blurb">${BLURB[e.id]}</span>
              </label>`,
            ).join('')}
          </div>
        </div>
        <label class="field">Pose model
          <select id="model">
            <option value="auto" selected>Auto (recommended)</option>
            <option value="full">Full - more accurate</option>
            <option value="lite">Lite - faster</option>
          </select>
        </label>
        <button id="start" class="primary" disabled>Checking files…</button>
        <div class="home-secondary">
          <button id="history">📊 History</button>
          <button id="analyze" disabled title="A video (.mp4 / .webm) or a FormCoach landmark recording (.json)">📂 Analyze a file…</button>
          <input type="file" id="file" accept="video/*,.json,application/json" hidden />
        </div>
        <p id="msg" class="msg ${error ? 'bad' : ''}">${error ?? ''}</p>
      </div>
      <p class="detail">Tip: stand 2-3 m from the camera so your whole body, including your feet, is in view.</p>
    </section>
  `;

  const start = root.querySelector<HTMLButtonElement>('#start')!;
  const model = root.querySelector<HTMLSelectElement>('#model')!;
  model.value = loadSettings().model;
  model.addEventListener('change', () => saveSettings({ model: model.value as ModelChoice }));
  const msg = root.querySelector<HTMLParagraphElement>('#msg')!;

  missingAssets().then((missing) => {
    if (missing.length > 0) {
      start.textContent = 'Setup required';
      msg.className = 'msg bad';
      msg.textContent = `Missing ${missing.join(', ')} - run "npm run setup" in the project folder, then reload.`;
      return;
    }
    start.disabled = false;
    analyze.disabled = false;
    start.textContent = 'Start camera';
  });

  const analyze = root.querySelector<HTMLButtonElement>('#analyze')!;
  const fileInput = root.querySelector<HTMLInputElement>('#file')!;
  const picked = () =>
    (root.querySelector<HTMLInputElement>('input[name="exercise"]:checked')?.value ?? 'squat') as ExerciseId;

  start.addEventListener('click', () => onStart(model.value as ModelChoice, picked(), { kind: 'camera' }));
  root.querySelector('#history')!.addEventListener('click', onHistory);
  analyze.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const isJson = file.name.toLowerCase().endsWith('.json') || file.type === 'application/json';
    if (!isJson) {
      if (!file.type.startsWith('video/')) {
        msg.className = 'msg bad';
        msg.textContent = `"${file.name}" is not a video or a FormCoach recording.`;
        return;
      }
      onStart(model.value as ModelChoice, picked(), { kind: 'video', file });
      return;
    }
    try {
      const recording = parseRecording(JSON.parse(await file.text()));
      onStart(model.value as ModelChoice, recording.exercise ?? picked(), { kind: 'recording', recording, name: file.name });
    } catch (err) {
      msg.className = 'msg bad';
      msg.textContent = err instanceof SyntaxError ? `"${file.name}" is not valid JSON.` : (err as Error).message;
    }
  });
}
