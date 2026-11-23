/**
 * Mirror model: a read-only copy of the play state as of the last lock
 * (or restart / undo / redo). The hint planner starts from this state,
 * so it's taken from an engine snapshot, never from live input state.
 */

import type { EngineInitializeParams, EngineSnapshot, Mino, Tile } from "@haelp/teto/engine";

export interface MirrorState {
  board: Tile[][];
  /** Piece that spawned right after the lock (plan step 1 uses it, or hold). */
  current: { mino: Mino; x: number; y: number; rotation: 0 | 1 | 2 | 3 };
  hold: Mino | null;
  queue: Mino[];
  b2b: number;
  combo: number;
  /** Garbage lines waiting to rise (garbage practice). The plan ignores them. */
  incomingGarbage: number;
  /** Increments on every new mirror state, for staleness checks. */
  version: number;
  /**
   * Full engine state, so verify/ can rebuild this exact position in Triangle.
   * Its garbage queue is emptied: the bot isn't told about incoming garbage,
   * so plans are made (and verified) as if none arrives. Otherwise verify
   * would tank it on step 1 and every later step would be shifted.
   */
  snapshot: EngineSnapshot;
  initializer: EngineInitializeParams;
}

let versionCounter = 0;

export function mirrorFromSnapshot(s: EngineSnapshot, initializer: EngineInitializeParams): MirrorState {
  const incomingGarbage = s.garbage.queue.reduce((n, g) => n + g.amount, 0);
  return {
    board: s.board.map((row) => row.slice()),
    current: {
      mino: s.falling.symbol,
      x: s.falling.location[0],
      y: Math.floor(s.falling.location[1]),
      rotation: s.falling.rotation
    },
    hold: s.hold,
    queue: s.queue.value.slice(),
    b2b: s.stats.b2b,
    combo: s.stats.combo,
    incomingGarbage,
    version: ++versionCounter,
    snapshot: incomingGarbage ? { ...s, garbage: { ...s.garbage, queue: [] } } : s,
    initializer
  };
}
