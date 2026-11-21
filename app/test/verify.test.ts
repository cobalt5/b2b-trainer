import { describe, expect, it } from "vitest";

import { locationFromCells, triToSbp } from "../src/adapter/coords";
import { enumerateFinals } from "../src/verify/search";
import { verifyPlacement } from "../src/verify/verify";
import { engineWith } from "./helpers";

const TSD = ["XXXX......", "XXX...XXXX", "XXXX.XXXXX"];

describe("enumerateFinals", () => {
  it("leaves the engine's falling piece untouched", () => {
    const e = engineWith(TSD, "t");
    const before = JSON.stringify([e.falling.snapshot(), e.lastSpin]);
    enumerateFinals(e);
    expect(JSON.stringify([e.falling.snapshot(), e.lastSpin])).toBe(before);
  });

  it("finds every column/orientation on an empty board (T: 34 drops + spins at the floor)", () => {
    const finals = enumerateFinals(engineWith([], "t"));
    const distinctCells = new Set(finals.map((f) => f.cellsKey));
    // 8 + 9 + 8 + 9 = 34 distinct landing spots for T on a flat floor.
    expect(distinctCells.size).toBe(34);
  });

  it("is fast enough for multi-step plans", () => {
    const e = engineWith(TSD, "t");
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) enumerateFinals(e);
    expect((performance.now() - t0) / 10).toBeLessThan(40);
  });
});

describe("verifyPlacement", () => {
  it("accepts a reachable TSD and returns inputs and the engine after the lock", () => {
    const e = engineWith(TSD, "t");
    const v = verifyPlacement(e, { location: { piece: "T", orientation: "south", x: 4, y: 1 }, spin: "full" });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.info).toMatchObject({ lines: 2, spin: "full", b2bClass: "t-spin" });
    expect(v.inputs.at(-1)).toMatch(/^rotate/);
    expect(v.after.stats.b2b).toBe(0);
    expect(e.board.state[0]![4]).toBeNull(); // root not mutated
  });

  it("rejects a floating placement as unreachable", () => {
    const e = engineWith([], "t");
    const v = verifyPlacement(e, { location: { piece: "T", orientation: "north", x: 4, y: 5 }, spin: "none" });
    expect(v).toMatchObject({ ok: false, reason: "unreachable" });
  });

  it("rejects a sealed cave as unreachable", () => {
    const e = engineWith(["XXXXXXXXXX", "XXX...XXXX", "XXXX.XXXXX"], "t");
    const v = verifyPlacement(e, { location: { piece: "T", orientation: "south", x: 4, y: 1 }, spin: "full" });
    expect(v).toMatchObject({ ok: false, reason: "unreachable" });
  });

  it("rejects a clearing placement whose spin label disagrees with Triangle", () => {
    const e = engineWith(["XXX...XXXX"], "t");
    const v = verifyPlacement(e, { location: { piece: "T", orientation: "north", x: 4, y: 0 }, spin: "full" });
    expect(v).toMatchObject({ ok: false, reason: "spin-mismatch" });
  });

  it("accepts a spin-label disagreement on a non-clearing lock as a soft mismatch", () => {
    const e = engineWith([], "t");
    const v = verifyPlacement(e, { location: { piece: "T", orientation: "north", x: 4, y: 0 }, spin: "mini" });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.softMismatch).toEqual({ bot: "mini", triangle: "none" });
  });

  it("inserts a hold when the placement uses the held piece", () => {
    const e = engineWith([], "t", { hold: "i" });
    const v = verifyPlacement(e, { location: { piece: "I", orientation: "north", x: 1, y: 0 }, spin: "none" });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.usedHold).toBe(true);
      expect(v.inputs[0]).toBe("hold");
      expect(v.after.held).toBe("t");
    }
  });

  it("uses the next queue piece when hold is empty", () => {
    const e = engineWith([], "t", { seed: 3 });
    const next = e.queue[0]!.toUpperCase() as "I";
    expect(next).not.toBe("T");
    // All SBP north shapes have their lowest cell at dy = 0, so y = 0 is on the floor.
    const v = verifyPlacement(e, { location: { piece: next, orientation: "north", x: 4, y: 0 }, spin: "none" });
    expect(v.ok, v.ok ? "" : v.detail).toBe(true);
    if (v.ok) {
      expect(v.usedHold).toBe(true);
      expect(v.after.held).toBe("t");
    }
  });

  it("rejects pieces that are neither current nor reachable by hold", () => {
    const e = engineWith([], "t", { hold: "i" });
    const v = verifyPlacement(e, { location: { piece: "O", orientation: "north", x: 4, y: 0 }, spin: "none" });
    expect(v).toMatchObject({ ok: false, reason: "bad-piece" });
  });

  it("rejects using hold twice", () => {
    const e = engineWith([], "t", { hold: "i" });
    e.holdLocked = true;
    const v = verifyPlacement(e, { location: { piece: "I", orientation: "north", x: 1, y: 0 }, spin: "none" });
    expect(v).toMatchObject({ ok: false, reason: "hold-locked" });
  });

  it("verifies every landing spot on an empty board for all 7 pieces", () => {
    for (const p of ["i", "j", "l", "o", "s", "t", "z"]) {
      const e = engineWith([], p);
      for (const f of enumerateFinals(e).filter((x) => x.spin === null)) {
        const loc = locationFromCells(p.toUpperCase() as "I", f.cells)!;
        const v = verifyPlacement(e, { location: loc, spin: "none" });
        expect(v.ok, `${p} ${JSON.stringify(loc)}: ${v.ok ? "" : v.detail}`).toBe(true);
      }
    }
  });

  it("a straight drop from spawn needs zero inputs", () => {
    const e = engineWith([], "o");
    // O at Triangle (x, y=1) rotation 0 sits on the floor (cells at rows 0 and 1).
    const loc = triToSbp({ mino: e.falling.symbol, x: e.falling.x, y: 1, rotation: 0 });
    const v = verifyPlacement(e, { location: loc, spin: "none" });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.inputs).toEqual([]);
  });
});
