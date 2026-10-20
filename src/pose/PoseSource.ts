import type { Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision';

/** One tracked pose. `image` is normalized to the (unmirrored) frame; `world` is metric, hip-centered. */
export interface PoseFrame {
  /** Milliseconds, monotonic. */
  t: number;
  image: NormalizedLandmark[];
  world: Landmark[];
  width: number;
  height: number;
}

export class CameraError extends Error {}

const CAMERA_ERRORS: Record<string, string> = {
  NotAllowedError: 'Camera permission was denied. Allow camera access in the browser address bar and try again.',
  NotFoundError: 'No camera was found. Connect a webcam and try again.',
  NotReadableError: 'The camera is in use by another app (Zoom, Teams, Camera…). Close it and try again.',
  OverconstrainedError: 'The camera does not support the requested resolution.',
};

/** Something that plays frames into a <video> element for the pose model. */
export interface MediaSource {
  readonly video: HTMLVideoElement;
  readonly width: number;
  readonly height: number;
  start(): Promise<void>;
  stop(): void;
}

/** A video file chosen by the user, played once through the pose model. */
export class VideoFileSource implements MediaSource {
  private url: string | null = null;

  constructor(
    readonly video: HTMLVideoElement,
    private readonly file: File,
  ) {}

  async start(): Promise<void> {
    this.url = URL.createObjectURL(this.file);
    const v = this.video;
    v.muted = true;
    v.playsInline = true;
    v.loop = false;
    await new Promise<void>((resolve, reject) => {
      v.onloadedmetadata = () => resolve();
      v.onerror = () => reject(new CameraError(`Could not open "${this.file.name}". Try an .mp4 or .webm video.`));
      v.src = this.url!;
    });
    await v.play();
  }

  get width(): number {
    return this.video.videoWidth;
  }

  get height(): number {
    return this.video.videoHeight;
  }

  stop(): void {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}

/** Live webcam feed into a <video> element. */
export class CameraSource implements MediaSource {
  private stream: MediaStream | null = null;
  /** Called if the camera stops on its own (unplugged, taken by another app, permission revoked). */
  onLost: (() => void) | null = null;

  constructor(readonly video: HTMLVideoElement) {}

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError('This browser does not support camera access. Use Chrome or Edge.');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      throw new CameraError(CAMERA_ERRORS[name] ?? `Could not start the camera: ${String(err)}`);
    }
    this.stream.getVideoTracks()[0]?.addEventListener('ended', () => this.onLost?.());
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
  }

  get width(): number {
    return this.video.videoWidth;
  }

  get height(): number {
    return this.video.videoHeight;
  }

  get frameRate(): number | undefined {
    return this.stream?.getVideoTracks()[0]?.getSettings().frameRate;
  }

  stop(): void {
    this.onLost = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
