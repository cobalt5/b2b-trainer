/**
 * M1 check: real engine spin detection reaches our labels.
 * A tiny BFS over press() finds the inputs for a T-spin double (M4's
 * verify/ will grow this into the full reachability search).
 */
import { Engine, Mino, type LockRes } from "@haelp/teto/engine";
import { describe, expect, it } from "vitest";

import { classifyLock, lockLabels } from "../src/game-core/clear";
import { buildEngineParams } from "../src/game-core/rules";
import { DEFAULT_SETTINGS, toEngineHandling } from "../src/ui/settings";

type Key = "moveLeft" | "moveRight" | "rotateCW" | "rotateCCW" | "rotate180" | "softDrop";
const KEYS: Key[] = ["moveLeft", "moveRight", "rotateCW", "rotateCCW", "rotate180", "softDrop"];

/** rows given top-down for readability; 'X' = filled. */
function engineWith(rowsTopDown: string[], piece: Mino): Engine {
  const e = new Engine(buildEngineParams(1, toEngineHandling(DEFAULT_SETTINGS.handling)));
  const rows = [...rowsTopDown].reverse();
  for (let y = 0; y < e.board.state.length; y++) {
    e.board.state[y] = Array.from({ length: 10 }, (_, x) =>
      rows[y]?.[x] === "X" ? { mino: Mino.GARBAGE, connections: 0 } : null
    );
  }
  e.initiatePiece(piece);
  return e;
}

function clone(e: Engine): Engine {
  const c = new Engine(e.initializer);
  c.fromSnapshot(e.snapshot());
  return c;
}

/** BFS for the first input path whose hard drop satisfies `want`. */
function search(start: Engine, want: (r: LockRes) => boolean, maxDepth = 8): { path: Key[]; res: LockRes } | null {
  const key = (e: Engine) => `${e.falling.x},${e.falling.y},${e.falling.rotation},${e.lastSpin ?? "-"}`;
  const seen = new Set([key(start)]);
  let frontier: { e: Engine; path: Key[] }[] = [{ e: start, path: [] }];
  for (let d = 0; d <= maxDepth && frontier.length; d++) {
    const next: typeof frontier = [];
    for (const { e, path } of frontier) {
      const probe = clone(e);
      const res = probe.press("hardDrop") as LockRes;
      if (want(res)) return { path, res };
      for (const k of KEYS) {
        const c = clone(e);
        if (!c.press(k)) continue;
        const id = key(c);
        if (seen.has(id)) continue;
        seen.add(id);
        next.push({ e: c, path: [...path, k] });
      }
    }
    frontier = next;
  }
  return null;
}

describe("spin detection through the real engine", () => {
  it("finds and labels a T-spin double", () => {
    const e = engineWith(
      [
        "XXXX......",
        "XXX...XXXX",
        "XXXX.XXXXX"
      ],
      Mino.T
    );
    const found = search(e, (r) => r.lines === 2 && r.spin === "normal");
    expect(found, "no TSD path found").not.toBeNull();
    const info = classifyLock(found!.res, [[{}]]);
    expect(info.b2bClass).toBe("t-spin");
    expect(lockLabels(info).main).toBe("T-Spin Double");
  });

  it("plain line clear from a vertical I breaks B2B", () => {
    const e = engineWith(["XXXXXXXXX.", "XXXXXXXXX."], Mino.I);
    const found = search(e, (r) => r.lines === 2);
    expect(found).not.toBeNull();
    expect(classifyLock(found!.res, [[{}]])).toMatchObject({ spin: "none", breaksB2B: true });
  });
});
