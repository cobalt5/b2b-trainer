import { Engine } from "@haelp/teto/engine";
import { describe, expect, it } from "vitest";

import { BOARD_BUFFER, BOARD_HEIGHT, buildEngineParams } from "../src/game-core/rules";
import { DEFAULT_SETTINGS, toEngineHandling } from "../src/ui/settings";

const make = (seed = 1) => new Engine(buildEngineParams(seed, toEngineHandling(DEFAULT_SETTINGS.handling)));

describe("engine config", () => {
  it("constructs with our rules", () => {
    const e = make();
    expect(e.kickTableName).toBe("SRS+");
    expect(e.board.width).toBe(10);
    expect(e.board.fullHeight).toBe(BOARD_HEIGHT + BOARD_BUFFER);
    expect(e.queue.length).toBeGreaterThanOrEqual(5);
    expect(e.stats.b2b).toBe(-1);
  });

  it("is deterministic for a seed", () => {
    expect([...make(42).queue].slice(0, 7)).toEqual([...make(42).queue].slice(0, 7));
  });

  it("spawns pieces at the position the SBP mapping assumes", () => {
    const e = make();
    // docs/notes.md §4: 3-wide pieces spawn at x=3, y=22 (SBP anchor (4,21)).
    const w = e.falling.symbol === "i" ? 4 : e.falling.symbol === "o" ? 2 : 3;
    expect(e.falling.x).toBe(Math.floor(10 / 2 - w / 2));
    expect(e.falling.y).toBe(22);
  });

  it("hard drop locks and returns a LockRes", () => {
    const e = make();
    const res = e.press("hardDrop") as any;
    expect(res).toMatchObject({ lines: 0, spin: "none" });
    expect(e.stats.pieces).toBe(1);
  });

  it("snapshot / fromSnapshot clones state", () => {
    const e = make();
    e.press("moveLeft");
    e.press("hardDrop");
    const c = new Engine(e.initializer);
    c.fromSnapshot(e.snapshot());
    expect(c.board.state).toEqual(e.board.state);
    expect(c.falling.symbol).toBe(e.falling.symbol);
  });
});
