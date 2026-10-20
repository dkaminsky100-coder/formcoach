import { setsToCsv, type SetRecord } from '../../engine/summary';
import { downloadText, fileStamp } from '../../storage/download';
import { clearSets, deleteSet, listSets } from '../../storage/history';
import { formatDate, summaryHtml } from '../ui/summaryView';

const scoreClass = (s: number | null) => (s === null ? '' : s >= 85 ? 'good' : s >= 60 ? 'ok' : 'bad');

function rowHtml(s: SetRecord): string {
  return `
    <details class="history-item" data-id="${s.id}">
      <summary>
        <span class="h-date">${formatDate(s.date)}</span>
        <span class="h-ex">${s.exerciseName}</span>
        <span class="h-reps"><b>${s.reps}</b> reps${s.partials ? ` <span class="muted">+${s.partials}</span>` : ''}</span>
        <span class="h-score ${scoreClass(s.avgScore)}">${s.avgScore ?? '-'}</span>
      </summary>
      ${summaryHtml(s)}
      <div class="history-actions"><button class="danger" data-delete="${s.id}">Delete this set</button></div>
    </details>`;
}

export async function renderHistory(root: HTMLElement, onBack: () => void): Promise<void> {
  root.innerHTML = `
    <section class="history">
      <div class="toolbar">
        <button id="back">← Back</button>
        <h1 class="history-title">History</h1>
        <span class="spacer"></span>
        <button id="csv" title="One row per rep - opens in Excel, Google Sheets, Numbers">⇩ Export CSV</button>
        <button id="json" title="Everything, for backups">⇩ Export JSON</button>
        <button id="clear" class="danger">Clear all</button>
      </div>
      <p class="detail">Saved in this browser on this computer only. Nothing is uploaded.</p>
      <div id="totals" class="history-totals"></div>
      <div id="list"><p class="muted">Loading…</p></div>
    </section>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const list = $<HTMLDivElement>('#list');
  const totals = $<HTMLDivElement>('#totals');
  let sets: SetRecord[] = [];

  const render = () => {
    const buttons = ['#csv', '#json', '#clear'].map((s) => $<HTMLButtonElement>(s));
    buttons.forEach((b) => (b.disabled = sets.length === 0));
    if (sets.length === 0) {
      totals.innerHTML = '';
      list.innerHTML = '<p class="muted">No sets yet. Finish a set (✓ Finish set) and it will appear here.</p>';
      return;
    }
    const reps = sets.reduce((n, s) => n + s.reps, 0);
    const byEx = new Map<string, number>();
    for (const s of sets) byEx.set(s.exerciseName, (byEx.get(s.exerciseName) ?? 0) + s.reps);
    totals.innerHTML = `
      <div class="stat"><b>${sets.length}</b><span>Sets</span></div>
      <div class="stat"><b>${reps}</b><span>Total reps</span></div>
      ${[...byEx].map(([ex, n]) => `<div class="stat"><b>${n}</b><span>${ex}s</span></div>`).join('')}`;
    list.innerHTML = sets.map(rowHtml).join('');
  };

  const load = async () => {
    try {
      sets = await listSets();
      render();
    } catch (err) {
      list.innerHTML = `<p class="bad">Could not read history: ${String(err)}</p>`;
    }
  };

  $('#back').addEventListener('click', onBack);
  // The byte-order mark makes Excel read the file as UTF-8 (otherwise "°" shows up garbled).
  $('#csv').addEventListener('click', () =>
    downloadText(`formcoach-history_${fileStamp()}.csv`, `﻿${setsToCsv(sets)}`, 'text/csv'),
  );
  $('#json').addEventListener('click', () =>
    downloadText(`formcoach-history_${fileStamp()}.json`, JSON.stringify(sets, null, 2), 'application/json'),
  );
  $('#clear').addEventListener('click', async () => {
    if (!window.confirm(`Delete all ${sets.length} saved sets? This cannot be undone.`)) return;
    await clearSets();
    await load();
  });
  list.addEventListener('click', async (e) => {
    const id = (e.target as HTMLElement).dataset.delete;
    if (!id) return;
    if (!window.confirm('Delete this set?')) return;
    await deleteSet(id);
    await load();
  });

  await load();
}
