import type { ActiveFault } from '../engine/faults';
import type { EngineFrame, JointMeasure } from '../engine/types';
import { BONES, DRAWN_JOINTS, LM, boneSide, sideOf, type Side } from '../pose/landmarks';

const SIDE_COLOR: Record<Side, string> = {
  left: '#29b6f6',
  right: '#ff9f43',
  center: '#e8eaf0',
};
const FAULT_COLOR = '#e74c3c';

interface AngleLabel {
  joint: number;
  value: number;
}

/** Which joint angles to label: near side only in side view, both sides otherwise. */
function angleLabels({ features: f }: EngineFrame): AngleLabel[] {
  const out: AngleLabel[] = [];
  const add = (m: JointMeasure, left: number, right: number) => {
    const sides =
      f.view === 'side' ? [f.nearSide ?? 'left'] : f.view === 'unknown' ? [] : (['left', 'right'] as const);
    for (const s of sides) {
      const v = m[s];
      if (v !== null) out.push({ joint: s === 'left' ? left : right, value: v });
    }
  };
  add(f.knee, LM.L_KNEE, LM.R_KNEE);
  add(f.hip, LM.L_HIP, LM.R_HIP);
  add(f.elbow, LM.L_ELBOW, LM.R_ELBOW);
  return out;
}

/**
 * Draws the skeleton in unmirrored frame pixels. The canvas backing store matches the
 * video resolution, so CSS scaling and the mirror transform keep it aligned with the video.
 */
export class Overlay {
  private readonly ctx: CanvasRenderingContext2D;

  /** `mirrored`: the canvas is flipped by CSS, so text must be counter-flipped to stay readable. */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly mirrored = true,
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(frame: EngineFrame | null, faults: readonly ActiveFault[] = []): void {
    this.clear();
    if (!frame) return;

    const { ctx } = this;
    const pts = frame.body.px;
    const unit = Math.max(1.5, this.canvas.width / 400);
    const bad = new Set(faults.flatMap((f) => f.joints));

    // Reference lines first, so the skeleton draws over them.
    ctx.setLineDash([unit * 4, unit * 3]);
    ctx.lineWidth = unit;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    for (const [a, b] of faults.flatMap((f) => f.guides)) {
      if (!pts[a]?.valid || !pts[b]?.valid) continue;
      ctx.beginPath();
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.lineCap = 'round';
    for (const bone of BONES) {
      const [a, b] = bone;
      if (!pts[a]?.valid || !pts[b]?.valid) continue;
      const faulty = bad.has(a) || bad.has(b);
      ctx.lineWidth = unit * (faulty ? 2.4 : 1.6);
      ctx.strokeStyle = faulty ? FAULT_COLOR : SIDE_COLOR[boneSide(bone)];
      ctx.beginPath();
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
      ctx.stroke();
    }

    for (const i of DRAWN_JOINTS) {
      const p = pts[i];
      if (!p) continue;
      const faulty = bad.has(i);
      // Low-confidence joints stay as faint hollow rings so occlusion is visible.
      ctx.globalAlpha = p.valid ? 1 : 0.35;
      ctx.beginPath();
      ctx.arc(p.x, p.y, unit * (faulty ? 4 : 2.6), 0, Math.PI * 2);
      if (p.valid) {
        ctx.fillStyle = faulty ? FAULT_COLOR : SIDE_COLOR[sideOf(i)];
        ctx.fill();
      }
      ctx.lineWidth = unit * 0.8;
      ctx.strokeStyle = faulty ? '#ffffff' : '#0f1115';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const { joint, value } of angleLabels(frame)) {
      const p = pts[joint];
      this.label(`${Math.round(value)}°`, p.x + unit * 6, p.y - unit * 4, unit);
    }
  }

  private label(text: string, x: number, y: number, unit: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    if (this.mirrored) ctx.scale(-1, 1);
    ctx.font = `600 ${Math.round(unit * 7)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    // After the flip, text grows leftward in canvas space but rightward on screen.
    const w = ctx.measureText(text).width;
    const pad = unit * 2.5;
    const h = unit * 10;
    ctx.fillStyle = 'rgba(15, 17, 21, 0.75)';
    ctx.beginPath();
    ctx.roundRect(-pad, -h / 2, w + pad * 2, h, h / 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}
