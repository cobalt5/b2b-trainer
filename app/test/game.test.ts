import { describe, expect, it } from "vitest";

import { generateDrill } from "../src/drill/generate";
import { rowsFromGrid } from "../src/drill/scenario";
import { GameSession, type LockEvent } from "../src/game-core/game";
import { DEFAULT_SETTINGS, FRAME_MS, type HandlingSettings } from "../src/ui/settings";

const H = (o: Partial<HandlingSettings> = {}): HandlingSettings => ({ ...DEFAULT_SETTINGS.handling, ...o });

/** Session with a fake clock starting at t=0. */
function setup(h = H(), seed = 7) {
  const s = new GameSession(h, seed);
  const locks: LockEvent[] = [];
  s.onLock((e) => locks.push(e));
  let now = 0;
  s.advance(now); // start the clock
  const run = (frames: number) => {
    now += frames * FRAME_MS + 0.001;
    s.advance(now);
  };
  const key = (key: any, down: boolean, dt = 1) => s.keyEvent({ key, down, t: now + dt });
  const tap = (k: any) => {
    key(k, true, 1);
    key(k, false, 2);
    run(1);
  };
  return { s, locks, run, key, tap, get now() { return now; } };
}

const minX = (s: GameSession) => Math.min(...s.engine.falling.absoluteBlocks.map((b) => b[0]));
const maxX = (s: GameSession) => Math.max(...s.engine.falling.absoluteBlocks.map((b) => b[0]));

describe("GameSession clock", () => {
  it("runs one engine frame per 1/60 s", () => {
    const { s, run } = setup();
    const f0 = s.engine.frame;
    run(5);
    expect(s.engine.frame - f0).toBe(5);
  });

  it("caps catch-up after long gaps", () => {
    const { s } = setup();
    const f0 = s.engine.frame;
    s.advance(10_000);
    expect(s.engine.frame - f0).toBeLessThanOrEqual(10);
  });
});

describe("GameSession input", () => {
  it("hard drop locks and emits a classified lock event", () => {
    const { s, locks, tap } = setup();
    const piece = s.engine.falling.symbol;
    tap("hardDrop");
    expect(locks).toHaveLength(1);
    expect(locks[0]!.info.piece).toBe(piece.toUpperCase());
    expect(locks[0]!.info.lines).toBe(0);
    expect(s.engine.stats.pieces).toBe(1);
  });

  it("a tap moves exactly one column", () => {
    const { s, tap } = setup();
    const x0 = minX(s);
    tap("moveLeft");
    expect(minX(s)).toBe(x0 - 1);
  });

  it("DAS then ARR reaches the wall; nothing repeats before DAS", () => {
    const { s, key, run } = setup(H({ das: 10, arr: 2 }));
    const x0 = minX(s);
    key("moveLeft", true);
    run(8); // still inside DAS: only the initial step
    expect(minX(s)).toBe(x0 - 1);
    run(30);
    expect(minX(s)).toBe(0);
  });

  it("ARR 0 teleports to the wall as soon as DAS ends", () => {
    const { s, key, run } = setup(H({ das: 6, arr: 0 }));
    key("moveRight", true);
    run(7);
    expect(maxX(s)).toBe(9);
  });

  it("handling changes apply live", () => {
    const { s, key, run } = setup(H({ das: 20, arr: 0 }));
    s.setHandling(H({ das: 3, arr: 0 }));
    key("moveRight", true);
    run(5);
    expect(maxX(s)).toBe(9);
  });

  it("instant soft drop (SDF 41) reaches the floor in one frame", () => {
    const { s, key, run } = setup(H({ sdf: 41 }));
    key("softDrop", true);
    run(2);
    expect(Math.min(...s.engine.falling.absoluteBlocks.map((b) => b[1]))).toBe(0);
  });

  it("hold swaps the piece and locks hold until the next piece", () => {
    const { s, tap } = setup();
    const first = s.engine.falling.symbol;
    tap("hold");
    expect(s.engine.held).toBe(first);
    expect(s.engine.holdLocked).toBe(true);
  });

  it("paused sessions ignore presses and don't advance", () => {
    const { s, key, run } = setup();
    s.setPaused(true);
    const f0 = s.engine.frame;
    key("hardDrop", true);
    run(5);
    expect(s.engine.frame).toBe(f0);
    s.setPaused(false);
    s.advance(1e9); // clock restarts on resume
    expect(s.engine.stats.pieces).toBe(0);
  });
});

describe("GameSession practice", () => {
  it("undo and redo restore board, piece and hold", () => {
    // Compare boards, not stats.pieces: Triangle's undo snapshot is taken
    // before it increments pieces/lines (docs/notes.md §1).
    const { s, tap } = setup();
    const board = () => JSON.stringify(s.engine.board.state);
    tap("hardDrop");
    const afterOne = { board: board(), piece: s.engine.falling.symbol };
    tap("hardDrop");
    const afterTwo = { board: board(), piece: s.engine.falling.symbol };
    expect(s.undo()).toBe(true);
    expect({ board: board(), piece: s.engine.falling.symbol }).toEqual(afterOne);
    expect(s.redo()).toBe(true);
    expect({ board: board(), piece: s.engine.falling.symbol }).toEqual(afterTwo);
  });

  it("restart with the same seed reproduces the queue", () => {
    const { s } = setup(H(), 99);
    const q = [s.engine.falling.symbol, ...s.engine.queue.slice(0, 6)];
    s.restart(99);
    expect([s.engine.falling.symbol, ...s.engine.queue.slice(0, 6)]).toEqual(q);
  });

  it("stacking in one column tops out and ends the game", () => {
    const { s, tap } = setup();
    for (let i = 0; i < 60 && !s.over; i++) tap("hardDrop");
    expect(s.over).toBe(true);
    const f = s.engine.frame;
    tap("moveLeft");
    expect(s.engine.frame).toBe(f);
  });
});

describe("GameSession spin drills (M8)", () => {
  const scenario = () => {
    const s = generateDrill({ piece: "T", depth: 3, seed: 5 });
    if (!s) throw new Error("no drill");
    return s;
  };

  it("loadScenario sets up the drill's board, piece and previews", () => {
    const { s } = setup(H(), 7);
    const resets: string[] = [];
    s.onReset((k) => resets.push(k));
    const d = scenario();
    s.loadScenario(d, { gravity: false });
    expect(resets).toEqual(["scenario"]);
    expect(s.inScenario).toBe(true);
    expect(s.engine.falling.symbol).toBe(d.current);
    expect(s.engine.held).toBe(d.hold);
    expect(s.engine.queue.slice(0, d.queue.length)).toEqual(d.queue);
    expect(rowsFromGrid(s.engine.board.state.map((r) => r.map(Boolean)))).toEqual(d.rows);
    expect(s.nextGarbageIn).toBeNull();
    s.restart(7);
    expect(s.inScenario).toBe(false);
  });

  it("without gravity a piece never falls or locks by itself", () => {
    const t = setup(H(), 7);
    t.s.loadScenario(scenario(), { gravity: false });
    const y0 = t.s.engine.falling.location[1];
    for (let i = 0; i < 60 * 5; i++) t.run(1);
    expect(t.locks).toHaveLength(0);
    expect(t.s.engine.falling.location[1]).toBe(y0);
    // Holding soft drop on the floor doesn't lock either.
    t.key("softDrop", true);
    for (let i = 0; i < 60 * 5; i++) t.run(1);
    t.key("softDrop", false);
    t.run(1);
    expect(t.locks).toHaveLength(0);
    expect(t.s.engine.falling.location[1]).toBeLessThan(y0);
    t.tap("hardDrop");
    expect(t.locks).toHaveLength(1);
  });

  it("with gravity the drill piece falls", () => {
    const t = setup(H(), 7);
    t.s.loadScenario(scenario(), { gravity: true });
    const y0 = t.s.engine.falling.location[1];
    for (let i = 0; i < 60 * 3; i++) t.run(1);
    expect(t.s.engine.falling.location[1]).toBeLessThan(y0);
  });
});
