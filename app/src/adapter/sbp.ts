/**
 * Triangle state ⇄ SBP/1 (docs/notes.md §2, §4).
 *
 * M3 needs only the direction Triangle → `start`, plus SBP placement →
 * board cells for drawing. The full Triangle-origin mapping and its 28-case
 * tests come in M4 (adapter/coords.ts).
 */

import type { Tile } from "@haelp/teto/engine";

import type { MirrorState } from "../game-core/mirror";
import type { Orientation, PieceId, PieceLocation, SbpBoard, StartMsg } from "./sbp-types";

export const SBP_BOARD_HEIGHT = 40;
export const SBP_BOARD_WIDTH = 10;

/** SBP north cells relative to the anchor (spec §7; identical in Frostetra's piece.rs). */
export const SBP_NORTH: Record<PieceId, readonly (readonly [number, number])[]> = {
  I: [[-1, 0], [0, 0], [1, 0], [2, 0]],
  J: [[-1, 0], [0, 0], [1, 0], [-1, 1]],
  L: [[-1, 0], [0, 0], [1, 0], [1, 1]],
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],
  S: [[-1, 0], [0, 0], [0, 1], [1, 1]],
  T: [[-1, 0], [0, 0], [1, 0], [0, 1]],
  Z: [[-1, 1], [0, 1], [0, 0], [1, 0]]
};

const ROTATE: Record<Orientation, (x: number, y: number) => [number, number]> = {
  north: (x, y) => [x, y],
  east: (x, y) => [y, -x],
  south: (x, y) => [-x, -y],
  west: (x, y) => [-y, x]
};

export const ORIENTATIONS: readonly Orientation[] = ["north", "east", "south", "west"];

export function toPieceId(mino: string): PieceId {
  const p = mino.toUpperCase();
  if (!(p in SBP_NORTH)) throw new Error(`not a tetromino: ${mino}`);
  return p as PieceId;
}

/** Absolute board cells (x right, y up, row 0 = bottom) of an SBP location. */
export function sbpCells(loc: PieceLocation): [number, number][] {
  const rot = ROTATE[loc.orientation];
  return SBP_NORTH[loc.piece].map(([dx, dy]) => {
    const [rx, ry] = rot(dx, dy);
    return [loc.x + rx, loc.y + ry];
  });
}

/** Triangle board (rows bottom-up, Tile objects) → SBP board (rows bottom-up, strings). */
export function toSbpBoard(board: readonly (readonly Tile[])[], height = SBP_BOARD_HEIGHT, width = SBP_BOARD_WIDTH): SbpBoard {
  const out: SbpBoard = [];
  for (let y = 0; y < height; y++) {
    const row = board[y];
    const r: (string | null)[] = [];
    for (let x = 0; x < width; x++) {
      const t = row?.[x];
      r.push(t ? (t.mino === "gb" || t.mino === "bomb" ? "G" : t.mino.toUpperCase()) : null);
    }
    out.push(r);
  }
  return out;
}

/**
 * Triangle counters → SBP counters.
 * Triangle: b2b −1 = none, 0 = one B2B clear made, n = chain; combo −1 = none.
 * Frostetra: counts of consecutive B2B clears / line clears (u32, so never negative).
 */
export const toSbpBackToBack = (triB2b: number) => Math.max(0, triB2b + 1);
export const toSbpCombo = (triCombo: number) => Math.max(0, triCombo + 1);

/** Build an SBP `start` from the mirror state, sending only the visible previews. */
export function toStart(m: MirrorState, previews: number): StartMsg {
  return {
    type: "start",
    board: toSbpBoard(m.board),
    active: toPieceId(m.current.mino),
    queue: m.queue.slice(0, previews).map(toPieceId),
    hold: m.hold ? toPieceId(m.hold) : null,
    combo: toSbpCombo(m.combo),
    back_to_back: toSbpBackToBack(m.b2b)
  };
}
