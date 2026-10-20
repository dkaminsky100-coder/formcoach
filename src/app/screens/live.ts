import { EXERCISES } from '../../engine/exercises';
import type { ExerciseId } from '../../engine/exercises/ExerciseModel';
import { FAULT_INFO, STRICTNESS, type Strictness } from '../../engine/faults';
import type { SetupStatus } from '../../engine/setup';
import { summarizeSet, type SetRecord } from '../../engine/summary';
import { TEMPO_PRESETS, tempoLabel, type TempoPreset } from '../../engine/tempo';
import type { EngineFrame, JointMeasure } from '../../engine/types';
import type { WorkoutState } from '../../engine/WorkoutTracker';
import { AudioEngine } from '../../feedback/AudioEngine';
import { CueOrchestrator, type CueAction } from '../../feedback/CueOrchestrator';
import { Metronome } from '../../feedback/Metronome';
import { downloadText, fileStamp } from '../../storage/download';
import { saveSet } from '../../storage/history';
import { loadSettings, saveSettings } from '../../storage/settings';
import { LiveSession, type ModelChoice, type SessionStatus, type SourceSpec } from '../LiveSession';
import { Hud, HUD_HTML } from '../ui/Hud';
import { summaryHtml } from '../ui/summaryView';

const fmt = (n: number, digits = 0) => (Number.isFinite(n) ? n.toFixed(digits) : '-');
const deg = (v: number | null) => (v === null ? '-' : `${Math.round(v)}°`);

const VIEW_LABEL = {
  front: 'Front',
  side: 'Side',
  oblique: 'Angled - turn to face the camera or side-on',
  unknown: '-',
} as const;

function perfText(s: SessionStatus, replay: boolean): string {
  if (replay) return [`replay     ${fmt(s.cameraFps)} fps  ${s.width}×${s.height}`, 'model      none (recorded landmarks)'].join('\n');
  return [
    `camera     ${fmt(s.cameraFps)} fps  ${s.width}×${s.height}`,
    `inference  ${fmt(s.inferenceFps)} fps`,
    `latency    p50 ${fmt(s.inferenceP50, 1)} ms · p95 ${fmt(s.inferenceP95, 1)} ms`,
    `model      ${s.model} (${s.delegate})${s.auto ? ' · auto' : ''}`,
    `skip       every ${s.skip === 1 ? '' : `${s.skip}nd `}frame`,
  ].join('\n');
}

function jointRow(name: string, m: JointMeasure): string {
  const src = m.source ? ` <span class="src">${m.source}</span>` : '';
  return `<tr><th>${name}</th><td>${deg(m.primary)}${src}</td><td class="lr">L ${deg(m.left)} · R ${deg(m.right)}</td></tr>`;
}

function analysisHtml(
  f: EngineFrame | null,
  w: WorkoutState,
  smoothing: boolean,
  angleName: string,
  topAngle: number,
  calibrated: boolean,
): string {
  if (!f) return '<p class="muted">No person detected</p>';
  const { features: x, body } = f;
  const lr = w.lastRep;
  return `
    <table>
      <tr><th>View</th><td colspan="2">${VIEW_LABEL[x.view]}${x.view === 'side' && x.nearSide ? ` (${x.nearSide} side to camera)` : ''}</td></tr>
      ${jointRow('Knee', x.knee)}
      ${jointRow('Hip', x.hip)}
      ${jointRow('Elbow', x.elbow)}
      <tr><th>Trunk lean</th><td colspan="2">${deg(x.trunkLean)}</td></tr>
      <tr><th>Depth</th><td colspan="2">${w.progress === null ? '-' : `${Math.round(w.progress * 100)}%`} <span class="muted">(start ${angleName} ${Math.round(topAngle)}°, ${calibrated ? 'calibrated' : 'estimated'})</span></td></tr>
      <tr><th>Last rep</th><td colspan="2">${lr ? `${Math.round(lr.maxDepth * 100)}% · ${lr.tDown.toFixed(1)}s down / ${lr.tPause.toFixed(1)}s / ${lr.tUp.toFixed(1)}s up` : '-'}</td></tr>
      <tr><th>Last faults</th><td colspan="2">${lr ? (lr.faults.length ? lr.faults.map((id) => FAULT_INFO[id].title).join(', ') : 'none') : '-'}</td></tr>
      <tr><th>Leg length</th><td colspan="2">${body.legLength ? `${Math.round(body.legLength)} px` : '-'}</td></tr>
      <tr><th>Smoothing</th><td colspan="2">${smoothing ? 'on' : 'off'} <span class="muted">(S)</span></td></tr>
    </table>`;
}

/**
 * Live camera / file replay screen. Resolves once the session is running.
 * `onExit` returns to home; `onHistory` opens the history screen.
 */
export async function renderLive(
  root: HTMLElement,
  model: ModelChoice,
  exercise: ExerciseId,
  source: SourceSpec,
  onExit: (error?: string, exercise?: ExerciseId) => void,
  onHistory: () => void,
): Promise<void> {
  const isCamera = source.kind === 'camera';
  const mirror = isCamera ? 'mirror' : '';
  const sourceLabel =
    source.kind === 'video' ? `Video: ${source.file.name}` : source.kind === 'recording' ? `Recording: ${source.name}` : '';

  root.innerHTML = `
    <section class="live">
      <div class="toolbar">
        <button id="stop" title="Save and go back (Esc)">■ Stop</button>
        <button id="finish" class="finish" title="Finish set and see your summary (F)">✓ Finish set</button>
        <select id="exercise" title="Exercise">
          ${EXERCISES.map((e) => `<option value="${e.id}">${e.name}</option>`).join('')}
        </select>
        <select id="depth" title="Depth target"></select>
        <select id="tempo" title="Tempo target (seconds down - pause - up)">
          <option value="free">Tempo: free</option>
          <option value="standard">Tempo 2-0-1</option>
          <option value="controlled">Tempo 3-1-1</option>
        </select>
        <button id="metroBtn" class="icon" title="Metronome beat (T)" disabled>♩</button>
        ${
          source.kind === 'recording'
            ? `<select id="speed" title="Playback speed"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select>`
            : ''
        }
        <span class="spacer"></span>
        ${isCamera ? '<button id="recBtn" title="Record landmarks for replay - no video is saved">● Rec</button>' : ''}
        <button id="resetBtn" class="icon" title="Reset counter (R)">↺</button>
        ${isCamera ? '<button id="recalBtn" class="icon" title="Recalibrate (C)">⟳</button>' : ''}
        <button id="muteBtn" class="icon" title="Sound on/off (M)">🔊</button>
        <button id="settingsBtn" class="icon" title="Settings">⚙</button>
      </div>
      ${sourceLabel ? `<p class="source-label">${sourceLabel.replace(/</g, '&lt;')}</p>` : ''}
      <div class="stage ${isCamera ? 'in-setup' : ''} ${source.kind === 'recording' ? 'replay' : ''}" id="stage">
        <video class="${mirror}" playsinline muted ${source.kind === 'recording' ? 'hidden' : ''}></video>
        <canvas class="${mirror}"></canvas>
        ${HUD_HTML}
        <div class="setup" id="setup">
          <h2>Get ready</h2>
          <ul class="setup-checks" id="setupChecks"></ul>
          <div class="setup-msg" id="setupMsg">Starting camera…</div>
          <div class="setup-bar"><div id="setupBar"></div></div>
          <button id="skipSetup" class="link">Skip calibration</button>
        </div>
        <div class="hint" id="hint">${isCamera ? 'Starting camera…' : 'Loading…'}</div>
        <pre class="perf" id="perf"></pre>
        <div class="analysis" id="analysis"></div>
        <span id="recBadge" class="rec-badge" hidden>● REC</span>
        <div class="settings-panel" id="settings" hidden>
          <h3>Settings</h3>
          <label class="field">Strictness
            <select id="strictness">
              <option value="relaxed">Relaxed - fewer warnings</option>
              <option value="normal">Normal</option>
              <option value="strict">Strict - more warnings</option>
            </select>
          </label>
          ${
            source.kind === 'recording'
              ? ''
              : `<label class="field">Pose model
                  <select id="model">
                    <option value="auto">Auto</option>
                    <option value="full">Full - more accurate</option>
                    <option value="lite">Lite - faster</option>
                  </select>
                </label>`
          }
          <label class="check"><input type="checkbox" id="optStats" /> Show stats <kbd>D</kbd></label>
          <label class="check"><input type="checkbox" id="optAnalysis" /> Show analysis <kbd>A</kbd></label>
          <label class="check"><input type="checkbox" id="optSmooth" checked /> Smoothing <kbd>S</kbd></label>
        </div>
        <span id="toast" class="toast"></span>
        <div class="summary-overlay" id="summary" hidden>
          <div class="summary-card">
            <div id="summaryBody"></div>
            <div class="summary-actions" id="summaryActions"></div>
          </div>
        </div>
      </div>
      <p class="detail"><span id="tip"></span> Keys: F finish set · R reset · ${isCamera ? 'C recalibrate · ' : ''}M mute · T beat · A analysis · D stats</p>
    </section>
  `;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const $opt = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const stage = $<HTMLDivElement>('#stage');
  const hint = $<HTMLDivElement>('#hint');
  const perf = $<HTMLPreElement>('#perf');
  const analysis = $<HTMLDivElement>('#analysis');
  const toast = $<HTMLSpanElement>('#toast');
  const modelSelect = $opt<HTMLSelectElement>('#model');
  const depthSelect = $<HTMLSelectElement>('#depth');
  const muteBtn = $<HTMLButtonElement>('#muteBtn');
  const tempoSelect = $<HTMLSelectElement>('#tempo');
  const metroBtn = $<HTMLButtonElement>('#metroBtn');
  const exerciseSelect = $<HTMLSelectElement>('#exercise');
  const recBtn = $opt<HTMLButtonElement>('#recBtn');
  const recBadge = $<HTMLSpanElement>('#recBadge');
  const summary = $<HTMLDivElement>('#summary');
  const tip = $<HTMLSpanElement>('#tip');
  const settingsPanel = $<HTMLDivElement>('#settings');
  const strictnessSelect = $<HTMLSelectElement>('#strictness');
  const optStats = $<HTMLInputElement>('#optStats');
  const optAnalysis = $<HTMLInputElement>('#optAnalysis');
  const optSmooth = $<HTMLInputElement>('#optSmooth');
  const settings = loadSettings();
  if (modelSelect) modelSelect.value = model;
  exerciseSelect.value = exercise;
  tempoSelect.value = settings.tempo;
  strictnessSelect.value = settings.strictness;

  // Created synchronously inside the Start click so the browser allows sound.
  const audio = new AudioEngine();
  audio.muted = settings.muted;
  muteBtn.textContent = audio.muted ? '🔇' : '🔊';
  const metronome = new Metronome(audio);
  const cues = new CueOrchestrator();
  const hud = new Hud(stage);

  // ── Setup panel ──
  const setupChecks = $<HTMLUListElement>('#setupChecks');
  const setupMsg = $<HTMLDivElement>('#setupMsg');
  const setupBar = $<HTMLDivElement>('#setupBar');
  let checksKey = '';
  let lastStage: SetupStatus['stage'] | null = null;

  const renderSetup = (s: SetupStatus) => {
    const key = s.checks.map((c) => `${c.ok}`).join();
    if (key !== checksKey) {
      checksKey = key;
      setupChecks.innerHTML = s.checks
        .map((c) => `<li class="${c.ok ? 'ok' : 'bad'}"><span>${c.ok ? '✔' : '✘'}</span>${c.label}</li>`)
        .join('');
    }
    setupMsg.textContent = s.stage === 'calibrating' ? `${s.message} ${Math.ceil((1 - s.progress) * 2)}s` : s.message;
    setupBar.style.width = `${Math.round(s.progress * 100)}%`;
    setupBar.parentElement!.classList.toggle('active', s.stage === 'calibrating');
    if (s.stage === 'calibrating' && lastStage !== 'calibrating') audio.say('Hold still');
    lastStage = s.stage;
  };

  const enterSetup = () => {
    if (!isCamera) return;
    session.beginSetup();
    lastStage = null;
    stage.classList.add('in-setup');
  };
  const leaveSetup = () => {
    stage.classList.remove('in-setup');
    cues.reset();
    hud.update(session.workout.state());
  };

  const perform = (action: CueAction | null) => {
    if (!action) return;
    hud.apply(action);
    if (action.tone) audio.tone(action.tone);
    if (action.speak) audio.say(action.speak, action.interrupt ?? false);
  };

  let toastTimer = 0;
  const showToast = (text: string) => {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3000);
  };

  // ── Sets: summary + history ──
  /** True once the current set's reps are in history, so it's never saved twice. */
  let setSaved = false;
  let summaryOpen = false;
  let ended = false;

  const currentRecord = (): SetRecord | null => {
    const reps = session.workout.repHistory();
    if (reps.length === 0) return null;
    const ex = session.exercise;
    return summarizeSet(reps, {
      exercise: ex.id,
      exerciseName: ex.name,
      depthLabel: ex.depthOptions.find((d) => d.id === ex.depth)?.label ?? ex.depth,
      tempoLabel: tempoLabel(session.workout.tempo),
      source: session.kind,
    });
  };

  /** Saves the current set to history (once). Returns the record, or null if there were no reps. */
  const saveCurrent = async (): Promise<SetRecord | null> => {
    const rec = currentRecord();
    if (!rec || setSaved) return rec;
    try {
      await saveSet(rec);
      setSaved = true;
    } catch (err) {
      console.error(err);
      showToast('Could not save to history');
    }
    return rec;
  };

  const startNewSet = () => {
    session.workout.resetCount();
    setSaved = false;
    cues.reset();
    hud.update(session.workout.state());
  };

  const showSummary = (rec: SetRecord | null) => {
    summaryOpen = true;
    $('#summaryBody').innerHTML = rec
      ? `<h2>${ended ? 'Analysis complete' : 'Set complete'}</h2>${summaryHtml(rec)}<p class="detail">Saved to history.</p>`
      : '<h2>No reps found</h2><p class="muted">The file played to the end, but no complete reps were detected. Check that the right exercise is selected and the whole body is visible.</p>';
    $('#summaryActions').innerHTML = `
      ${ended ? '' : '<button id="nextSet" class="primary">Next set</button>'}
      <button id="toHistory">📊 History</button>
      <button id="done">Done</button>`;
    summary.hidden = false;
    $opt('#nextSet')?.addEventListener('click', () => {
      summary.hidden = true;
      summaryOpen = false;
      startNewSet();
      session.resume();
    });
    $('#toHistory').addEventListener('click', () => exit(onHistory));
    $('#done').addEventListener('click', () => exit(() => onExit(undefined, session.exercise.id)));
  };

  const finishSet = async () => {
    if (summaryOpen) return;
    if (session.workout.repHistory().length === 0 && !ended) {
      showToast('No reps yet - do a few first');
      return;
    }
    session.pause();
    metronome.stop();
    setMetronome(false);
    const rec = await saveCurrent();
    if (rec?.reps) audio.say(`Set complete. ${rec.reps} ${session.exercise.name}${rec.reps === 1 ? '' : 's'}.`);
    showSummary(rec);
  };

  const session = new LiveSession($('video'), $('canvas'), model, exercise, source, {
    onQualityChange: showToast,
    onWorkout: (state, rep, t) => {
      hud.update(state);
      perform(rep ? cues.onRep(rep, t) : cues.onFrame(state.activeFaults, t));
    },
    onSetup: renderSetup,
    onCalibrated: (cal) => {
      leaveSetup();
      audio.tone('rep');
      audio.say('Ready. Go!');
      hud.show(`Calibrated (${cal.view} view) - go!`, 'good', 1800);
    },
    onEnded: () => {
      ended = true;
      void finishSet();
    },
    onSourceLost: () =>
      void exit(() =>
        onExit('The camera disconnected (unplugged, or taken by another app). Your reps so far were saved.', session.exercise.id),
      ),
  });

  /** Sync exercise-dependent settings and UI: depth, tempo, strictness, counter label, tip. */
  const applyExercise = () => {
    const ex = session.exercise;
    const savedDepth = settings.depth[ex.id];
    if (savedDepth && ex.depthOptions.some((d) => d.id === savedDepth)) ex.depth = savedDepth;
    session.workout.tempo = TEMPO_PRESETS[tempoSelect.value as TempoPreset];
    session.workout.sensitivity = STRICTNESS[strictnessSelect.value as Strictness];
    metroBtn.disabled = session.workout.tempo === null;
    depthSelect.innerHTML = ex.depthOptions
      .map((d) => `<option value="${d.id}" ${d.id === ex.depth ? 'selected' : ''}>${d.label}</option>`)
      .join('');
    hud.setExercise(ex.counterLabel);
    tip.textContent = ex.tip;
    hud.update(session.workout.state());
  };
  applyExercise();

  const setMetronome = (on: boolean) => {
    const tempo = TEMPO_PRESETS[tempoSelect.value as TempoPreset];
    if (on && tempo) metronome.start(tempo);
    else metronome.stop();
    metroBtn.classList.toggle('active', metronome.running);
  };
  const toggleMetronome = () => {
    if (!metroBtn.disabled) setMetronome(!metronome.running);
  };

  const toggleMute = () => {
    audio.muted = !audio.muted;
    muteBtn.textContent = audio.muted ? '🔇' : '🔊';
    saveSettings({ muted: audio.muted });
    showToast(audio.muted ? 'Sound off' : 'Sound on');
  };
  const setStats = (on: boolean) => {
    perf.classList.toggle('show', on);
    optStats.checked = on;
    saveSettings({ showStats: on });
  };
  const setAnalysis = (on: boolean) => {
    analysis.classList.toggle('show', on);
    optAnalysis.checked = on;
    saveSettings({ showAnalysis: on });
  };
  const setSmoothing = (on: boolean) => {
    session.engine.setSmoothing(on);
    optSmooth.checked = on;
  };
  setStats(settings.showStats);
  setAnalysis(settings.showAnalysis);
  const resetCount = () => {
    if (summaryOpen) return;
    startNewSet();
    showToast('Counter reset');
  };

  const toggleRecording = () => {
    if (!recBtn) return;
    if (!session.recording) {
      session.startRecording();
      recBtn.textContent = '■ Stop rec';
      recBtn.classList.add('active');
      recBadge.hidden = false;
      showToast('Recording landmarks (no video is saved)');
      return;
    }
    const rec = session.stopRecording();
    recBtn.textContent = '● Rec';
    recBtn.classList.remove('active');
    recBadge.hidden = true;
    if (rec) {
      downloadText(`formcoach-${session.exercise.id}_${fileStamp()}.json`, JSON.stringify(rec), 'application/json');
      showToast(`Saved recording (${rec.frames.length} frames) to your Downloads`);
    }
  };

  let perfTimer = 0;
  let exiting = false;
  /** Saves any unsaved reps, stops everything, then navigates. */
  const exit = async (then: () => void) => {
    if (exiting) return;
    exiting = true;
    if (session.recording) toggleRecording();
    await saveCurrent();
    cleanup();
    then();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLSelectElement) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') void exit(() => onExit(undefined, session.exercise.id));
    if (summaryOpen) return;
    if (key === 'd') setStats(!optStats.checked);
    if (key === 'a') setAnalysis(!optAnalysis.checked);
    if (key === 'r') resetCount();
    if (key === 'f') void finishSet();
    if (key === 'm') toggleMute();
    if (key === 't') toggleMetronome();
    if (key === 'c') enterSetup();
    if (key === 's') {
      setSmoothing(!session.engine.smoothing);
      showToast(`Smoothing ${session.engine.smoothing ? 'on' : 'off'}`);
    }
  };
  const unlockAudio = () => audio.unlock();
  const cleanup = () => {
    clearInterval(perfTimer);
    clearTimeout(toastTimer);
    window.removeEventListener('keydown', onKey);
    root.removeEventListener('pointerdown', unlockAudio);
    session.stop();
    metronome.stop();
    hud.dispose();
    audio.close();
  };

  $('#stop').addEventListener('click', () => void exit(() => onExit(undefined, session.exercise.id)));
  $('#finish').addEventListener('click', () => void finishSet());
  $('#settingsBtn').addEventListener('click', () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    $('#settingsBtn').classList.toggle('active', !settingsPanel.hidden);
  });
  optStats.addEventListener('change', () => setStats(optStats.checked));
  optAnalysis.addEventListener('change', () => setAnalysis(optAnalysis.checked));
  optSmooth.addEventListener('change', () => setSmoothing(optSmooth.checked));
  strictnessSelect.addEventListener('change', () => {
    const s = strictnessSelect.value as Strictness;
    session.workout.sensitivity = STRICTNESS[s];
    saveSettings({ strictness: s });
    showToast(`Strictness: ${s}`);
  });
  $('#resetBtn').addEventListener('click', resetCount);
  muteBtn.addEventListener('click', toggleMute);
  root.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', onKey);
  metroBtn.addEventListener('click', toggleMetronome);
  recBtn?.addEventListener('click', toggleRecording);
  $opt('#recalBtn')?.addEventListener('click', enterSetup);
  $opt<HTMLSelectElement>('#speed')?.addEventListener('change', (e) => {
    session.speed = Number((e.target as HTMLSelectElement).value);
  });
  $('#skipSetup').addEventListener('click', () => {
    session.skipSetup();
    leaveSetup();
    hud.show('Counting without calibration', 'good', 1500);
  });
  tempoSelect.addEventListener('change', () => {
    const preset = tempoSelect.value as TempoPreset;
    const tempo = TEMPO_PRESETS[preset];
    session.workout.tempo = tempo;
    metroBtn.disabled = tempo === null;
    saveSettings({ tempo: preset });
    setMetronome(metronome.running && tempo !== null);
    showToast(tempo ? `Tempo ${tempoLabel(tempo)}: ${tempo.down}s down, ${tempo.pause}s pause, ${tempo.up}s up` : 'Tempo: free');
  });
  depthSelect.addEventListener('change', () => {
    session.exercise.depth = depthSelect.value;
    settings.depth[session.exercise.id] = depthSelect.value;
    saveSettings({ depth: settings.depth });
    showToast(`Depth target: ${session.exercise.targetLabel()}`);
  });
  exerciseSelect.addEventListener('change', async () => {
    const hadReps = !setSaved && session.workout.repHistory().length > 0;
    await saveCurrent();
    session.setExercise(exerciseSelect.value as ExerciseId);
    setSaved = false;
    cues.reset();
    applyExercise();
    enterSetup();
    showToast(`${hadReps ? 'Previous set saved. ' : ''}${session.exercise.name} - get into position`);
  });
  modelSelect?.addEventListener('change', async () => {
    showToast('Loading model…');
    await session.setModel(modelSelect.value as ModelChoice);
    saveSettings({ model: modelSelect.value as ModelChoice });
    showToast(`Model: ${session.status().model}`);
  });

  try {
    await session.start();
  } catch (err) {
    cleanup();
    onExit(err instanceof Error ? err.message : String(err), session.exercise.id);
    return;
  }

  const { width: w, height: h } = session.frameSize;
  stage.style.aspectRatio = `${w} / ${h}`;
  if (source.kind !== 'recording' && session.status().delegate === 'CPU') {
    showToast('Graphics acceleration unavailable - running on the CPU, tracking may be slower');
  }

  perfTimer = window.setInterval(() => {
    const s = session.status();
    perf.textContent = perfText(s, source.kind === 'recording');
    const ex = session.exercise;
    const view = session.latest?.features.view;
    analysis.innerHTML = analysisHtml(
      session.latest,
      session.workout.state(),
      session.engine.smoothing,
      ex.angleName,
      ex.topAngle(view),
      view ? ex.isCalibrated(view) : false,
    );
    if (session.recording) recBadge.textContent = `● REC ${Math.round(session.recordedFrames / 30)}s`;
    const latest = session.latest;
    let message = '';
    if (session.mode === 'setup' || summaryOpen) message = '';
    else if (!s.personVisible) message = isCamera ? 'Step into view - make sure your whole body is visible' : 'No person detected';
    else if (latest && session.workout.state().progress === null) {
      const v = latest.features.view;
      message =
        v === 'unknown'
          ? 'Hold still - finding your position…'
          : !ex.supportedViews.includes(v)
            ? ex.viewHint
            : ex.angleName === 'elbow'
              ? 'Make sure your shoulders, elbows and wrists are visible'
              : 'Make sure your hips, knees and ankles are visible';
    }
    hint.textContent = message;
    hint.classList.toggle('show', message !== '');
    if (!s.personVisible) hud.update(session.workout.state());
  }, 250);
}
