import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

export type ModelVariant = 'lite' | 'full';
export type Delegate = 'GPU' | 'CPU';

export interface LoadedLandmarker {
  landmarker: PoseLandmarker;
  model: ModelVariant;
  delegate: Delegate;
}

/** Creates a PoseLandmarker from local assets (public/wasm, public/models), GPU first with CPU fallback. */
export async function createLandmarker(model: ModelVariant = 'full'): Promise<LoadedLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks('/wasm');
  const make = (delegate: Delegate) =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `/models/pose_landmarker_${model}.task`, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  try {
    return { landmarker: await make('GPU'), model, delegate: 'GPU' };
  } catch (err) {
    console.warn('GPU delegate unavailable, falling back to CPU', err);
    return { landmarker: await make('CPU'), model, delegate: 'CPU' };
  }
}
