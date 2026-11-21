/**
 * Draws a board: locked cells, ghost and falling piece. Used for both the
 * play board and the mirror. Plan outlines (M5) go on a separate overlay
 * canvas that uses the same geometry (`cellRect`).
 */

import type { Tile } from "@haelp/teto/engine";

import { drawGhostMino, drawMino, sizeCanvas, type XY } from "./cells";
import { readTheme, type CanvasTheme } from "./palette";

export interface BoardView {
  board: readonly (readonly Tile[])[];
  /** `alpha` < 1 draws it faded (the mirror's not-yet-placed piece). */
  falling?: { mino: string; cells: readonly XY[]; alpha?: number } | null;
  ghost?: readonly XY[] | null;
  /** Grey out everything (paused / game over). */
  dimmed?: boolean;
}

export interface BoardGeometry {
  width: number;
  visibleRows: number;
  /** Rows above the visible field still drawn (spawn area). */
  bufferRows: number;
  cell: number;
}

export class BoardRenderer {
  geo: BoardGeometry;
  #ctx: CanvasRenderingContext2D;
  #theme: CanvasTheme;

  constructor(private canvas: HTMLCanvasElement, geo: Omit<BoardGeometry, "cell">, cell = 28) {
    this.geo = { ...geo, cell };
    this.#theme = readTheme();
    this.#ctx = this.resize(cell);
  }

  get cssWidth() {
    return this.geo.width * this.geo.cell;
  }
  get cssHeight() {
    return (this.geo.visibleRows + this.geo.bufferRows) * this.geo.cell;
  }

  resize(cell: number): CanvasRenderingContext2D {
    this.geo.cell = cell;
    this.#theme = readTheme();
    this.#ctx = sizeCanvas(this.canvas, this.cssWidth, this.cssHeight);
    return this.#ctx;
  }

  refreshTheme(): void {
    this.#theme = readTheme();
  }

  /** Top-left pixel of board cell (x, y), y = 0 at the bottom row. */
  cellRect(x: number, y: number): { px: number; py: number; size: number } {
    const { cell, visibleRows, bufferRows } = this.geo;
    return { px: x * cell, py: (visibleRows + bufferRows - 1 - y) * cell, size: cell };
  }

  draw(view: BoardView): void {
    const ctx = this.#ctx;
    const { width, visibleRows, bufferRows, cell } = this.geo;
    const t = this.#theme;
    const top = bufferRows * cell;
    const fieldH = visibleRows * cell;
    const W = this.cssWidth;

    ctx.clearRect(0, 0, W, this.cssHeight);

    // field background + grid (visible rows only; the buffer stays transparent)
    ctx.fillStyle = t.boardBg;
    ctx.fillRect(0, top, W, fieldH);
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < width; x++) {
      ctx.moveTo(x * cell + 0.5, top);
      ctx.lineTo(x * cell + 0.5, top + fieldH);
    }
    for (let y = 1; y < visibleRows; y++) {
      ctx.moveTo(0, top + y * cell + 0.5);
      ctx.lineTo(W, top + y * cell + 0.5);
    }
    ctx.stroke();

    const maxRow = visibleRows + bufferRows;
    const dimAlpha = view.dimmed ? 0.35 : 1;

    // locked cells
    for (let y = 0; y < Math.min(maxRow, view.board.length); y++) {
      const row = view.board[y]!;
      for (let x = 0; x < width; x++) {
        const tile = row[x];
        if (!tile) continue;
        const r = this.cellRect(x, y);
        drawMino(ctx, r.px, r.py, r.size, tile.mino, dimAlpha);
      }
    }

    if (!view.dimmed && view.falling) {
      if (view.ghost) {
        for (const [x, y] of view.ghost) {
          if (y >= maxRow) continue;
          const r = this.cellRect(x, y);
          drawGhostMino(ctx, r.px, r.py, r.size, view.falling.mino);
        }
      }
      for (const [x, y] of view.falling.cells) {
        if (y >= maxRow) continue;
        const r = this.cellRect(x, y);
        drawMino(ctx, r.px, r.py, r.size, view.falling.mino, view.falling.alpha ?? 1);
      }
    }

    // field border
    ctx.strokeStyle = t.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, top + 1, W - 2, fieldH - 2);
  }
}

/** Cells where the falling piece would land if hard-dropped. */
export function ghostCells(board: readonly (readonly Tile[])[], cells: readonly XY[]): XY[] {
  const width = board[0]?.length ?? 10;
  const free = (dy: number) =>
    cells.every(([x, y]) => {
      const ny = y - dy;
      return ny >= 0 && x >= 0 && x < width && (ny >= board.length || !board[ny]![x]);
    });
  let d = 0;
  while (free(d + 1)) d++;
  return cells.map(([x, y]) => [x, y - d] as const);
}
