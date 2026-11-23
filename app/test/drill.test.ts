/** DrillController grading: pass, better-spin notes, fails, undo and line tracking. */
import type { Engine, LockRes } from "@haelp/teto/engine";
import { describe, expect, it } from "vitest";

import { DrillController } from "../src/drill/drill";
import { probeEngine, replay, spinFinishes } from "../src/drill/generate";
import { applyScenario, type Scenario } from "../src/drill/scenario";
import { classifyLock, type LockInfo } from "../src/game-core/clear";
import { enumerateFinals } from "../src/verify/search";
import { cloneEngine } from "../src/verify/verify";

/** A hand-made depth-1 T drill on the golden TSD board. */
function tsdDrill(depth = 1): { s: Scenario; start: () => Engine } {
  const rows = ["XXXX......", "XXX...XXXX", "XXXX.XXXXX"];
  const start = { rows, current: "t" as never, hold: null, queue: ["o", "i", "l", "j", "s"] as never[] };
  const e = probeEngine();
  applyScenario(e, start);
  const tsd = spinFinishes(e).find((f) => f.info.lines === 2)!;
  const solution = replay(start, [{ piece: "T", cells: tsd.final.cells }], "full")!;
  const s: Scenario = { piece: "T", depth, ...start, solution, intended: solution[0]!.info, name: "T-Spin Double", template: "TSD slot", seed: 1 };
  return {
    s,
    start: () => {
      const x = probeEngine();
      applyScenario(x, s);
      return x;
    }
  };
}

/** Play one reachable final of the current piece matching `pick`, returning the lock. */
function lockWhere(e: Engine, pick: (info: LockInfo) => boolean) {
  for (const f of enumerateFinals(e)) {
    const c = cloneEngine(e);
    for (const k of f.path) c.press(k);
    const res = c.press("hardDrop") as LockRes;
    const info = classifyLock(res, c.board.state);
    if (pick(info)) return { info, cells: f.cells, after: c };
  }
  throw new Error("no such placement");
}

describe("DrillController", () => {
  it("passes on the intended spin with no notes, and follows the line", () => {
    const { s, start } = tsdDrill();
    const d = new DrillController();
    d.load(s);
    expect(d.remainingSolution()).toHaveLength(1);
    const step = s.solution[0]!;
    const r = d.onLock({ info: step.info, cells: step.cells, before: start });
    expect(r?.status).toBe("passed");
    expect(r?.headline).toBe("T-Spin Double");
    expect(r?.notes).toEqual([]);
    expect(d.stats).toMatchObject({ attempted: 1, passed: 1, streak: 1, bestStreak: 1 });
    expect(d.stats.byPiece.T).toEqual({ attempted: 1, passed: 1 });
  });

  it("passes a weaker spin but points out the better one", () => {
    const { s, start } = tsdDrill();
    const d = new DrillController();
    d.load(s);
    const tss = lockWhere(start(), (i) => i.piece === "T" && i.spin === "full" && i.lines === 1);
    const r = d.onLock({ info: tss.info, cells: tss.cells, before: start });
    expect(r?.status).toBe("passed");
    expect(r?.headline).toBe("T-Spin Single");
    expect(r?.notes).toEqual(["A T-Spin Double was available here"]);
  });

  it("fails a clear that isn't the drill's spin", () => {
    const { s, start } = tsdDrill(2);
    const d = new DrillController();
    d.load(s);
    const info: LockInfo = { ...s.intended, spin: "none", lines: 1, b2bClass: null, breaksB2B: true };
    const r = d.onLock({ info, cells: [[0, 0]], before: start });
    expect(r?.status).toBe("failed");
    expect(r?.headline).toBe("Single: not a T-spin");
    expect(r?.notes).toEqual(["The generated line reaches T-Spin Double"]);
    expect(d.stats.streak).toBe(0);
  });

  it("fails after depth pieces without the spin, and tracks leaving the line", () => {
    const { s, start } = tsdDrill(2);
    const d = new DrillController();
    d.load(s);
    const noClear: LockInfo = { ...s.intended, spin: "none", lines: 0, b2bClass: null, breaksB2B: false };
    expect(d.onLock({ info: noClear, cells: [[9, 9]], before: start })).toBeNull();
    expect(d.onLine).toBe(false);
    expect(d.remainingSolution()).toBeNull();
    const r = d.onLock({ info: noClear, cells: [[9, 10]], before: start });
    expect(r?.status).toBe("failed");
    expect(r?.headline).toBe("No T-spin within 2 pieces");
  });

  it("undo takes back a lock while the drill runs; retry starts over", () => {
    const { s, start } = tsdDrill(3);
    const d = new DrillController();
    d.load(s);
    const noClear: LockInfo = { ...s.intended, spin: "none", lines: 0, b2bClass: null, breaksB2B: false };
    d.onLock({ info: noClear, cells: [[9, 9]], before: start });
    expect(d.placed).toBe(1);
    expect(d.onLine).toBe(false);
    expect(d.undo()).toBe(true);
    expect(d.placed).toBe(0);
    expect(d.onLine).toBe(true);
    expect(d.undo()).toBe(false);
    d.onLock({ info: noClear, cells: [[9, 9]], before: start });
    d.retry();
    expect([d.placed, d.status, d.onLine]).toEqual([0, "playing", true]);
  });

  it("uses an article that reads right for each piece", () => {
    const { s, start } = tsdDrill(2);
    const d = new DrillController();
    d.load({ ...s, piece: "L" });
    const info: LockInfo = { ...s.intended, piece: "O", spin: "none", lines: 2, b2bClass: null, breaksB2B: true };
    expect(d.onLock({ info, cells: [[0, 0]], before: start })?.headline).toBe("Double: not an L-spin");
  });
});
