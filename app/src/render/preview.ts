/** Hold box and next queue. */

import { drawMino, pieceShape, sizeCanvas } from "./cells";

export interface PreviewOptions {
  slots: number;
  /** Mino size in css px. */
  cell: number;
}

export class PreviewRenderer {
  #ctx: CanvasRenderingContext2D;
  #slotH = 0;
  #w = 0;

  constructor(private canvas: HTMLCanvasElement, private opts: PreviewOptions) {
    this.#ctx = this.resize(opts.cell);
  }

  resize(cell: number): CanvasRenderingContext2D {
    this.opts.cell = cell;
    this.#w = cell * 5;
    this.#slotH = cell * 3;
    this.#ctx = sizeCanvas(this.canvas, this.#w, this.#slotH * this.opts.slots + cell * 0.5);
    return this.#ctx;
  }

  /** `pieces[i]` is drawn in slot i; `greyed` marks a used hold. */
  draw(pieces: readonly (string | null)[], greyed = false): void {
    const ctx = this.#ctx;
    const { cell, slots } = this.opts;
    ctx.clearRect(0, 0, this.#w, this.#slotH * slots + cell);

    for (let i = 0; i < slots; i++) {
      const p = pieces[i];
      if (!p) continue;
      const shape = pieceShape(p);
      const w = Math.max(...shape.map((c) => c[0])) + 1;
      const h = Math.max(...shape.map((c) => c[1])) + 1;
      const ox = (this.#w - w * cell) / 2;
      const oy = i * this.#slotH + (this.#slotH - h * cell) / 2;
      for (const [x, y] of shape) {
        drawMino(ctx, ox + x * cell, oy + y * cell, cell, greyed ? "gb" : p, greyed ? 0.6 : 1);
      }
    }
  }
}
