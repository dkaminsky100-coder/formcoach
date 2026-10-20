# FormCoach

Real-time workout form feedback that runs **entirely on your computer**. Your webcam feeds a pose-tracking model in the browser. FormCoach counts your reps and coaches your **depth, joint alignment and tempo** as you move, using sound and on-screen cues.

- **Exercises:** squats, push-ups, lunges
- **Private:** video never leaves your computer, and the app is locked so it can't contact any server
- **Offline:** after a one-time setup it works with Wi-Fi off

### ⬇ [Download FormCoach for Windows](https://github.com/dkaminsky100-coder/formcoach/releases/latest)

Get **`FormCoach-Setup-x.y.z.exe`** under *Assets* on the Releases page and run it. Instructions are below.

---

## Install the desktop app (Windows)

1. Run **`FormCoach-Setup-1.0.0.exe`**.
2. Windows may show **"Windows protected your PC"** because the app isn't code-signed. Click **More info → Run anyway**.
3. Choose where to install and click **Install**. You'll get a **FormCoach** shortcut on the desktop and in the Start menu.
4. Open FormCoach. It runs in its own window and needs no internet. Camera access is granted to the app automatically; it never uses the microphone.

**Uninstall:** Windows **Settings → Apps → FormCoach → Uninstall**.

Your history and settings are kept in `%APPDATA%\FormCoach`, separate from any browser.

**Keys in the app:** **F11** full screen, **Ctrl+R** reload. All the training keys below work too.

---

## Run from source

You need **Node.js** (v20 or newer) and **Chrome or Edge**.

```bash
npm install        # once
npm run setup      # once - downloads the pose models (≈15 MB); needs internet this one time
npm run dev        # starts the app and opens http://localhost:5173
```

Then:

1. Pick an exercise and click **Start camera**. Allow camera access when asked.
2. Follow the **Get ready** checklist until everything is ✔.
3. **Hold still for 2 seconds** to calibrate. You'll hear "Ready. Go!"
4. Train. Click **✓ Finish set** (or press **F**) to see your summary.

**Camera tips:**
- Stand **2–3 m** away with your **whole body, including your feet,** in the picture, in good light.
- **Squats and lunges:** stand side-on for the most accurate depth, or face the camera to get knee-tracking checks.
- **Push-ups:** side-on only. Put the camera low (on the floor or a chair).

---

## What it checks

| Exercise | Counted when | Form checks (camera angle) |
|---|---|---|
| **Squat** | Knee bends to the depth target (Half 120° / Parallel 95° / Deep 80°) | Chest up (side), Heels down (side), Knees out (front), Even weight (front) |
| **Push-up** | Elbow bends to the target (Half 120° / Full 90° / Chest to floor 70°) | Hips up / Hips down (side) |
| **Lunge** | Knee bends to the target (Half 120° / Full 95°) | Stay upright (side), Knees out (front); counts left and right legs separately |

All exercises also give:
- **"Go lower"** when a rep is too shallow. That rep is shown but not counted.
- **Tempo** checks: pick **2-0-1** or **3-1-1**, and you'll hear "Slow down" or "Pause at the bottom". The **♩** button plays a beat to follow.
- A **score out of 100** for every rep, with red joints and a dashed guide line showing what to fix.

Feedback is spoken one cue at a time, most important first, and the same cue isn't repeated within 4 seconds.

---

## Controls

**Toolbar:**
- **■ Stop:** save and go back.
- **✓ Finish set:** show the set summary.
- **Exercise / Depth / Tempo** dropdowns, plus the **♩** beat button.
- **● Rec:** record landmarks (numbers only, no video).
- **↺** reset the counter, **⟳** recalibrate, **🔊** sound.
- **⚙ Settings:** Strictness, pose model, stats, analysis panel, smoothing.

**Keys:**

| Key | Action |
|---|---|
| **F** | Finish set |
| **R** | Reset counter |
| **C** | Recalibrate |
| **M** | Mute |
| **T** | Metronome beat |
| **A** | Analysis panel (live angles) |
| **D** | Performance stats |
| **S** | Toggle smoothing |
| **Esc** | Stop |

**Strictness** (⚙): use **Relaxed** if you get warnings when your form is fine, and **Strict** for tougher coaching. Your settings are remembered between sessions.

---

## History, export, replay

- **History** (home screen → 📊 History): every finished set with its score, tempo, top issues and a per-rep table. Sets are also saved automatically if you press Stop or switch exercise mid-set.
- **Export CSV:** one row per rep. Opens in Excel, Google Sheets or Numbers.
- **Export JSON:** everything, as a backup.
- **Analyze a file** (home screen → 📂):
  - a **video** (.mp4 / .webm), e.g. a clip filmed on your phone, or
  - a **recording** made with ● Rec. These replay at 1×, 2× or 4× without needing the pose model.

History and settings are stored in this browser only (IndexedDB / localStorage). Clearing your browser data deletes them, so export a JSON backup first if you want to keep them.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Setup required" on the home screen | Run `npm run setup` in the project folder, then reload. |
| "Camera permission was denied" | Click the camera icon in the address bar, allow it, and reload. |
| "The camera is in use by another app" | Close Zoom, Teams, the Camera app, etc. |
| Choppy or slow | ⚙ → Pose model → **Lite**. The app also switches automatically if your computer can't keep up. |
| "Running on the CPU" message | Graphics acceleration isn't available. Update your graphics driver or check `chrome://gpu`. Tracking still works, just slower. |
| Reps not counted | Check the checklist is all ✔ and your hips, knees and ankles (or shoulders, elbows and wrists for push-ups) are visible. Try a shallower **Depth** target. |
| Too many or too few warnings | ⚙ → **Strictness**. |
| No sound | Check 🔊 isn't muted (M), and that the volume is up. Spoken cues use your system's built-in voices. |
| Console shows a blocked `odml.pa.googleapis.com` request | Expected. Google's MediaPipe library tries to send usage logs, and FormCoach's privacy lock blocks them. Nothing is affected. |

---

## For developers

```bash
npm test           # 136 unit / integration tests (Vitest)
npm run typecheck
npm run build      # production build in dist/ - serve with `npm run preview`
npm run app        # build, then open the desktop (Electron) version
npm run package    # build the Windows installer → installer/FormCoach-Setup-<version>.exe
```

**Desktop app** (`electron/main.cjs`):
- Serves `dist/` from inside the package at `app://formcoach/` (a secure origin, so the camera and storage work).
- Grants the **camera only**, and **cancels every http/https/ws request**, so the app can't reach the internet.
- `npm run package` uses electron-builder (NSIS installer). It then runs `scripts/clean-release.mjs`, so `installer/` keeps only the installer: no unpacked app, no build metadata.
- Size is about 118 MB. To keep it down, the package includes only the en-US Electron locale and the SIMD WebAssembly build.
- To release a new version, bump `"version"` in `package.json` and run `npm run package`.

**Stack:**
- TypeScript and Vite
- [`@mediapipe/tasks-vision`](https://www.npmjs.com/package/@mediapipe/tasks-vision) Pose Landmarker (GPU, with CPU fallback)
- Canvas 2D for drawing
- Web Audio and speechSynthesis for sound
- IndexedDB for history

```
src/
  engine/          Pure TypeScript - no DOM, no MediaPipe. Portable (e.g. to React Native).
    Engine.ts        raw landmarks → smoothed, normalised body + features (angles, view)
    math/            vectors, One Euro filter, stats
    exercises/       AngleExercise base + squat / push-up / lunge, fault checks
    repStateMachine.ts   top → descending → bottom → ascending → rep
    faults.ts        debounced fault monitor, cue texts, score weights, strictness
    WorkoutTracker.ts    exercise + rep FSM + faults + tempo → rep summaries
    setup.ts         setup checklist + calibration
    summary.ts       set summary + CSV
  pose/            MediaPipe loader, camera / video sources, landmark recordings
  feedback/        audio, metronome, cue orchestrator (what to say, when)
  render/          skeleton overlay
  app/             screens (home, live, history), HUD, LiveSession (wires it all)
  storage/         history (IndexedDB), settings (localStorage), downloads
tests/             Vitest - synthetic bodies with exact known angles, plus recorded fixtures
```

**How it decides:**
1. **Joint angles:** `atan2(|u×v|, u·v)` on smoothed landmarks. Side-on it uses 2D image angles (most accurate); facing the camera it uses MediaPipe's 3D world landmarks, because 2D is foreshortened.
2. **Progress:** `p = (θ_start − θ) / (θ_start − θ_target)`, where θ_start comes from calibration.
3. **Rep state machine:** hysteresis plus 3-frame confirmation, so jitter and single bad frames can't count reps.
4. **Faults:** each check returns *value ÷ threshold*. The fault must persist for 150 ms to show, and for 200 ms within a rep to count against it.
5. **Thresholds:** `src/engine/exercises/squatFaults.ts`, `pushup.ts` and `lunge.ts`.

**Tuning with your own recordings:**
1. Press **● Rec**, do a set, and press it again. A `.json` file lands in Downloads.
2. Copy it to `tests/fixtures/` and add `<same name>.expected.json`:
   ```json
   { "reps": 5, "partials": 1, "repFaults": [[], ["knee_valgus"], [], [], []] }
   ```
3. Run `npm test`. Every recording with an `.expected.json` is replayed through the engine and checked.

**Known limits:**
- One person at a time. If someone else walks in, the rep in progress is dropped rather than miscounted.
- Pose landmarks have no points along the spine, so "Chest up" measures trunk lean, not lower-back rounding.
- Thresholds were tuned on simulated bodies and are adjustable via Strictness. Real recordings (above) are the way to fine-tune them.

---

## License

[MIT](LICENSE): free to use, modify and share, as long as the copyright notice is kept.

Pose tracking uses Google's [MediaPipe](https://github.com/google-ai-edge/mediapipe) (Apache 2.0) and its Pose Landmarker models. The desktop app is built with [Electron](https://www.electronjs.org/) (MIT).
