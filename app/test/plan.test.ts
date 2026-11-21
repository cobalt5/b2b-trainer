import { describe, expect, it } from "vitest";

import type { ForwardableMsg, RunOk } from "../src/adapter/bridge-types";
import { EXT, type Placement } from "../src/adapter/sbp-types";
import { mirrorFromSnapshot } from "../src/game-core/mirror";
import type { BotRunner } from "../src/planner/bot-client";
import { BEAM_FALLBACK_ITERATIONS, requestPlans, scorePlan, walkLine } from "../src/planner/plan";
import { engineWith } from "./helpers";

const TSD_ROWS = ["XXXX......", "XXX...XXXX", "XXXX.XXXXX"];
const TSD: Placement = { location: { piece: "T", orientation: "south", x: 4, y: 1 }, spin: "full" };
const O_PARK: Placement = { location: { piece: "O", orientation: "north", x: 8, y: 2 }, spin: "none" };
const I_FLAT: Placement = { location: { piece: "I", orientation: "north", x: 8, y: 3 }, spin: "none" };

/** Board where T is next after an O: park the O on the right, then TSD. */
function oThenT() {
  const e = engineWith(TSD_ROWS, "o");
  e.queue[0] = "t" as never;
  return e;
}

/** Fake bot: returns `top` moves with one line per move (`lines[i]`, default [top[i]]). */
function scriptedBot(top: Placement[], lines: Placement[][] = []) {
  const calls: ForwardableMsg[][] = [];
  const bot: BotRunner = {
    async run(msgs) {
      calls.push(msgs);
      const pvs = top.map((m, i) => lines[i] ?? [m]);
      return { id: 0, ok: true, ms: 5, epoch: 1, suggestion: { type: "suggestion", moves: top, extensions: { [EXT.pvs]: pvs } } } satisfies RunOk;
    }
  };
  return { bot, calls };
}

const mirrorOf = (e: ReturnType<typeof engineWith>) => mirrorFromSnapshot(e.snapshot(), e.initializer);

describe("walkLine", () => {
  it("ends a plan at the first B2B clear", () => {
    const out = walkLine(engineWith(TSD_ROWS, "t"), [TSD]);
    expect(out.kind).toBe("plan");
    if (out.kind === "plan") {
      expect(out.plan.steps).toHaveLength(1);
      expect(out.plan.final).toMatchObject({ b2bClass: "t-spin", lines: 2 });
    }
  });

  it("chains non-clearing steps before the finish", () => {
    const out = walkLine(oThenT(), [O_PARK, TSD]);
    expect(out.kind).toBe("plan");
    if (out.kind === "plan") expect(out.plan.steps.map((s) => s.mino)).toEqual(["o", "t"]);
  });

  it("discards a line that clears lines without keeping B2B", () => {
    const e = engineWith(["XXXXXX....", "XXXXXX...."], "i");
    const out = walkLine(e, [{ location: { piece: "I", orientation: "north", x: 7, y: 0 }, spin: "none" }]);
    expect(out.kind).toBe("breaks");
  });

  it("reports an exhausted line", () => {
    expect(walkLine(oThenT(), [O_PARK]).kind).toBe("exhausted");
  });
});

describe("requestPlans", () => {
  it("builds plans from the best line and alternatives, best score first", async () => {
    const e = oThenT();
    // best line: O park → TSD (2 pieces). alternative first move: an O elsewhere, then TSD.
    const O_LEFT: Placement = { location: { piece: "O", orientation: "north", x: 6, y: 2 }, spin: "none" };
    const { bot, calls } = scriptedBot([O_PARK, O_LEFT], [[O_PARK, TSD], [O_LEFT, TSD]]);
    const r = await requestPlans(bot, mirrorOf(e), { previews: 5, topN: 2, iterations: 4000 });
    expect(r.plans).toHaveLength(2);
    expect(r.plans.every((p) => p.final.b2bClass === "t-spin")).toBe(true);
    expect(r.fallback).toBeNull();
    // a single request carries every extension
    expect(calls).toHaveLength(1);
    expect(calls[0]!.map((m) => m.type)).toEqual(["stop", "start", "suggest"]);
    expect((calls[0]!.at(-1) as any).extensions).toEqual({ [EXT.topN]: 2, [EXT.pvAll]: true, [EXT.pv]: 6, [EXT.iterations]: 4000 });
  });

  it("dedupes identical plans", async () => {
    const e = engineWith(TSD_ROWS, "t");
    const { bot } = scriptedBot([TSD, TSD]);
    const r = await requestPlans(bot, mirrorOf(e), { previews: 5, topN: 2 });
    expect(r.plans).toHaveLength(1);
  });

  it("falls back to the bot's best move when no B2B clear is reachable", async () => {
    const e = engineWith([], "i");
    const { bot } = scriptedBot([I_FLAT]);
    const flatFloor: Placement = { location: { piece: "I", orientation: "north", x: 4, y: 0 }, spin: "none" };
    const { bot: bot2 } = scriptedBot([flatFloor]);
    const r = await requestPlans(bot2, mirrorOf(e), { previews: 5, topN: 1 });
    expect(r.plans).toEqual([]);
    expect(r.fallback?.placement).toEqual(flatFloor);
    // an unreachable best move is rejected, counted, and gives no fallback
    const r2 = await requestPlans(bot, mirrorOf(e), { previews: 5, topN: 1 });
    expect(r2.rejected).toBe(1);
    expect(r2.fallback).toBeNull();
  });
});

describe("scorePlan", () => {
  it("prefers spins and shorter plans", () => {
    const tsd = { b2bClass: "t-spin", lines: 2, spin: "full" } as any;
    const quad = { b2bClass: "quad", lines: 4, spin: "none" } as any;
    const mini = { b2bClass: "allspin-mini", lines: 1, spin: "mini" } as any;
    expect(scorePlan(tsd, 1)).toBeGreaterThan(scorePlan(tsd, 3));
    expect(scorePlan(tsd, 2)).toBeGreaterThan(scorePlan(mini, 2));
    expect(scorePlan(quad, 1)).toBeGreaterThan(scorePlan(mini, 1));
  });
});

/** Fake bot for strategy B: `moves` is the search's best move, `plans` the b2b_plans payload. */
function beamBot(moves: Placement[], plans: { moves: Placement[]; score: number }[]) {
  const calls: ForwardableMsg[][] = [];
  const bot: BotRunner = {
    async run(msgs) {
      calls.push(msgs);
      const wire = plans.map((p) => ({ ...p, final_clear: { lines: 2, spin: "full", b2b_class: "t-spin", perfect_clear: false } }));
      return { id: 0, ok: true, ms: 5, epoch: 1, suggestion: { type: "suggestion", moves, extensions: { [EXT.b2bPlans]: wire } } } satisfies RunOk;
    }
  };
  return { bot, calls };
}

describe("requestPlans (strategy B: beam)", () => {
  const O_LEFT: Placement = { location: { piece: "O", orientation: "north", x: 6, y: 2 }, spin: "none" };

  it("sends one b2b_plan request and keeps the bot's ranking", async () => {
    const { bot, calls } = beamBot([O_PARK], [
      { moves: [O_LEFT, TSD], score: 9 },
      { moves: [O_PARK, TSD], score: 7 }
    ]);
    const r = await requestPlans(bot, mirrorOf(oThenT()), { previews: 5, topN: 3, strategy: "beam", beamWidth: 200, iterations: 4000 });
    expect(calls).toHaveLength(1);
    expect((calls[0]!.at(-1) as any).extensions).toEqual({
      [EXT.b2bPlan]: { max_depth: 6, top_n: 3, beam_width: 200 },
      // the regular search only feeds the fallback: small fixed budget
      [EXT.iterations]: BEAM_FALLBACK_ITERATIONS
    });
    expect(r.plans.map((p) => p.score)).toEqual([9, 7]);
    expect(r.plans[0]!.steps[0]!.placement).toEqual(O_LEFT);
    expect(r.plans.every((p) => p.final.b2bClass === "t-spin")).toBe(true);
    expect(r.fallback).toBeNull();
    expect(r.rejected).toBe(0);
  });

  it("counts hold among the known pieces", async () => {
    const e = oThenT();
    e.press("hold"); // O to hold, T current
    const { bot, calls } = beamBot([], []);
    await requestPlans(bot, mirrorOf(e), { previews: 5, topN: 3, strategy: "beam" });
    expect((calls[0]!.at(-1) as any).extensions[EXT.b2bPlan].max_depth).toBe(7);
  });

  it("drops and counts plans Triangle doesn't confirm as a B2B finish", async () => {
    const BAD_T: Placement = { location: { piece: "T", orientation: "north", x: 1, y: 0 }, spin: "full" };
    const { bot } = beamBot([O_PARK], [
      { moves: [O_PARK, BAD_T], score: 9 }, // unreachable / wrong spin
      { moves: [O_PARK], score: 8 }, // no clear at all: "exhausted"
      { moves: [O_PARK, TSD], score: 1 }
    ]);
    const r = await requestPlans(bot, mirrorOf(oThenT()), { previews: 5, topN: 3, strategy: "beam" });
    expect(r.plans).toHaveLength(1);
    expect(r.rejected).toBe(2);
  });

  it("falls back to the search's best move when there is no plan", async () => {
    const flatFloor: Placement = { location: { piece: "I", orientation: "north", x: 4, y: 0 }, spin: "none" };
    const { bot } = beamBot([flatFloor], []);
    const r = await requestPlans(bot, mirrorOf(engineWith([], "i")), { previews: 5, topN: 3, strategy: "beam" });
    expect(r.plans).toEqual([]);
    expect(r.fallback?.placement).toEqual(flatFloor);
  });
});
