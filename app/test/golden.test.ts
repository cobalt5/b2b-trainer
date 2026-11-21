/**
 * Golden spin set (Design_Doc §10): hand-made positions with a known finish.
 * For each one: Triangle reaches the expected clear, our classifier labels it,
 * and verifyPlacement accepts the matching SBP placement end to end.
 */
import type { LockRes } from "@haelp/teto/engine";
import { describe, expect, it } from "vitest";

import { locationFromCells } from "../src/adapter/coords";
import type { PieceId, Placement } from "../src/adapter/sbp-types";
import { classifyLock, lockLabels, type B2BClass } from "../src/game-core/clear";
import { enumerateFinals } from "../src/verify/search";
import { cloneEngine, verifyPlacement } from "../src/verify/verify";
import golden from "./golden/spins.json";
import { engineWith } from "./helpers";

interface Fixture {
  name: string;
  piece: string;
  rows: string[];
  expect: { lines: number; spin: Placement["spin"]; label: string; b2b: B2BClass | null };
}

describe("golden positions", () => {
  for (const g of golden as Fixture[]) {
    it(g.name, () => {
      const e = engineWith(g.rows, g.piece);
      const finals = enumerateFinals(e);
      let hit: { res: LockRes; board: unknown[][]; cells: [number, number][] } | null = null;
      for (const f of finals) {
        const c = cloneEngine(e);
        for (const k of f.path) c.press(k);
        const res = c.press("hardDrop") as LockRes;
        const spin = res.spin === "normal" ? "full" : res.spin;
        if (res.lines === g.expect.lines && spin === g.expect.spin) {
          hit = { res, board: c.board.state, cells: f.cells };
          break;
        }
      }
      expect(hit, `no reachable ${g.expect.lines}-line ${g.expect.spin} clear`).not.toBeNull();

      const info = classifyLock(hit!.res, hit!.board);
      expect(lockLabels(info).main).toBe(g.expect.label);
      expect(info.b2bClass).toBe(g.expect.b2b);
      expect(info.breaksB2B).toBe(g.expect.b2b === null);

      // The same placement, expressed in SBP, passes verify with the same result.
      const location = locationFromCells(g.piece.toUpperCase() as PieceId, hit!.cells)!;
      expect(location).not.toBeNull();
      const v = verifyPlacement(e, { location, spin: g.expect.spin });
      expect(v.ok, v.ok ? "" : v.detail).toBe(true);
      if (v.ok) {
        expect(v.info.lines).toBe(g.expect.lines);
        expect(v.info.spin).toBe(g.expect.spin);
      }
    });
  }
});
