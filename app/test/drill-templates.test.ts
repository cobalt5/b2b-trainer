/**
 * Every spin core (and its flip) gives a line-clearing spin of its piece in
 * Triangle on at least some of its dressings (bumps can block an entry; the
 * generator just tries another board).
 */
import { describe, expect, it } from "vitest";

import { dressTemplate, probeEngine, rngFrom, spinFinishes } from "../src/drill/generate";
import { writeGrid } from "../src/drill/scenario";
import { TEMPLATES, flipRows, templatesFor } from "../src/drill/templates";

const flippedPiece = (p: string, flip: boolean) => (flip ? ({ S: "Z", L: "J" } as Record<string, string>)[p] ?? p : p);

describe("spin templates", () => {
  const e = probeEngine();
  for (const t of TEMPLATES) {
    for (const flip of [false, true]) {
      const piece = flippedPiece(t.piece, flip);
      it(`${t.name}${flip ? " (flipped)" : ""} → ${piece}-spin`, () => {
        const rng = rngFrom(11);
        let hits = 0;
        let boards = 0;
        for (let i = 0; i < 20; i++) {
          const d = dressTemplate(t, flip, rng, 2);
          if (!d) continue;
          boards++;
          writeGrid(e, d.grid);
          e.held = null;
          e.initiatePiece(piece.toLowerCase() as never);
          const best = spinFinishes(e)[0];
          if (best) {
            expect(best.info.piece).toBe(piece);
            expect(best.info.spin).not.toBe("none");
            expect(best.info.lines).toBeGreaterThan(0);
            hits++;
          }
        }
        expect(boards).toBeGreaterThan(10);
        expect(hits / boards).toBeGreaterThanOrEqual(0.15);
      });
    }
  }

  it("Z and J use the S and L cores flipped", () => {
    expect(templatesFor("Z").flip).toBe("always");
    expect(templatesFor("Z").templates.every((t) => t.piece === "S")).toBe(true);
    expect(templatesFor("J").templates.every((t) => t.piece === "L")).toBe(true);
    expect(flipRows(["X..", ".XX"])).toEqual(["..X", "XX."]);
  });
});
