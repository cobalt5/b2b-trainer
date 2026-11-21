/**
 * Triangle piece position ⇄ SBP piece location (docs/notes.md §4).
 *
 * Triangle: (x, y) is the top-left of the piece's matrix box. Cell (bx, by)
 * of rotation r sits at (x + bx, y − by). SBP: (x, y) is the anchor, and cell
 * (dx, dy) of an orientation sits at (x + dx, y + dy).
 *
 * The per-(piece, rotation) offset is derived here from both cell tables by
 * matching cell sets, not typed in by hand. test/coords.test.ts pins all 28
 * pairs against the table in the notes.
 */

import { Tetromino, type Mino } from "@haelp/teto/engine";

import { ORIENTATIONS, SBP_NORTH, sbpCells } from "./sbp";
import type { Orientation, PieceId, PieceLocation } from "./sbp-types";

export type Rotation = 0 | 1 | 2 | 3;
export interface TriLocation {
  mino: Mino;
  x: number;
  y: number;
  rotation: Rotation;
}

const key = (cells: readonly (readonly [number, number])[]) =>
  cells
    .map(([x, y]) => `${x},${y}`)
    .sort()
    .join(";");

/** Triangle matrix cells (y down) for each rotation. */
function triStates(piece: PieceId): [number, number][][] {
  const t = new Tetromino({ symbol: piece.toLowerCase() as Mino, initialRotation: 0, boardHeight: 20, boardWidth: 10 });
  return t.states.map((st) => st.map((c) => [c[0], c[1]] as [number, number]));
}

function deriveOffsets(): Record<PieceId, [number, number][]> {
  const out = {} as Record<PieceId, [number, number][]>;
  for (const piece of Object.keys(SBP_NORTH) as PieceId[]) {
    const states = triStates(piece);
    out[piece] = ORIENTATIONS.map((orientation, rot) => {
      // Triangle at (0,0): absolute cells (bx, −by).
      const tri = key(states[rot]!.map(([bx, by]) => [bx, -by] as const));
      for (let ox = -4; ox <= 4; ox++) {
        for (let oy = -4; oy <= 4; oy++) {
          if (key(sbpCells({ piece, orientation, x: ox, y: oy })) === tri) return [ox, oy];
        }
      }
      throw new Error(`no SBP anchor matches Triangle ${piece} rotation ${rot}`);
    });
  }
  return out;
}

/** SBP anchor − Triangle origin, per piece and rotation. */
export const ANCHOR_OFFSETS: Readonly<Record<PieceId, readonly (readonly [number, number])[]>> = deriveOffsets();

export function triToSbp(t: TriLocation): PieceLocation {
  const piece = t.mino.toUpperCase() as PieceId;
  const [ox, oy] = ANCHOR_OFFSETS[piece][t.rotation]!;
  return { piece, orientation: ORIENTATIONS[t.rotation]!, x: t.x + ox, y: t.y + oy };
}

export function sbpToTri(l: PieceLocation): TriLocation {
  const rotation = ORIENTATIONS.indexOf(l.orientation as Orientation) as Rotation;
  if (rotation < 0) throw new Error(`bad orientation ${l.orientation}`);
  const [ox, oy] = ANCHOR_OFFSETS[l.piece][rotation]!;
  return { mino: l.piece.toLowerCase() as Mino, rotation, x: l.x - ox, y: l.y - oy };
}

/** Canonical key for a cell set (placement identity ignores anchor/orientation). */
export const cellsKey = key;

/** Find an SBP location whose cells equal `cells` (any orientation), or null. */
export function locationFromCells(piece: PieceId, cells: readonly (readonly [number, number])[]): PieceLocation | null {
  const target = key(cells);
  const [cx, cy] = cells[0]!;
  for (const orientation of ORIENTATIONS) {
    const rel = sbpCells({ piece, orientation, x: 0, y: 0 });
    for (const [dx, dy] of rel) {
      const loc = { piece, orientation, x: cx - dx, y: cy - dy };
      if (key(sbpCells(loc)) === target) return loc;
    }
  }
  return null;
}
