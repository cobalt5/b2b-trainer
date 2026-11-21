/**
 * Reachability search over Triangle's own movement code.
 *
 * BFS over press() moves on one working engine. Only the falling piece and
 * `lastSpin` change between nodes, so we save/restore just those instead of
 * cloning the engine (docs/notes.md §1: spin is decided at rotation time and
 * cleared by any successful move or fall, including the hard drop's fall).
 *
 * Node key = (x, y, rotation, lastSpin). Each node's hard-drop result is a
 * "final": its cell set plus the spin it would lock with. BFS order gives the
 * shortest input path for every final.
 */

import { legal, type Engine, type SpinType, type TetrominoSnapshot } from "@haelp/teto/engine";

import { cellsKey } from "../adapter/coords";

export const SEARCH_KEYS = ["dasLeft", "dasRight", "moveLeft", "moveRight", "rotateCW", "rotateCCW", "rotate180", "softDrop"] as const;
export type SearchKey = (typeof SEARCH_KEYS)[number];

export interface Final {
  /** Shortest input path (excluding the final hardDrop). */
  path: SearchKey[];
  /** Absolute cells after the hard drop, y up. */
  cells: [number, number][];
  cellsKey: string;
  /** Spin the lock would be classified with, or null. */
  spin: SpinType | null;
}

interface Node {
  falling: TetrominoSnapshot;
  lastSpin: SpinType | null;
  path: SearchKey[];
}

function restore(e: Engine, n: Pick<Node, "falling" | "lastSpin">): void {
  const f = e.falling as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(n.falling)) f[k] = Array.isArray(v) ? [...v] : v;
  e.lastSpin = n.lastSpin;
}

const nodeKey = (s: TetrominoSnapshot, spin: SpinType | null) =>
  `${s.location[0]},${Math.round(s.location[1] * 1000)},${s.rotation},${spin ?? "-"}`;

/** Cells where the current falling piece would land, and whether it moves to get there. */
function dropOf(e: Engine): { cells: [number, number][]; moved: boolean } {
  const f = e.falling;
  let y = f.location[1];
  while (legal(f.absoluteAt({ y: y - 1 }), e.board.state)) y -= 1;
  // hardDrop's first #__internal_fall step checks the floored row below, the
  // same as this. Any successful step clears lastSpin.
  const moved = legal(f.absoluteAt({ y: f.location[1] - 1 }), e.board.state);
  return { cells: f.absoluteAt({ y }).map(([x, yy]) => [x, yy] as [number, number]), moved };
}

export interface SearchOptions {
  /** Safety cap on explored nodes. */
  maxNodes?: number;
}

/**
 * Enumerate every distinct (cells, spin) final reachable from the engine's
 * current falling piece. The engine's falling piece and lastSpin are restored
 * before returning.
 */
export function enumerateFinals(e: Engine, opts: SearchOptions = {}): Final[] {
  const maxNodes = opts.maxNodes ?? 20_000;
  const root: Node = { falling: e.falling.snapshot(), lastSpin: e.lastSpin, path: [] };
  const seen = new Set<string>([nodeKey(root.falling, root.lastSpin)]);
  const finals = new Map<string, Final>();
  let frontier: Node[] = [root];
  let explored = 0;

  try {
    while (frontier.length && explored < maxNodes) {
      const next: Node[] = [];
      for (const node of frontier) {
        explored++;
        restore(e, node);
        const { cells, moved } = dropOf(e);
        const spin = moved ? null : e.lastSpin;
        const ck = cellsKey(cells);
        const fk = `${ck}|${spin ?? "-"}`;
        if (!finals.has(fk)) finals.set(fk, { path: node.path, cells, cellsKey: ck, spin });

        for (const k of SEARCH_KEYS) {
          restore(e, node);
          if (!e.press(k)) continue;
          const snap = e.falling.snapshot();
          const id = nodeKey(snap, e.lastSpin);
          if (seen.has(id)) continue;
          seen.add(id);
          next.push({ falling: snap, lastSpin: e.lastSpin, path: [...node.path, k] });
        }
      }
      frontier = next;
    }
  } finally {
    restore(e, root);
  }
  return [...finals.values()];
}
