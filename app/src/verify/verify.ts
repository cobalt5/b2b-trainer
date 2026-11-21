/**
 * Check a bot placement against Triangle, which is the source of truth:
 * it must be reachable by real inputs and lock with the spin the bot
 * claimed. Returns the engine after the lock so plans can be chained.
 */

import { Engine, type EngineSnapshot, type LockRes, type SpinType } from "@haelp/teto/engine";

import { cellsKey } from "../adapter/coords";
import { sbpCells } from "../adapter/sbp";
import type { Placement } from "../adapter/sbp-types";
import { classifyLock, type LockInfo } from "../game-core/clear";
import { enumerateFinals, type SearchKey } from "./search";

export type InputKey = SearchKey | "hold";

export interface VerifiedStep {
  ok: true;
  placement: Placement;
  /** Inputs to reach the placement (hard drop implied). */
  inputs: InputKey[];
  usedHold: boolean;
  res: LockRes;
  info: LockInfo;
  /** Engine state right after this lock. */
  after: Engine;
  /** Set when the bot's spin label differed on a non-clearing lock (harmless, logged). */
  softMismatch?: { bot: Placement["spin"]; triangle: LockInfo["spin"] };
}

export type RejectReason = "bad-piece" | "hold-locked" | "unreachable" | "spin-mismatch";

export interface RejectedStep {
  ok: false;
  placement: Placement;
  reason: RejectReason;
  detail: string;
  /** For spin-mismatch: what Triangle produced for each reachable way in. */
  triangle?: { spin: LockInfo["spin"]; lines: number }[];
}

export type StepResult = VerifiedStep | RejectedStep;

export function cloneEngine(e: Engine): Engine {
  const c = new Engine(e.initializer);
  c.fromSnapshot(e.snapshot());
  return c;
}

export function engineFrom(initializer: Engine["initializer"], snap: EngineSnapshot): Engine {
  const e = new Engine(initializer);
  e.fromSnapshot(snap);
  return e;
}

const toSbpSpin = (s: SpinType | null): Placement["spin"] => (s === "normal" ? "full" : s === "mini" ? "mini" : "none");

/**
 * Verify one placement from `root` (not mutated). If the placement's piece
 * isn't the current piece, a hold is inserted first.
 */
export function verifyPlacement(root: Engine, placement: Placement): StepResult {
  const want = placement.location.piece.toLowerCase();
  const work = cloneEngine(root);
  const inputs: InputKey[] = [];
  let usedHold = false;

  if (work.falling.symbol !== want) {
    if (work.holdLocked) return { ok: false, placement, reason: "hold-locked", detail: "hold already used this piece" };
    work.press("hold");
    if (work.falling.symbol !== want) {
      return { ok: false, placement, reason: "bad-piece", detail: `piece ${placement.location.piece} is neither current nor reachable by hold` };
    }
    inputs.push("hold");
    usedHold = true;
  }

  const target = cellsKey(sbpCells(placement.location));
  const candidates = enumerateFinals(work).filter((f) => f.cellsKey === target);
  if (!candidates.length) {
    return { ok: false, placement, reason: "unreachable", detail: `no input path reaches ${placement.location.piece} ${placement.location.orientation} (${placement.location.x},${placement.location.y})` };
  }

  // Prefer a way in whose predicted spin matches the bot's label, then replay
  // it for real to get Triangle's authoritative LockRes.
  candidates.sort((a, b) => Number(toSbpSpin(b.spin) === placement.spin) - Number(toSbpSpin(a.spin) === placement.spin) || a.path.length - b.path.length);
  const tried: { spin: LockInfo["spin"]; lines: number }[] = [];
  let fallback: VerifiedStep | null = null;

  for (const c of candidates) {
    const e = cloneEngine(work);
    for (const k of c.path) e.press(k);
    const res = e.press("hardDrop") as LockRes;
    const info = classifyLock(res, e.board.state);
    const step: VerifiedStep = { ok: true, placement, inputs: [...inputs, ...c.path], usedHold, res, info, after: e };
    if (info.spin === placement.spin) return step;
    tried.push({ spin: info.spin, lines: info.lines });
    if (info.lines === 0) fallback ??= { ...step, softMismatch: { bot: placement.spin, triangle: info.spin } };
  }

  if (fallback) return fallback;
  return {
    ok: false,
    placement,
    reason: "spin-mismatch",
    detail: `bot says ${placement.spin}, Triangle gives ${[...new Set(tried.map((t) => t.spin))].join("/")}`,
    triangle: tried
  };
}
