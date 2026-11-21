/**
 * One verified step of a hint plan, plus input formatting.
 * The planner that produces these is planner/plan.ts.
 */

import type { Placement } from "../adapter/sbp-types";
import type { LockInfo } from "../game-core/clear";
import type { InputKey } from "../verify/verify";

export interface HintStep {
  placement: Placement;
  /** Absolute board cells, y up. */
  cells: [number, number][];
  /** Lowercase mino letter for colors. */
  mino: string;
  /** The step places the held piece (or the next piece after holding). */
  usesHold: boolean;
  /** Triangle's classification of this lock (source of truth). */
  info: LockInfo;
  /** Shortest key sequence that reaches it in Triangle (hard drop implied). */
  inputs: InputKey[];
}

const KEY_GLYPH: Record<InputKey, string> = {
  hold: "Hold",
  dasLeft: "⇤",
  dasRight: "⇥",
  moveLeft: "←",
  moveRight: "→",
  rotateCW: "↻",
  rotateCCW: "↺",
  rotate180: "180",
  softDrop: "↓"
};

/** Compact input sequence, e.g. "Hold ⇤ → ↻ ↓ ↻". */
export function formatInputs(inputs: readonly InputKey[]): string {
  return inputs.length ? inputs.map((k) => KEY_GLYPH[k]).join(" ") : "drop";
}
