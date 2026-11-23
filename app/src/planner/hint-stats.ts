/**
 * Hint usage stats (Design_Doc §3.1.7): hints requested, and how often the
 * user's next lock matched hint step 1.
 *
 * A step counts as "shown" when the user locks a piece while a hint for that
 * exact position is on screen. It counts as "matched" when the lock lands on
 * the same cells (cells, not anchors, decide equality; see docs/notes.md §4).
 */

import { cellsKey } from "../adapter/coords";

export interface HintStatsValue {
  /** Hint key presses that produced a hint. */
  hintsUsed: number;
  /** Locks made while a hint step 1 was shown for that position. */
  stepsShown: number;
  /** ...of which landed on step 1's cells. */
  stepsMatched: number;
}

export class HintStats {
  #v: HintStatsValue = { hintsUsed: 0, stepsShown: 0, stepsMatched: 0 };

  get value(): Readonly<HintStatsValue> {
    return this.#v;
  }

  /** Percent of shown step 1s that were matched, or null before any. */
  get matchRate(): number | null {
    return this.#v.stepsShown ? (100 * this.#v.stepsMatched) / this.#v.stepsShown : null;
  }

  hintUsed(): void {
    this.#v.hintsUsed++;
  }

  /**
   * Record a lock made while `step1` (absolute cells) was shown.
   * Returns whether the lock matched it.
   */
  lock(placed: readonly (readonly [number, number])[], step1: readonly (readonly [number, number])[]): boolean {
    const matched = sameCells(placed, step1);
    this.#v.stepsShown++;
    if (matched) this.#v.stepsMatched++;
    return matched;
  }

  reset(): void {
    this.#v = { hintsUsed: 0, stepsShown: 0, stepsMatched: 0 };
  }
}

export function sameCells(a: readonly (readonly [number, number])[], b: readonly (readonly [number, number])[]): boolean {
  return a.length > 0 && a.length === b.length && cellsKey(a) === cellsKey(b);
}
