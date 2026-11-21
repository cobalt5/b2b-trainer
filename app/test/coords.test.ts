import { describe, expect, it } from "vitest";

import { ANCHOR_OFFSETS, cellsKey, sbpToTri, triToSbp, type Rotation } from "../src/adapter/coords";
import { sbpCells } from "../src/adapter/sbp";
import type { PieceId } from "../src/adapter/sbp-types";
import { pieceCellsAt } from "../src/render/cells";

const PIECES: PieceId[] = ["I", "J", "L", "O", "S", "T", "Z"];
const ROTS: Rotation[] = [0, 1, 2, 3];

/** docs/notes.md §4, hand-checked: the derived table must match it exactly. */
const EXPECTED: Record<PieceId, [number, number][]> = {
  I: [[1, -1], [2, -1], [2, -2], [1, -2]],
  O: [[0, -1], [0, 0], [1, 0], [1, -1]],
  J: [[1, -1], [1, -1], [1, -1], [1, -1]],
  L: [[1, -1], [1, -1], [1, -1], [1, -1]],
  S: [[1, -1], [1, -1], [1, -1], [1, -1]],
  T: [[1, -1], [1, -1], [1, -1], [1, -1]],
  Z: [[1, -1], [1, -1], [1, -1], [1, -1]]
};

describe("Triangle ⇄ SBP anchor mapping", () => {
  it("derived offsets match the documented table", () => {
    for (const p of PIECES) expect(ANCHOR_OFFSETS[p]).toEqual(EXPECTED[p]);
  });

  for (const p of PIECES) {
    for (const r of ROTS) {
      it(`${p} rotation ${r}: same cells both ways, and round-trips`, () => {
        for (const [x, y] of [[0, 2], [3, 22], [7, 5], [4, 39]] as const) {
          const tri = { mino: p.toLowerCase() as any, x, y, rotation: r };
          const sbp = triToSbp(tri);
          expect(cellsKey(sbpCells(sbp))).toBe(cellsKey(pieceCellsAt(tri.mino, x, y, r)));
          expect(sbpToTri(sbp)).toEqual(tri);
        }
      });
    }
  }

  it("T spawn maps to the SBP spawn position (4, 21)", () => {
    expect(triToSbp({ mino: "t" as any, x: 3, y: 22, rotation: 0 })).toEqual({ piece: "T", orientation: "north", x: 4, y: 21 });
  });
});
