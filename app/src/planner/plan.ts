/**
 * Hint planners (Design_Doc §4). Both make one bot request per hint and then
 * verify every step in a cloned Triangle engine (Triangle is the truth).
 *
 * Strategy B, "beam" (default): the fork's `b2btrainer.b2b_plan` extension
 * runs a beam search over the known queue (with hold) for sequences that end
 * at the first B2B-source clear without breaking B2B on the way, and returns
 * the top N, each with a different finishing placement.
 *
 * Strategy A, "pv-walk": the bot's own line, cut at the next B2B-keeping clear.
 *
 *  1. One suggest with the fork's extensions returns the top-N first moves
 *     and, from the same search tree, the bot's line after each of them
 *     (`b2btrainer.pv_all`). One request per hint keeps latency down.
 *  2. Walk each line in a cloned Triangle engine, verifying every step:
 *     - B2B-source clear → plan ends here (success);
 *     - a clear outside the B2B classes → line discarded;
 *     - no clear → keep going; out of known pieces → no plan from this line.
 *
 * Steps before the final one never clear lines, so every step's cells are in
 * the mirror board's coordinates and the outlines can all be drawn at once.
 */

import type { Engine } from "@haelp/teto/engine";

import { cellsKey } from "../adapter/coords";
import { sbpCells, toStart } from "../adapter/sbp";
import { EXT, type B2BPlanRequest, type B2BPlanWire, type Placement, type SuggestionMsg } from "../adapter/sbp-types";
import type { B2BClass, LockInfo } from "../game-core/clear";
import type { MirrorState } from "../game-core/mirror";
import type { MismatchLog } from "../verify/mismatch-log";
import { engineFrom, verifyPlacement } from "../verify/verify";
import type { BotRunner } from "./bot-client";
import type { HintStep } from "./hint";

export type PlanStrategy = "pv-walk" | "beam";

export interface Plan {
  steps: HintStep[];
  /** The final step's classification (always a B2B-source clear). */
  final: LockInfo;
  score: number;
}

export interface PlanResult {
  /** MirrorState.version it was computed for. */
  version: number;
  /** Best first; empty when no B2B clear is reachable with the known pieces. */
  plans: Plan[];
  /** The bot's verified best move, shown when `plans` is empty. */
  fallback: HintStep | null;
  /** Bot time (sum over requests), ms. */
  botMs: number;
  verifyMs: number;
  /** Bot moves Triangle rejected (each one is logged). */
  rejected: number;
}

export interface PlanOptions {
  previews: number;
  topN: number;
  /** Default "pv-walk" (strategy A). */
  strategy?: PlanStrategy;
  /** Strategy B: non-clearing states kept per layer. */
  beamWidth?: number;
  /**
   * Strategy B: iterations for the bot's regular search, whose best move is
   * only the no-plan fallback (default BEAM_FALLBACK_ITERATIONS).
   */
  fallbackIterations?: number;
  /** Strategy A: search iterations for this request (settings: search budget). */
  iterations?: number;
  timeoutMs?: number;
  log?: MismatchLog;
  /** Ranking knobs (Design_Doc §4). */
  lengthPenalty?: number;
  spinBonus?: number;
}

/**
 * In beam mode the regular search only supplies the fallback move. Its time
 * varies a lot with the position (4000 iterations: p95 ≈ 400 ms), while the
 * beam itself is steady (width 300: p95 ≈ 65 ms), so keep the search small.
 */
export const BEAM_FALLBACK_ITERATIONS = 500;

/** Value of the finishing clear: spins over quads, bigger over smaller. */
const CLASS_VALUE: Record<B2BClass, number> = {
  "perfect-clear": 10,
  "t-spin": 4,
  quad: 4,
  allspin: 3,
  "t-spin-mini": 1.5,
  "allspin-mini": 1.5
};

export function scorePlan(final: LockInfo, length: number, opts: Pick<PlanOptions, "lengthPenalty" | "spinBonus"> = {}): number {
  const lengthPenalty = opts.lengthPenalty ?? 0.6;
  const spinBonus = opts.spinBonus ?? 0.5;
  const cls = final.b2bClass ? CLASS_VALUE[final.b2bClass] : 0;
  return cls + final.lines * 0.5 + (final.spin !== "none" ? spinBonus : 0) - lengthPenalty * (length - 1);
}

type LineOutcome =
  | { kind: "plan"; plan: Plan }
  | { kind: "breaks" | "exhausted" | "rejected"; firstStep: HintStep | null };

export function toStep(placement: Placement, info: LockInfo, inputs: HintStep["inputs"], usedHold: boolean): HintStep {
  return {
    placement,
    cells: sbpCells(placement.location),
    mino: placement.location.piece.toLowerCase(),
    usesHold: usedHold,
    info,
    inputs
  };
}

/** Verify a bot line step by step from `root` and cut it at the next B2B clear. */
export function walkLine(root: Engine, line: readonly Placement[], opts: Pick<PlanOptions, "log" | "lengthPenalty" | "spinBonus"> & { start?: unknown } = {}): LineOutcome {
  let engine = root;
  const steps: HintStep[] = [];
  for (const placement of line) {
    const v = verifyPlacement(engine, placement);
    if (!v.ok) {
      opts.log?.add({ reason: v.reason, detail: `${v.detail} (plan step ${steps.length + 1})`, placement, start: opts.start as never });
      return { kind: "rejected", firstStep: steps[0] ?? null };
    }
    if (v.softMismatch) {
      opts.log?.add({ reason: "soft-spin", detail: `bot ${v.softMismatch.bot} vs Triangle ${v.softMismatch.triangle} (no lines cleared)`, placement, start: opts.start as never });
    }
    const step = toStep(placement, v.info, v.inputs, v.usedHold);
    steps.push(step);
    if (v.info.b2bClass) {
      return { kind: "plan", plan: { steps, final: v.info, score: scorePlan(v.info, steps.length, opts) } };
    }
    if (v.info.breaksB2B) return { kind: "breaks", firstStep: steps[0]! };
    engine = v.after;
  }
  return { kind: "exhausted", firstStep: steps[0] ?? null };
}

interface Line {
  moves: Placement[];
  /** Bot-side plan score (strategy B only). */
  score?: number;
}

const linesOf = (s: SuggestionMsg | undefined): Line[] => {
  const pvs = s?.extensions?.[EXT.pvs];
  const moves = s?.moves ?? [];
  // One line per top move; fall back to the bare move if the bot sent no lines.
  return moves.map((mv, i) => {
    const line = Array.isArray(pvs) && Array.isArray(pvs[i]) ? (pvs[i] as Placement[]) : [];
    return { moves: line.length ? line : [mv] };
  });
};

const plansOf = (s: SuggestionMsg | undefined): Line[] => {
  const raw = s?.extensions?.[EXT.b2bPlans];
  if (!Array.isArray(raw)) return [];
  return (raw as Partial<B2BPlanWire>[])
    .filter((p): p is B2BPlanWire => Array.isArray(p?.moves) && p.moves.length > 0)
    .map((p) => ({ moves: p.moves, score: typeof p.score === "number" ? p.score : undefined }));
};

/** Request body for `b2btrainer.b2b_plan` (Design_Doc §6.3). */
export function b2bPlanRequest(opts: PlanOptions, knownPieces: number): B2BPlanRequest {
  const req: B2BPlanRequest = { max_depth: knownPieces, top_n: Math.max(1, opts.topN) };
  if (opts.beamWidth) req.beam_width = opts.beamWidth;
  if (opts.lengthPenalty !== undefined) req.length_penalty = opts.lengthPenalty;
  if (opts.spinBonus !== undefined) req.spin_bonus = opts.spinBonus;
  return req;
}

export async function requestPlans(bot: BotRunner, mirror: MirrorState, opts: PlanOptions): Promise<PlanResult> {
  const start = toStart(mirror, opts.previews);
  // Placements available: the active piece plus every visible preview.
  const depth = start.queue.length + 1;
  const base = [{ type: "stop" as const }, start];
  const beam = opts.strategy === "beam";

  const ext: Record<string, unknown> = beam
    ? { [EXT.b2bPlan]: b2bPlanRequest(opts, depth + (start.hold ? 1 : 0)) }
    : { [EXT.topN]: Math.max(1, opts.topN), [EXT.pvAll]: true, [EXT.pv]: depth };
  const iterations = beam ? (opts.fallbackIterations ?? BEAM_FALLBACK_ITERATIONS) : opts.iterations;
  if (iterations) ext[EXT.iterations] = iterations;
  const res = await bot.run([...base, { type: "suggest", extensions: ext }], "suggestion", opts.timeoutMs);
  const moves = res.suggestion?.moves ?? [];
  // Strategy B: the planner's sequences. A: one bot line per top move.
  const lines = beam ? plansOf(res.suggestion) : linesOf(res.suggestion);
  const botMs = res.ms;

  const t0 = performance.now();
  const root = engineFrom(mirror.initializer, mirror.snapshot);
  const plans: Plan[] = [];
  const seen = new Set<string>();
  let fallback: HintStep | null = null;
  let rejected = 0;

  lines.forEach(({ moves: line, score }, i) => {
    const out = walkLine(root, line, { ...opts, start });
    if (out.kind === "plan") {
      const key = out.plan.steps.map((s) => cellsKey(s.cells)).join("|");
      if (!seen.has(key)) {
        seen.add(key);
        // Strategy B keeps the bot's ranking (its evaluator scored the leaf).
        plans.push(score === undefined ? out.plan : { ...out.plan, score });
      }
    } else if (beam) {
      // Every beam plan should verify as a B2B finish; anything else is a
      // bot/Triangle disagreement (rejects are logged by walkLine).
      rejected++;
      if (out.kind !== "rejected") {
        opts.log?.add({ reason: "plan-outcome", detail: `b2b_plan ${i + 1} ${out.kind} in Triangle`, placement: line.at(-1)!, start });
      }
    } else {
      if (out.kind === "rejected") rejected++;
      if (i === 0) fallback = out.firstStep;
    }
  });
  plans.sort((a, b) => b.score - a.score);
  if (beam) plans.splice(Math.max(1, opts.topN));

  // Strategy B with no usable plan: the search's best move is the fallback.
  if (beam && !plans.length && moves[0]) {
    const out = walkLine(root, [moves[0]], { ...opts, start });
    if (out.kind === "rejected") rejected++;
    else fallback = out.kind === "plan" ? out.plan.steps[0]! : out.firstStep;
  }

  // If the best line had no usable first step (rejected at step 1), fall back
  // to the first alternative that verifies.
  if (!plans.length && !fallback) {
    for (const mv of moves.slice(1)) {
      const out = walkLine(root, [mv], { ...opts, start });
      if (out.kind !== "rejected") {
        fallback = out.kind === "plan" ? out.plan.steps[0]! : out.firstStep;
        break;
      }
    }
  }

  return { version: mirror.version, plans, fallback, botMs, verifyMs: performance.now() - t0, rejected };
}
