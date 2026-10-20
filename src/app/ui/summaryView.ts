import { FAULT_INFO } from '../../engine/faults';
import { topFaults, type SetRecord } from '../../engine/summary';

const scoreClass = (s: number | null) => (s === null ? '' : s >= 85 ? 'good' : s >= 60 ? 'ok' : 'bad');

const ISSUE_LABEL = { shallow: 'Not deep enough', too_fast: 'Too fast' } as const;

const SOURCE_LABEL = { camera: 'Live camera', video: 'Video file', recording: 'Recording' } as const;

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Summary of one set: headline numbers, top issues and a per-rep table. */
export function summaryHtml(rec: SetRecord): string {
  const issues = topFaults(rec);
  const tempo = rec.avgTempo ? `${rec.avgTempo.down}s · ${rec.avgTempo.pause}s · ${rec.avgTempo.up}s` : '-';
  const legs = rec.legCounts ? `<div class="stat"><b>L ${rec.legCounts.left} · R ${rec.legCounts.right}</b><span>Per leg</span></div>` : '';

  const rows = rec.repList
    .map((r) => {
      const notes = r.counted
        ? r.faults.map((f) => FAULT_INFO[f].title).join(', ') || '<span class="good">Clean</span>'
        : `<span class="bad">${r.issue ? ISSUE_LABEL[r.issue] : 'Not counted'}</span>`;
      return `<tr class="${r.counted ? '' : 'partial'}">
        <td>${r.n}${r.side ? ` <span class="muted">${r.side === 'left' ? 'L' : 'R'}</span>` : ''}</td>
        <td class="${r.counted ? scoreClass(r.score) : ''}">${r.counted ? r.score : '-'}</td>
        <td>${r.depthPct}%</td>
        <td>${r.tDown}s / ${r.tPause}s / ${r.tUp}s</td>
        <td>${notes}</td>
      </tr>`;
    })
    .join('');

  return `
    <div class="summary">
      <div class="summary-head">
        <div class="summary-reps"><b>${rec.reps}</b><span>${escapeHtml(rec.exerciseName)}${rec.reps === 1 ? '' : 's'}</span></div>
        <div class="summary-meta">
          <div>${formatDate(rec.date)}</div>
          <div class="muted">${SOURCE_LABEL[rec.source]} · depth ${escapeHtml(rec.depthLabel)} · tempo ${escapeHtml(rec.tempoLabel)}</div>
        </div>
      </div>
      <div class="summary-stats">
        <div class="stat"><b class="${scoreClass(rec.avgScore)}">${rec.avgScore ?? '-'}</b><span>Avg score</span></div>
        <div class="stat"><b class="${scoreClass(rec.bestScore)}">${rec.bestScore ?? '-'}</b><span>Best</span></div>
        <div class="stat"><b>${rec.partials}</b><span>Not counted</span></div>
        <div class="stat"><b>${tempo}</b><span>Avg down · pause · up</span></div>
        <div class="stat"><b>${rec.durationS}s</b><span>Set time</span></div>
        ${legs}
      </div>
      <div class="summary-issues">
        <h3>Work on</h3>
        ${
          issues.length
            ? `<ul>${issues.map((f) => `<li><b>${f.title}</b> <span class="muted">in ${f.count} of ${rec.reps} rep${rec.reps === 1 ? '' : 's'} - "${FAULT_INFO[f.id].cue}"</span></li>`).join('')}</ul>`
            : '<p class="good">No form issues - great set!</p>'
        }
      </div>
      <div class="summary-table">
        <table>
          <thead><tr><th>Rep</th><th>Score</th><th>Depth</th><th>Down / pause / up</th><th>Notes</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}
