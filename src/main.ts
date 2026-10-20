import './styles.css';
import { renderHistory } from './app/screens/history';
import { renderHome } from './app/screens/home';
import { renderLive } from './app/screens/live';
import type { ModelChoice, SourceSpec } from './app/LiveSession';
import type { ExerciseId } from './engine/exercises/ExerciseModel';

const root = document.querySelector<HTMLDivElement>('#app')!;
let lastExercise: ExerciseId = 'squat';

function showHome(error?: string, exercise?: ExerciseId) {
  if (exercise) lastExercise = exercise;
  renderHome(root, { onStart: showLive, onHistory: showHistory }, error, lastExercise);
}

function showLive(model: ModelChoice, exercise: ExerciseId, source: SourceSpec) {
  lastExercise = exercise;
  void renderLive(root, model, exercise, source, showHome, showHistory);
}

function showHistory() {
  void renderHistory(root, () => showHome());
}

showHome();
