/**
 * Classify a lock result. Triangle's LockRes has no B2B-class or
 * perfect-clear field (docs/notes.md §1), so we derive them here. The
 * planner (M5) uses the same rules.
 */

import type { LockRes } from "@haelp/teto/engine";

export type PieceLetter = "I" | "J" | "L" | "O" | "S" | "T" | "Z";

export type B2BClass = "quad" | "t-spin" | "t-spin-mini" | "allspin" | "allspin-mini" | "perfect-clear";

export interface LockInfo {
  piece: PieceLetter;
  lines: number;
  spin: "none" | "mini" | "full";
  perfectClear: boolean;
  /** Set when this clear keeps or extends B2B. */
  b2bClass: B2BClass | null;
  /** A line clear that resets B2B (a clear outside the B2B classes). */
  breaksB2B: boolean;
  /** Engine B2B counter after the lock (−1 = none). */
  b2b: number;
  combo: number;
  /** Garbage released by Surge on this lock. */
  surge: number;
  topout: boolean;
}

const LINE_NAMES = ["", "Single", "Double", "Triple", "Quad"];

export function isBoardEmpty(board: readonly (readonly unknown[])[]): boolean {
  for (const row of board) for (const c of row) if (c) return false;
  return true;
}

export function classifyLock(res: Pick<LockRes, "mino" | "lines" | "spin" | "stats" | "surge" | "topout">, boardAfter: readonly (readonly unknown[])[]): LockInfo {
  const piece = res.mino.toUpperCase() as PieceLetter;
  const spin = res.spin === "normal" ? "full" : res.spin;
  const lines = res.lines;
  const perfectClear = lines > 0 && isBoardEmpty(boardAfter);

  let b2bClass: B2BClass | null = null;
  if (lines > 0) {
    if (spin !== "none") {
      const t = piece === "T";
      b2bClass = spin === "full" ? (t ? "t-spin" : "allspin") : t ? "t-spin-mini" : "allspin-mini";
    } else if (lines === 4) b2bClass = "quad";
    else if (perfectClear) b2bClass = "perfect-clear";
  }

  return {
    piece,
    lines,
    spin,
    perfectClear,
    b2bClass,
    breaksB2B: lines > 0 && b2bClass === null,
    b2b: res.stats.b2b,
    combo: res.stats.combo,
    surge: res.surge,
    topout: res.topout
  };
}

/** Human label lines for a lock, e.g. ["T-Spin Double", "B2B ×3", "2 Combo"]. */
export function lockLabels(info: LockInfo): { main: string | null; extras: string[] } {
  let main: string | null = null;
  if (info.spin !== "none") {
    main = `${info.piece}-Spin${info.lines ? " " + LINE_NAMES[info.lines] : ""}${info.spin === "mini" ? " Mini" : ""}`;
  } else if (info.lines > 0) {
    main = LINE_NAMES[info.lines] ?? `${info.lines} lines`;
  }

  const extras: string[] = [];
  if (info.perfectClear) extras.push("All Clear");
  if (info.b2bClass && info.b2b > 0) extras.push(`B2B ×${info.b2b}`);
  if (info.surge > 0) extras.push(`Surge ${info.surge}`);
  if (info.lines > 0 && info.combo > 0) extras.push(`${info.combo} Combo`);
  return { main, extras };
}
