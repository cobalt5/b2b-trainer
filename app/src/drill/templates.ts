/**
 * Spin "cores" for drill generation. A core is the few columns around a spin
 * slot, top-down rows ('X' filled, '.' empty), sitting on the stack floor.
 * The generator places it at a column offset, fills the other columns to
 * `fill` rows (plus random bumps), may add garbage underneath, and then asks
 * Triangle which spins the target piece can really make there. The core only
 * has to make a spin likely; the label shown comes from Triangle.
 *
 * Only T, S, L and I cores are written by hand. Z and J drills use the S and L
 * cores flipped left-right; T and I cores are flipped at random.
 * test/drill-templates.test.ts checks every core (and its flip) in Triangle.
 */

import type { DrillPiece } from "./scenario";

export interface SpinTemplate {
  name: string;
  /** Piece the core was drawn for (T, S, L or I). */
  piece: "T" | "S" | "L" | "I";
  rows: string[];
  /** Heights the columns outside the core are filled to; one is picked per drill. */
  fills: number[];
  /** The core must touch this wall (as drawn; flips mirror it). */
  wall?: "left" | "right";
}

export const TEMPLATES: readonly SpinTemplate[] = [
  // ---------------------------------------------------------------- T
  { name: "TSD slot", piece: "T", rows: ["XX...", "X...X", "XX.XX"], fills: [2, 2, 1] },
  { name: "TSD slot, tall wall", piece: "T", rows: ["XX...", "XX...", "X...X", "XX.XX"], fills: [2, 2, 1] },
  { name: "TSD slot, side overhang", piece: "T", rows: ["...XX", "X...X", "XX.XX"], fills: [2, 1] },
  { name: "TST slot", piece: "T", rows: ["XX.", "X..", "X.X", "X..", "X.X"], fills: [3, 3, 2] },
  { name: "T-spin mini at the wall", piece: "T", rows: ["..", ".X"], fills: [1], wall: "left" },

  // ---------------------------------------------------------------- S (Z = flipped)
  { name: "S-spin slot at the wall", piece: "S", rows: ["X..X", "..XX"], fills: [2, 2, 1], wall: "left" },
  { name: "S-spin slot", piece: "S", rows: ["XX..X", "X..XX"], fills: [2, 2, 1] },
  { name: "S-spin triple slot", piece: "S", rows: ["X..", "X.X", "X..", "XX."], fills: [3, 2] },

  // ---------------------------------------------------------------- L (J = flipped)
  { name: "L-spin slot", piece: "L", rows: ["XXX..", "X...X", "X.XXX"], fills: [2, 2, 1] },
  { name: "L-spin triple slot", piece: "L", rows: ["XX..", "X...", "X.XX", "X.XX", "X..X"], fills: [3, 3, 2] },

  // ---------------------------------------------------------------- I
  { name: "I-spin tuck", piece: "I", rows: ["X.XXXX", "X....X"], fills: [2, 1] },
  { name: "I-spin shaft", piece: "I", rows: ["XXXX.X", "XXXX.X", "X....X"], fills: [3, 1] }
];

/** Which cores a drill piece uses, and whether they are flipped. */
export function templatesFor(piece: DrillPiece): { templates: SpinTemplate[]; flip: "never" | "always" | "random" } {
  switch (piece) {
    case "T":
    case "I":
      return { templates: TEMPLATES.filter((t) => t.piece === piece), flip: "random" };
    case "S":
    case "L":
      return { templates: TEMPLATES.filter((t) => t.piece === piece), flip: "never" };
    case "Z":
      return { templates: TEMPLATES.filter((t) => t.piece === "S"), flip: "always" };
    case "J":
      return { templates: TEMPLATES.filter((t) => t.piece === "L"), flip: "always" };
  }
}

export const flipRows = (rows: readonly string[]): string[] => rows.map((r) => [...r].reverse().join(""));
