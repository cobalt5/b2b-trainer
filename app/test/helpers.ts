import { Engine, Mino } from "@haelp/teto/engine";

import { buildEngineParams } from "../src/game-core/rules";
import { DEFAULT_SETTINGS, toEngineHandling } from "../src/ui/settings";

/** Engine with a hand-made board (rows given top-down; 'X' = filled) and a chosen current piece. */
export function engineWith(rowsTopDown: readonly string[], piece: string, opts: { hold?: string; seed?: number } = {}): Engine {
  const e = new Engine(buildEngineParams(opts.seed ?? 1, toEngineHandling(DEFAULT_SETTINGS.handling)));
  const rows = [...rowsTopDown].reverse();
  for (let y = 0; y < e.board.state.length; y++) {
    e.board.state[y] = Array.from({ length: 10 }, (_, x) => (rows[y]?.[x] === "X" ? { mino: Mino.GARBAGE, connections: 0 } : null));
  }
  if (opts.hold) e.held = opts.hold as Mino;
  e.initiatePiece(piece as Mino);
  return e;
}
