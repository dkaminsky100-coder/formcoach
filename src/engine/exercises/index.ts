import type { ExerciseId, ExerciseModel } from './ExerciseModel';
import { LungeModel } from './lunge';
import { PushupModel } from './pushup';
import { SquatModel } from './squat';

export const EXERCISES: ReadonlyArray<{ id: ExerciseId; name: string }> = [
  { id: 'squat', name: 'Squat' },
  { id: 'pushup', name: 'Push-up' },
  { id: 'lunge', name: 'Lunge' },
];

export function createExercise(id: ExerciseId): ExerciseModel {
  switch (id) {
    case 'squat':
      return new SquatModel();
    case 'pushup':
      return new PushupModel();
    case 'lunge':
      return new LungeModel();
  }
}
