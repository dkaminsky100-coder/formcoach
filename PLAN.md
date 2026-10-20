# FormCoach: plan for a local, real-time workout form evaluator

A program that runs entirely on your computer. It reads your webcam, tracks your skeleton in real time with **MediaPipe Pose Landmarker**, counts reps for **squats, push-ups and lunges**, and gives instant **visual and audio cues** on **depth, joint alignment and tempo**. No server, no cloud and no account: video frames never leave the machine.

---

## 1. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Delivery | A **local web app** served on `http://localhost` (runs in Chrome or Edge), with an optional desktop wrapper later | Webcam access, GPU inference and audio are all built into the browser. The same code runs on Windows, macOS, Linux and mobile browsers, which covers the "cross-platform mobile or web module" requirement. |
| Language | **TypeScript** | One language for the UI and the engine. The engine can later be dropped into the React Native app (snap-fitness). |
| Pose model | **`@mediapipe/tasks-vision` → `PoseLandmarker`** (`full` model by default, `lite` on slow machines) | 33 landmarks including heels and toes, metric 3D "world landmarks", runs on the GPU through WebGL, typically 30+ FPS on a laptop. Better accuracy than PoseNet, and PoseNet is deprecated. |
| Offline | Model files and WASM runtime are **copied into the project** (`public/models`, `public/wasm`), with no CDN at runtime | Makes it truly local: after setup it works with Wi-Fi off. |
| Build tool | **Vite** | Instant dev server and a simple static build. |
| Rendering | HTML `<video>` plus a `<canvas>` 2D overlay | Simple and fast enough for a skeleton and HUD at 60 Hz. |
| Audio | **Web Audio API** (pre-decoded cue sounds and beeps) plus **`speechSynthesis`** using a local Windows voice | Low-latency beeps, with spoken words for cues that are less time-critical. |
| Storage | **IndexedDB** for session history; CSV/JSON export | Local and persistent, with no backend. |
| Tests | **Vitest** for the math, state machine and replay fixtures | The engine is pure TypeScript, so it is fully unit-testable without a camera. |

**Why not Python?** The machine has Python 3.14, and MediaPipe's Python wheels usually lag behind new Python releases. A Python/OpenCV build would also be harder to port to mobile. Node 24 is already installed, so the web stack needs no extra installs.

---

## 2. Requirements

### Functional
1. Live webcam view with a skeleton overlay.
2. Exercise selection: **Squat, Push-up, Lunge**.
3. Automatic **rep counting**. Partial reps are detected and reported, not counted.
4. Real-time cues on:
   - **Depth**: "go lower" or "good depth" (squat and lunge knee angle, push-up elbow angle).
   - **Joint alignment**: knee caving (valgus), forward trunk lean, hip sag or pike (push-up), knee past toes or torso lean (lunge), left/right asymmetry.
   - **Tempo**: time in each phase (down / pause / up) compared with a target tempo such as 3-1-1, with "slow down" cues and an optional metronome.
5. Visual cues: joints and bones colored green, amber or red; an on-screen text banner; a depth gauge; a tempo bar.
6. Audio cues: spoken rep count, short corrective phrases and beeps. Every type can be muted.
7. A **setup assistant** that checks camera angle, full-body visibility, distance and lighting before a set starts.
8. A **calibration** step: stand still for about 2 seconds to capture your baseline proportions.
9. A session summary at the end of each set: reps, partial reps, a per-rep form score, top faults and average tempo. Stored in history.
10. A **replay mode**: run the analyzer on a recorded `.mp4` or a saved landmark recording. This is used for testing and tuning.

### Non-functional
- **Fully offline** after `npm run setup`.
- **30 FPS or more** pose tracking on a typical laptop with an integrated GPU. Degrade gracefully on slower machines.
- **Under 100 ms** from movement to visual cue; under 250 ms to audio cue.
- No video or image is ever written to disk unless the user explicitly records a session.

---

## 3. Architecture

```
┌──────────────────────────── Browser tab (localhost) ───────────────────────────┐
│                                                                                │
│  Webcam ─► <video> ─► requestVideoFrameCallback loop                           │
│                          │                                                     │
│                          ▼                                                     │
│   ┌────────────────────────────┐                                               │
│   │ PoseSource                 │  PoseLandmarker.detectForVideo(video, ts)     │
│   │  (live camera | mp4 file | │  → 33 image landmarks + 33 world landmarks     │
│   │   JSON recording)          │                                               │
│   └─────────────┬──────────────┘                                               │
│                 ▼  PoseFrame {t, image[33], world[33]}                         │
│   ┌───────────────────────────────────────────────────────────┐               │
│   │ ENGINE (pure TS, no DOM - portable to React Native)       │               │
│   │  1. Preprocess: pixel-space, mirror, visibility gating    │               │
│   │  2. Smooth: One Euro filter per coordinate                │               │
│   │  3. Normalize: hip-centered, scaled by leg length         │               │
│   │  4. View classifier: front / side / oblique               │               │
│   │  5. Features: joint angles, distances, velocities         │               │
│   │  6. ExerciseModel (squat|pushup|lunge):                   │               │
│   │       progress signal p∈[0,1] → Rep state machine          │               │
│   │       fault detectors → debounced fault flags             │               │
│   │       tempo tracker → phase durations                     │               │
│   │  7. emits EngineOutput (every frame) + RepEvent (per rep)  │               │
│   └─────────────┬─────────────────────────────────────────────┘               │
│                 ▼                                                              │
│   ┌──────────────────┐   ┌───────────────────┐   ┌─────────────────────┐       │
│   │ Overlay renderer │   │ Cue orchestrator  │   │ Session recorder    │       │
│   │ (canvas 2D)      │   │ priority+cooldown │   │ IndexedDB, export   │       │
│   └──────────────────┘   │ → AudioEngine     │   └─────────────────────┘       │
│                          │ → banner text     │                                 │
│                          └───────────────────┘                                 │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Golden rule:** the `engine/` folder has **zero** imports from the DOM, MediaPipe or the UI. It takes plain landmark arrays and returns plain objects. That makes it:
- testable with Vitest from recorded JSON,
- runnable in a Web Worker later,
- portable to the React Native app as-is.

---

## 4. Project structure

```
project 1/
├─ PLAN.md
├─ package.json
├─ vite.config.ts
├─ index.html
├─ scripts/
│  └─ setup-assets.mjs        # downloads .task models, copies MediaPipe wasm → public/
├─ public/
│  ├─ models/                 # pose_landmarker_lite.task, pose_landmarker_full.task
│  ├─ wasm/                   # copied from node_modules/@mediapipe/tasks-vision/wasm
│  └─ sounds/                 # beep.wav, good.wav, warn.wav (small, pre-made)
├─ src/
│  ├─ main.ts                 # app bootstrap
│  ├─ app/
│  │  ├─ App.ts               # screen routing: Home → Setup → Calibrate → Live → Summary
│  │  ├─ screens/             # HomeScreen, SetupScreen, LiveScreen, SummaryScreen, HistoryScreen
│  │  └─ ui/                  # HUD widgets: RepCounter, DepthGauge, TempoBar, CueBanner
│  ├─ pose/
│  │  ├─ PoseSource.ts        # interface + CameraSource, VideoFileSource, RecordingSource
│  │  ├─ landmarker.ts        # PoseLandmarker creation (GPU → CPU fallback)
│  │  └─ landmarks.ts         # index constants (L_HIP = 23, …) + bone list
│  ├─ engine/                 # PURE TS - no DOM
│  │  ├─ types.ts
│  │  ├─ math/vec.ts          # vector ops, joint angle, line distance
│  │  ├─ math/oneEuro.ts
│  │  ├─ preprocess.ts        # pixel space, mirroring, visibility gating
│  │  ├─ normalize.ts
│  │  ├─ view.ts              # front / side classification
│  │  ├─ features.ts
│  │  ├─ repStateMachine.ts
│  │  ├─ tempo.ts
│  │  ├─ faults.ts            # generic debounced detector
│  │  ├─ calibration.ts
│  │  ├─ exercises/
│  │  │  ├─ ExerciseModel.ts  # interface
│  │  │  ├─ squat.ts
│  │  │  ├─ pushup.ts
│  │  │  └─ lunge.ts
│  │  └─ Engine.ts            # orchestrates all of the above
│  ├─ feedback/
│  │  ├─ CueOrchestrator.ts
│  │  ├─ AudioEngine.ts       # Web Audio + speechSynthesis
│  │  └─ cues.ts              # cue catalogue: id, text, priority, sound
│  ├─ render/
│  │  └─ Overlay.ts           # skeleton, angle arcs, colored joints, guides
│  ├─ storage/
│  │  └─ history.ts           # IndexedDB wrapper, CSV export
│  └─ perf/
│     └─ PerfMonitor.ts       # FPS, inference ms, adaptive quality
└─ tests/
   ├─ fixtures/               # recorded landmark JSON (good squat, valgus squat, …)
   ├─ math.test.ts
   ├─ repStateMachine.test.ts
   └─ exercises.test.ts
```

---

## 5. Pose tracking layer

### 5.1 Landmarker setup (offline, GPU with CPU fallback)

```ts
// src/pose/landmarker.ts
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

export async function createLandmarker(model: 'lite' | 'full' = 'full') {
  const fileset = await FilesetResolver.forVisionTasks('/wasm'); // local, not CDN
  const make = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `/models/pose_landmarker_${model}.task`, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  try { return await make('GPU'); } catch { return await make('CPU'); }
}
```

### 5.2 Frame loop

- Use `video.requestVideoFrameCallback`, which fires once per **new** camera frame, rather than `requestAnimationFrame`, so the same frame is never processed twice.
- Request the camera at **1280×720 @ 30 fps**: `getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 } })`.
- Call `detectForVideo(video, timestampMs)` with **strictly increasing** timestamps.
- If inference is slower than the frame interval, new frames are simply skipped. Never build up a queue.

```ts
const loop = (_now: number, meta: VideoFrameCallbackMetadata) => {
  const t = meta.mediaTime * 1000;
  const res = landmarker.detectForVideo(video, performance.now());
  if (res.landmarks[0]) engine.push({ t, image: res.landmarks[0], world: res.worldLandmarks[0] });
  else engine.pushMissing(t);
  video.requestVideoFrameCallback(loop);
};
video.requestVideoFrameCallback(loop);
```

### 5.3 PoseSource abstraction

All three sources produce the same `PoseFrame` stream:
- `CameraSource` for live webcam use,
- `VideoFileSource` to run on an `.mp4` (testing, or analyzing a recorded set),
- `RecordingSource` to replay a saved `landmarks.json` with no ML at all (deterministic tests).

### 5.4 Adaptive performance

`PerfMonitor` keeps a rolling p50 and p95 of inference time:
- If p95 is over 40 ms for 3 s, switch `full → lite`.
- If it is still too slow, process every second frame. Smoothing and interpolation keep the overlay fluid.
- A dev overlay (toggle with `D`) shows FPS, inference ms, model and delegate.
- **Later:** move inference into a Web Worker using `ImageBitmap` transfer so the UI thread never blocks.

---

## 6. Engine: math and algorithms

### 6.1 Landmarks used (MediaPipe indices)

`0 nose · 7/8 ears · 11/12 shoulders · 13/14 elbows · 15/16 wrists · 23/24 hips · 25/26 knees · 27/28 ankles · 29/30 heels · 31/32 foot index (toes)`. Even numbers are the right side.

### 6.2 Preprocessing
1. **Convert to pixel space** before any geometry: `(x·W, y·H)`. MediaPipe's normalized coordinates scale x and y differently on a 16:9 frame, so angles computed on them are wrong.
2. **Mirroring:** show the video mirrored, as users expect, but keep the engine in unmirrored coordinates so "left knee" really means the user's left knee.
3. **Visibility gating:** a landmark is valid only if `visibility ≥ 0.5` and it lies inside the frame. A metric is computed only if **all** of its landmarks are valid. Otherwise the metric is `null`, never a guess.

### 6.3 Smoothing: One Euro filter (per coordinate)

```
cutoff = minCutoff + β·|ẋ̂|
α      = 1 / (1 + τ/Δt),  τ = 1/(2π·cutoff)
x̂ₜ     = α·xₜ + (1−α)·x̂ₜ₋₁
```

Starting values: `minCutoff = 1.5 Hz`, `β = 0.02`, `dCutoff = 1 Hz`. This gives low jitter when you stand still and low lag when you move fast. Filter the landmarks first, then compute angles.

### 6.4 Normalization
- **Origin:** hip midpoint `H = (L_HIP + R_HIP)/2`.
- **Scale:** leg length `L = |hip−knee| + |knee−ankle|`, captured at calibration. This path length does not change when the knee bends.
- **Angles** are scale-invariant and need no normalization. **Distances and velocities** are divided by `L`, so the same thresholds work for any body height or camera distance.
- **Tilt:** at calibration, the line from ankle midpoint to hip midpoint while standing defines "vertical". Measure trunk lean against that line instead of the image's y-axis, so a slightly tilted laptop camera doesn't create false lean faults.

### 6.5 Joint angle (core formula)

For joints A–B–C, the interior angle at B:

```
u = A − B,  v = C − B
θ = atan2(|u × v|, u · v)        (degrees = θ·180/π)
```

Use `atan2` rather than `acos(u·v / |u||v|)`; the `acos` form is numerically unstable near 0° and 180° (a straight leg).

```ts
// src/engine/math/vec.ts
export type V = { x: number; y: number; z?: number };
export function jointAngle(a: V, b: V, c: V): number {
  const ux = a.x - b.x, uy = a.y - b.y, uz = (a.z ?? 0) - (b.z ?? 0);
  const vx = c.x - b.x, vy = c.y - b.y, vz = (c.z ?? 0) - (b.z ?? 0);
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return Math.atan2(Math.hypot(cx, cy, cz), ux * vx + uy * vy + uz * vz) * 180 / Math.PI;
}
/** Signed perpendicular distance of P from line A→B (2D). */
export function lineOffset(p: V, a: V, b: V): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  return ((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.hypot(dx, dy);
}
/** Angle of segment A→B from vertical (2D, image y points down). */
export function inclinationFromVertical(a: V, b: V): number {
  return Math.atan2(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 180 / Math.PI;
}
```

**2D or 3D?**
- **Side view:** the motion happens in the image plane, so use **2D pixel landmarks**. They are the most accurate there.
- **Front view:** knee flexion is foreshortened in 2D, so compute flexion from the **3D world landmarks**. Valgus is measured in **2D**, because it is by definition a frontal-plane projection.

### 6.6 View classification

```
shoulderSpread = |Lshoulder.x − Rshoulder.x| / torsoLength
front  if shoulderSpread > 0.55
side   if shoulderSpread < 0.25
oblique otherwise → prompt: "Turn so the camera sees your side" (or front)
```

Each fault detector declares which views it supports and is disabled in the others.

| Exercise | Recommended view | Also works |
|---|---|---|
| Squat | Side (depth, lean, tempo) | Front (valgus, asymmetry) |
| Push-up | Side | – |
| Lunge | Side | Front (knee tracking) |

### 6.7 Progress signal and rep state machine

Each exercise maps features to **progress `p ∈ [0,1]`**: 0 at the top, 1 at the target depth.

```
squat:   p = clamp((θknee_top − θknee) / (θknee_top − θknee_target), 0, 1)     θtarget ≈ 90°
pushup:  p = clamp((θelbow_top − θelbow) / (θelbow_top − θelbow_target), 0, 1) θtarget ≈ 90°
lunge:   p from front-knee angle (target ≈ 90°), with the front leg picked by the lower knee angle
```

Fallback signal for a squat when the knees are unreliable: vertical hip drop divided by leg length, `p_hip = (y_hip − y_hip_top) / (0.45·L)`. The two signals are fused, weighted by landmark confidence.

Velocity `ṗ` comes from the filtered derivative.

```
          p>0.12 & ṗ>+0.15/s (3 frames)          ṗ≤0 & max p>0.35 (3 frames)
  TOP ─────────────────────────────► DESCENDING ───────────────────────────► BOTTOM
   ▲                                  │ p<0.08 (gave up → "partial rep")        │
   │◄─────────────────────────────────┘                                       │ ṗ<−0.15/s
   │                                                                          ▼ (3 frames)
   └──────────────── p<0.08 (3 frames) → REP COMPLETE ◄──────────────── ASCENDING
```

- **Hysteresis:** the enter threshold (0.12) is above the exit threshold (0.08), so jitter can't toggle states.
- **Confirmation frames (3):** a single noisy frame never triggers a transition.
- **Valid rep:** the duration is 0.6–10 s **and** the depth reached `max p ≥ 0.9`. Otherwise the event is emitted as a **partial rep** with the cue "go lower". It is shown but not counted.
- **Tracking lost:** the state machine **freezes** (no transitions). If tracking is lost for more than 1.5 s, it resets to TOP and the current rep is discarded.

```ts
// src/engine/repStateMachine.ts (shape)
export type Phase = 'TOP' | 'DESCENDING' | 'BOTTOM' | 'ASCENDING';
export interface RepEvent {
  index: number; counted: boolean; maxDepth: number;
  tDown: number; tPause: number; tUp: number;   // tempo (seconds)
  faults: FaultId[]; score: number;             // 0–100
}
export class RepStateMachine {
  update(p: number, v: number, t: number, valid: boolean): RepEvent | null { /* per diagram */ }
}
```

### 6.8 Fault detectors

Every detector returns a **severity value** each frame. A generic `DebouncedFault` raises the flag only after the value has been over threshold for **at least 150 ms** in the phases where the detector applies, and clears it with hysteresis. Per rep, a fault counts if it was active in **≥ 25 %** of that rep's frames.

**All thresholds are starting defaults** to tune with your own recordings (section 11).

**Squat**

| Fault | View | Metric | Flag when |
|---|---|---|---|
| Not deep enough | side / front | `max p` for the rep | < 0.9 at the bottom |
| Knee valgus (caving) | front | Knee offset from the hip→ankle line, positive = toward the midline, ÷ L | > 0.06 during DESCENDING, BOTTOM or ASCENDING |
| Knee valgus (alternative) | front | Knee-to-ankle width ratio `|Kₗ−Kᵣ|ₓ / |Aₗ−Aᵣ|ₓ` | < 0.8 × the calibration value |
| Excessive forward lean | side | Trunk inclination − tibia inclination | > 20° |
| Heels lifting | side | (heel y at top − heel y now) ÷ L | > 0.03 |
| Asymmetry or weight shift | front | (hip-mid x − ankle-mid x) ÷ stance width, or `|θknee_L − θknee_R|` | > 0.15, or > 12° |

**Push-up**

| Fault | Metric | Flag when |
|---|---|---|
| Not deep enough | Minimum elbow angle | > 100° |
| Hip sag | Hip offset below the shoulder→ankle line ÷ L | > 0.08 |
| Hip pike | Hip offset above that line ÷ L | > 0.10 |
| Partial lockout | Elbow angle at the top | < 155° |
| Head drop | Ear offset below the shoulder→hip line | > threshold |

**Lunge**

| Fault | Metric | Flag when |
|---|---|---|
| Not deep enough | Front knee angle | > 100°, or back knee not near the floor |
| Front knee far past toes | Side view: (knee x − toe x) ÷ L, along the facing direction | > 0.10 (informational, not a hard fault) |
| Torso lean | Trunk inclination | > 15° |
| Front-knee caving | Front view: knee offset from the hip→ankle line | > 0.06 |

**A limitation to state honestly:** pose landmarks have no points along the spine. The app can detect trunk lean and changes in the head and shoulder position, but **not true lumbar rounding**. Present it as "chest up / keep torso upright", not as a spinal diagnosis.

### 6.9 Tempo tracking

The state machine timestamps every transition, so each rep yields:
- `tDown`: time in DESCENDING (eccentric),
- `tPause`: time in BOTTOM,
- `tUp`: time in ASCENDING (concentric).

The user picks a target tempo (presets: *Controlled 3-1-1*, *Standard 2-0-1*, *Free*). Cues:
- `tDown < 0.6 × target` → "Slow down on the way down".
- `tPause < 0.3 s` when a pause is required → "Pause at the bottom".
- Rep-to-rep slowdown of more than 40 % from the first reps → "Fatigue detected" (informational).
- **Optional metronome:** Web Audio beeps on the target phase boundaries.

Live display: a tempo bar fills during each phase, green if within ±25 % of target, otherwise amber.

### 6.10 Rep score (0–100)

```
score = 100 − 30·[shallow] − 25·[valgus] − 20·[lean] − 10·[heels] − 15·[tempo off] … (floor at 0)
```

Shown per rep and averaged per set. The weights live in each exercise's config.

### 6.11 Exercise plug-in interface

```ts
export interface ExerciseModel {
  id: 'squat' | 'pushup' | 'lunge';
  supportedViews: View[];
  requiredLandmarks: number[];
  progress(f: Features, cal: Calibration): number | null;
  faults: FaultDetector[];
  scoreWeights: Partial<Record<FaultId, number>>;
}
```

Adding a new exercise means adding one file in `engine/exercises/`, with no changes to the engine.

---

## 7. Calibration and setup assistant

**Setup checks**, shown as a live checklist before the Start button is enabled:
1. **Full body in frame:** nose, ankles and heels are visible, with a margin of at least 5 % of the frame.
2. **Distance:** the body bounding box covers 50–90 % of the frame height.
3. **View:** matches the exercise's recommended view (classifier from 6.6).
4. **Lighting:** mean luminance of a downscaled frame is above a threshold, and average landmark visibility is ≥ 0.7.
5. **Single person:** with `numPoses = 2` during setup only, warn if two people are detected.

**Calibration** (stand still for 2 s, detected when `|ṗ|` stays near 0):
- leg length `L`, torso length,
- top joint angles (`θknee_top`, `θelbow_top` in plank),
- heel baseline y, knee-to-ankle width ratio, and the "vertical" reference line.

The calibration result is cached per exercise and view for the session.

---

## 8. Feedback system

### 8.1 Cue orchestrator rules
- **Priority:** safety (valgus, hip sag) > depth > alignment > tempo > encouragement.
- **One cue at a time.** There is a global gap of at least 1.2 s between spoken cues.
- **Per-cue cooldown of 4 s**, so the same cue doesn't repeat every rep.
- **Timing:**
  - *Visual* cues are immediate and continuous: joint colors and the banner.
  - *Audio corrective* cues play while the fault is active (for example "knees out" mid-descent).
  - *Rep count* is spoken at rep completion.
  - *Summary* feedback plays at the end of the set.
- **Positive reinforcement:** "Good rep" after a clean rep, at most once every 3 reps.

### 8.2 Audio engine
- At startup, pre-decode short WAVs (`beep`, `good`, `warn`) into `AudioBuffer`s and play them with `AudioBufferSourceNode`. Latency is about 10–30 ms.
- For words, use `speechSynthesis` with a voice where `localService === true` (built-in Windows voices). It works offline. Rep numbers can be pre-queued.
- The audio context is unlocked by the user's click on **Start**, which satisfies the browser autoplay policy.

### 8.3 Visual overlay
- Bones drawn in 4 px lines. Joints are colored by status: green ok, amber borderline, red faulty.
- An **angle arc** with a number at the key joint (knee or elbow).
- **Guide lines:** the hip→ankle line in front view for valgus; the shoulder→ankle line for push-ups.
- HUD: rep counter, depth gauge (vertical bar with a target line), tempo bar, cue banner, and phase label.

### 8.4 Latency budget

| Stage | Time |
|---|---|
| Camera exposure and capture | ~33 ms |
| Pose inference (GPU) | ~10–25 ms |
| Engine | < 1 ms |
| Canvas draw (next display frame) | ≤ 16 ms |
| **Visual cue total** | **≈ 60–80 ms** |
| Fault debounce | +150 ms |
| **Audio cue total** | **≈ 220–250 ms** |

---

## 9. Edge cases and mitigations

| Case | Mitigation |
|---|---|
| Limb occluded (far leg in side view) | Use the **near-side** leg, picked by higher visibility. Metrics needing hidden points return `null`. The state machine freezes rather than guessing. |
| Person partly out of frame | The setup check blocks Start. Mid-set, a banner says "Step back", and counting pauses. |
| Backlight (window behind the user) or a dim room | Luminance and visibility checks in setup with a tip ("Face the light source"). Raise the confidence thresholds. |
| Loose or baggy clothing | Hip and knee jitter: fuse the hip-drop signal with the knee angle, widen the valgus threshold, and weight confidence by landmark visibility. |
| Dark clothes on a dark background | Low visibility scores trigger a setup warning. |
| Oblique camera angle | View classifier prompts the user to turn. Only metrics valid for that view stay on. |
| Second person walks in | `numPoses: 1` already tracks the most prominent person. Also lock onto the subject by bounding-box overlap with the previous frame and ignore sudden jumps. |
| Laptop camera tilted | The calibration "vertical" reference corrects lean angles. |
| Very fast reps or motion blur | One Euro filter tuning. Reps shorter than 0.6 s are flagged instead of counted. Tip: more light means a faster shutter. |
| Fidgeting or walking between sets | Requires the calibrated standing posture **and** a movement pattern before counting starts. Very small `p` changes are ignored by hysteresis. |
| Slow machine | Adaptive `full → lite` model and frame skipping (5.4). |
| Camera permission denied or no camera | Clear error screen. Replay mode still works with video files. |

---

## 10. Data, privacy and storage

- Nothing is uploaded, and the app makes no network calls after setup. (Optional check: add a CSP `connect-src 'self'` in `index.html`.)
- History is stored in IndexedDB: `sessions { id, date, exercise, view, reps[], avgScore, avgTempo, faultsCount }`.
- Export to **CSV and JSON** from the History screen.
- "Record landmarks" toggle: saves `landmarks.json` (numbers only, no video) for debugging and building test fixtures.

---

## 11. Testing and tuning strategy

1. **Unit tests (Vitest):**
   - `jointAngle` on known triangles (0°, 90°, 180°, collinear),
   - One Euro filter convergence,
   - state machine with synthetic sine-wave `p` signals: exact rep counts, partial reps, and noise spikes that must not count.
2. **Fixture tests:** record 10–20 short landmark clips (good squats, shallow squats, valgus squats, sagging push-ups, …). Each test asserts its rep count and the expected faults.
3. **Video replay:** run `VideoFileSource` on recorded `.mp4`s to tune thresholds visually with sliders in the dev panel (thresholds live in a config object).
4. **Targets for v1:**
   - rep count accuracy ≥ 98 % on fixtures,
   - depth fault precision ≥ 90 %,
   - valgus and lean precision ≥ 80 %,
   - ≥ 25 FPS on the dev laptop with the `lite` model.
5. **Manual checklist:** different lighting, clothing, distances and both views for each exercise.

---

## 12. Milestones

| # | Milestone | Deliverable | Est. |
|---|---|---|---|
| **M0** | Scaffold | Vite + TS project, `npm run setup` downloads models and copies wasm, offline check | 0.5 day |
| **M1** | Live skeleton | Webcam, PoseLandmarker on GPU, skeleton overlay, FPS/perf panel, adaptive model | 1 day |
| **M2** | Engine core | Preprocess, One Euro filter, normalization, view classifier, features, tests | 1.5 days |
| **M3** | Squat MVP | Progress signal, rep state machine, depth and partial reps, rep counter HUD, beep and spoken count | 2 days |
| **M4** | Squat faults and tempo | Valgus, lean, heels, asymmetry, tempo tracker, cue orchestrator, colored joints, banner | 2 days |
| **M5** | Setup and calibration | Setup checklist screen, calibration flow, error states | 1 day |
| **M6** | Push-ups and lunges | Two more `ExerciseModel`s, view guidance, fixtures | 2 days |
| **M7** | Sessions and history | Summary screen, IndexedDB history, CSV/JSON export, landmark recording, replay mode | 1.5 days |
| **M8** | Hardening | Edge-case pass, threshold tuning on recordings, performance pass (optional Web Worker), README | 1.5 days |
| **M9** *(optional)* | Desktop app wrapper | Package as a double-clickable app (Tauri or Electron). Engine and UI unchanged | 1 day |

**Total:** about 2.5 weeks of focused work for the full scope. A **working squat counter with depth cues is ready at the end of M3, about 5 days in.**

---

## 13. How it will run (end state)

```bash
npm install          # once
npm run setup        # once: fetches pose models and copies the wasm runtime (needs internet once)
npm run dev          # opens http://localhost:5173 - works offline from here on
npm test             # engine unit + fixture tests
npm run build && npm run preview   # production build, still local
```

Open the page in Chrome or Edge, allow camera access, pick an exercise, follow the setup checklist, stand still to calibrate, and start your set.

---

## 14. Future extensions
- Drop `src/engine/` into the **snap-fitness React Native app**, using a VisionCamera frame processor as the `PoseSource`.
- Automatic exercise recognition: classify squat, push-up or lunge from the first 2 reps.
- A small learned fault classifier trained on your labeled landmark recordings, replacing the hand-tuned thresholds.
- More exercises: deadlift hinge, overhead press, plank hold timer, jumping jacks.
- Rep-by-rep video clips of faulty reps, saved locally only and only with opt-in.
