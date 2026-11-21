/** Canvas helpers shared by the board, previews and (later) plan overlays. */

import { Tetromino, type Mino } from "@haelp/teto/engine";

import { PIECE_COLORS, shade } from "./palette";

export type XY = readonly [number, number];

/** Set up a canvas for crisp drawing at devicePixelRatio. */
export function sizeCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Draw one mino at pixel (px, py). */
export function drawMino(ctx: CanvasRenderingContext2D, px: number, py: number, size: number, mino: string, alpha = 1): void {
  const base = PIECE_COLORS[mino] ?? PIECE_COLORS.gb!;
  const inset = Math.max(1, Math.round(size * 0.06));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = shade(base, -0.25);
  ctx.fillRect(px, py, size, size);
  ctx.fillStyle = base;
  ctx.fillRect(px + inset, py + inset, size - inset * 2, size - inset * 2);
  ctx.fillStyle = shade(base, 0.25);
  ctx.fillRect(px + inset, py + inset, size - inset * 2, Math.max(1, Math.round(size * 0.12)));
  ctx.globalAlpha = 1;
}

/** Ghost style: translucent fill plus an outline. */
export function drawGhostMino(ctx: CanvasRenderingContext2D, px: number, py: number, size: number, mino: string): void {
  const base = PIECE_COLORS[mino] ?? PIECE_COLORS.gb!;
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = base;
  ctx.fillRect(px, py, size, size);
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = base;
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
  ctx.globalAlpha = 1;
}

const shapeCache = new Map<string, XY[]>();

/** Spawn-orientation cells of a piece, y pointing down, normalized to (0,0). */
export function pieceShape(mino: Mino | string): XY[] {
  const key = String(mino).toLowerCase();
  let cells = shapeCache.get(key);
  if (!cells) {
    const t = new Tetromino({ symbol: key as Mino, initialRotation: 0, boardHeight: 20, boardWidth: 10 });
    const raw = t.states[0]!.map((c) => [c[0], c[1]] as const);
    const minX = Math.min(...raw.map((c) => c[0]));
    const minY = Math.min(...raw.map((c) => c[1]));
    cells = raw.map(([x, y]) => [x - minX, y - minY] as const);
    shapeCache.set(key, cells);
  }
  return cells;
}

const statesCache = new Map<string, XY[][]>();

/** Absolute board cells (y up) of a piece at Triangle position (x, y, rotation). */
export function pieceCellsAt(mino: Mino | string, x: number, y: number, rotation: number): XY[] {
  const key = String(mino).toLowerCase();
  let states = statesCache.get(key);
  if (!states) {
    const t = new Tetromino({ symbol: key as Mino, initialRotation: 0, boardHeight: 20, boardWidth: 10 });
    states = t.states.map((st) => st.map((c) => [c[0], c[1]] as const));
    statesCache.set(key, states);
  }
  return states[((rotation % 4) + 4) % 4]!.map(([bx, by]) => [x + bx, y - by] as const);
}
