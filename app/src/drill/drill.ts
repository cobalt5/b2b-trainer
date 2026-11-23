/**
 * Drill state and grading (no DOM).
 *
 * Pass: a line-clearing spin of the drill's piece within `depth` pieces (any
 * spin counts). Better results are pointed out: the best spin that was
 * reachable from the position the spin was made from, and the generated
 * line's own finish.
 * Fail: any other line clear, a top out, or `depth` pieces without the spin.
 */

import type { Engine } from "@haelp/teto/engine";

import { lockLabels, type LockInfo } from "../game-core/clear";
import type { HintStep } from "../planner/hint";
import { sameCells } from "../planner/hint-stats";
import { scorePlan } from "../planner/plan";
import { bestSpin } from "./generate";
import { DRILL_PIECES, type DrillPiece, type Scenario } from "./scenario";

export type DrillStatus = "playing" | "passed" | "failed";

export interface DrillResult {
  status: "passed" | "failed";
  /** e.g. "T-Spin Double" or "Cleared a Single: not a T-spin". */
  headline: string;
  /** Better results the user missed (pass) or what was intended (fail). */
  notes: string[];
}

export interface DrillStats {
  attempted: number;
  passed: number;
  streak: number;
  bestStreak: number;
  hintsUsed: number;
  byPiece: Record<DrillPiece, { attempted: number; passed: number }>;
}

const emptyStats = (): DrillStats => ({
  attempted: 0,
  passed: 0,
  streak: 0,
  bestStreak: 0,
  hintsUsed: 0,
  byPiece: Object.fromEntries(DRILL_PIECES.map((p) => [p, { attempted: 0, passed: 0 }])) as DrillStats["byPiece"]
});

const label = (info: LockInfo) => lockLabels(info).main ?? `${info.lines} lines`;
const score = (info: LockInfo) => scorePlan(info, 1, { lengthPenalty: 0 });
/** Scores closer than this are the same result. */
const EPS = 1e-6;

export interface DrillLock {
  info: LockInfo;
  /** Cells the piece was placed on. */
  cells: readonly (readonly [number, number])[];
  /** Engine state the lock was made from (for "a better spin was available"). */
  before: () => Engine;
}

export class DrillController {
  scenario: Scenario | null = null;
  status: DrillStatus = "playing";
  placed = 0;
  result: DrillResult | null = null;
  /** The user's locks so far all matched the generated line. */
  onLine = true;
  /** onLine before each lock, for undo. */
  #history: boolean[] = [];
  #stats = emptyStats();

  get stats(): Readonly<DrillStats> {
    return this.#stats;
  }

  load(s: Scenario): void {
    this.scenario = s;
    this.retry();
  }

  /** Back to the start of the same drill. */
  retry(): void {
    this.status = "playing";
    this.placed = 0;
    this.result = null;
    this.onLine = true;
    this.#history = [];
  }

  /** Take back the last lock while the drill is still running. */
  undo(): boolean {
    if (this.status !== "playing" || !this.#history.length) return false;
    this.onLine = this.#history.pop()!;
    this.placed--;
    return true;
  }

  hintUsed(): void {
    this.#stats.hintsUsed++;
  }

  /** Solution steps still ahead, or null once the user has left the generated line. */
  remainingSolution(): HintStep[] | null {
    const s = this.scenario;
    if (!s || !this.onLine) return null;
    return s.solution.slice(this.placed);
  }

  /** Grade a lock. Returns the result when the drill ends with it. */
  onLock(lock: DrillLock): DrillResult | null {
    const s = this.scenario;
    if (!s || this.status !== "playing") return null;
    const step = s.solution[this.placed];
    this.#history.push(this.onLine);
    this.onLine = this.onLine && !!step && sameCells(lock.cells, step.cells);
    this.placed++;
    const { info } = lock;

    if (info.piece === s.piece && info.spin !== "none" && info.lines > 0) {
      return this.#finish({ status: "passed", headline: label(info), notes: this.#missed(lock) });
    }
    const pieceName = `${s.piece}-spin`;
    if (info.topout) return this.#finish({ status: "failed", headline: "Topped out", notes: [this.#intendedNote()] });
    if (info.lines > 0) {
      return this.#finish({ status: "failed", headline: `${label(info)}: not ${article(pieceName)} ${pieceName}`, notes: [this.#intendedNote()] });
    }
    if (this.placed >= s.depth) {
      const n = s.depth;
      return this.#finish({ status: "failed", headline: `No ${pieceName} within ${n} piece${n > 1 ? "s" : ""}`, notes: [this.#intendedNote()] });
    }
    return null;
  }

  #intendedNote(): string {
    const s = this.scenario!;
    return `The generated line reaches ${label(s.intended)}`;
  }

  /** Better spins than the one made: from the same position, and the generated line's finish. */
  #missed(lock: DrillLock): string[] {
    const s = this.scenario!;
    const mine = score(lock.info);
    const notes: string[] = [];
    let localBest: LockInfo | null = null;
    try {
      localBest = bestSpin(lock.before(), s.piece)?.info ?? null;
    } catch {
      localBest = null;
    }
    if (localBest && score(localBest) > mine + EPS) notes.push(`${article(label(localBest), true)} ${label(localBest)} was available here`);
    const intended = s.intended;
    if (score(intended) > mine + EPS && (!localBest || label(localBest) !== label(intended))) {
      notes.push(`The generated line reaches ${label(intended)}`);
    }
    return notes;
  }

  #finish(r: DrillResult): DrillResult {
    const s = this.scenario!;
    this.status = r.status;
    this.result = r;
    const st = this.#stats;
    const per = st.byPiece[s.piece];
    st.attempted++;
    per.attempted++;
    if (r.status === "passed") {
      st.passed++;
      per.passed++;
      st.streak++;
      st.bestStreak = Math.max(st.bestStreak, st.streak);
    } else {
      st.streak = 0;
    }
    return r;
  }

  resetStats(): void {
    this.#stats = emptyStats();
  }
}

/** "a" / "an" for a label like "I-Spin Single Mini" (the letter is said aloud: "an I-spin", "an L-spin"). */
function article(word: string, capital = false): string {
  const an = /^[AEFHILMNORSX]-|^[aeiou]/i.test(word);
  const a = an ? "an" : "a";
  return capital ? a[0]!.toUpperCase() + a.slice(1) : a;
}
