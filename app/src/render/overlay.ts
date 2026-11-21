/**
 * Plan overlay drawn on its own canvas over the mirror board. It uses the
 * mirror's geometry, so outlines line up with the cells.
 */

import type { BoardRenderer } from "./board";
import { sizeCanvas } from "./cells";
import { PIECE_COLORS, shade } from "./palette";

export interface OverlayStep {
  cells: readonly (readonly [number, number])[];
  mino: string;
  /** 1-based step number. */
  n: number;
  usesHold: boolean;
  /** The B2B-making clear (M5): drawn thicker with a glow. */
  final?: boolean;
}

export class OverlayRenderer {
  #ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement, private board: BoardRenderer) {
    this.#ctx = this.resize();
  }

  resize(): CanvasRenderingContext2D {
    this.#ctx = sizeCanvas(this.canvas, this.board.cssWidth, this.board.cssHeight);
    return this.#ctx;
  }

  clear(): void {
    this.#ctx.clearRect(0, 0, this.board.cssWidth, this.board.cssHeight);
  }

  draw(steps: readonly OverlayStep[]): void {
    this.clear();
    // Draw later steps first so step 1 ends up on top.
    for (const s of [...steps].reverse()) this.#drawStep(s);
  }

  #drawStep(s: OverlayStep): void {
    const ctx = this.#ctx;
    const base = PIECE_COLORS[s.mino] ?? "#ffffff";
    // Lightened so dark pieces (J, Z) still read on the dark board.
    const color = shade(base, 0.35);
    const set = new Set(s.cells.map(([x, y]) => `${x},${y}`));
    const has = (x: number, y: number) => set.has(`${x},${y}`);
    const cell = this.board.geo.cell;

    // translucent fill
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = base;
    for (const [x, y] of s.cells) {
      const r = this.board.cellRect(x, y);
      ctx.fillRect(r.px, r.py, r.size, r.size);
    }
    ctx.globalAlpha = 1;

    // outline of the union (perimeter edges only)
    const path = new Path2D();
    for (const [x, y] of s.cells) {
      const { px, py, size } = this.board.cellRect(x, y);
      if (!has(x, y + 1)) { path.moveTo(px, py); path.lineTo(px + size, py); }
      if (!has(x, y - 1)) { path.moveTo(px, py + size); path.lineTo(px + size, py + size); }
      if (!has(x - 1, y)) { path.moveTo(px, py); path.lineTo(px, py + size); }
      if (!has(x + 1, y)) { path.moveTo(px + size, py); path.lineTo(px + size, py + size); }
    }
    const w = s.final ? 3.5 : 2;
    ctx.lineCap = "square";
    ctx.strokeStyle = "rgba(0,0,0,0.65)";
    ctx.lineWidth = w + 2.5;
    ctx.stroke(path);
    if (s.final) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke(path);
    ctx.shadowBlur = 0;

    // step number in the top-left mino; "H" badge in the top-right mino
    const topY = Math.max(...s.cells.map((c) => c[1]));
    const topRow = s.cells.filter((c) => c[1] === topY);
    const tl = topRow.reduce((a, b) => (b[0] < a[0] ? b : a));
    const tr = topRow.reduce((a, b) => (b[0] > a[0] ? b : a));
    const font = Math.max(9, Math.round(cell * 0.5));
    ctx.font = `800 ${font}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = (x: number, y: number, text: string, bg: string) => {
      const r = this.board.cellRect(x, y);
      const cx = r.px + r.size / 2;
      const cy = r.py + r.size / 2;
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(cx, cy, r.size * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0b0c10";
      ctx.fillText(text, cx, cy + 0.5);
    };
    label(tl[0], tl[1], String(s.n), color);
    if (s.usesHold) {
      if (tr[0] !== tl[0]) label(tr[0], tr[1], "H", "#ffffff");
      else {
        // single-column top row: put the badge one mino down
        const below = s.cells.filter((c) => c[1] === topY - 1)[0] ?? tl;
        label(below[0], below[1], "H", "#ffffff");
      }
    }
  }
}
