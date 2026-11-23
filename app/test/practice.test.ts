import { describe, expect, it } from "vitest";

import { GameSession, type GarbageSettings, type LockEvent } from "../src/game-core/game";
import { mirrorFromSnapshot } from "../src/game-core/mirror";
import { HintStats, sameCells } from "../src/planner/hint-stats";
import { DEFAULT_SETTINGS, FRAME_MS } from "../src/ui/settings";

function setup(garbage?: GarbageSettings, seed = 5) {
  const s = new GameSession(DEFAULT_SETTINGS.handling, seed, garbage);
  const locks: LockEvent[] = [];
  s.onLock((e) => locks.push(e));
  let now = 0;
  s.advance(now);
  const run = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      now += FRAME_MS;
      s.advance(now + 0.001);
    }
  };
  const tap = (key: any) => {
    s.keyEvent({ key, down: true, t: now + 1 });
    s.keyEvent({ key, down: false, t: now + 2 });
    run(1);
  };
  return { s, locks, run, tap };
}

/** Garbage rows, bottom-up, as the hole column of each. */
const garbageHoles = (s: GameSession): number[] =>
  s.engine.board.state
    .filter((row) => row.some((c) => c?.mino === "gb"))
    .map((row) => row.findIndex((c) => c === null));

describe("lock cells", () => {
  it("each lock event carries the cells the piece was placed on", () => {
    const { s, locks, tap } = setup();
    tap("moveLeft");
    tap("hardDrop");
    const { cells, info } = locks[0]!;
    expect(cells).toHaveLength(4);
    for (const [x, y] of cells) expect(s.engine.board.state[y]![x]?.mino).toBe(info.piece.toLowerCase());
  });
});

describe("garbage practice", () => {
  it("sends garbage after the interval; it rises at the next non-clearing lock", () => {
    const { s, run, tap } = setup({ mode: "clean", amount: 3, interval: 1 });
    expect(s.nextGarbageIn).toBeCloseTo(1, 1);
    run(55);
    expect(s.pendingGarbage).toBe(0);
    run(10);
    expect(s.pendingGarbage).toBe(3);
    run(25); // garbage travel time (20 frames)
    expect(garbageHoles(s)).toEqual([]);
    tap("hardDrop");
    expect(s.pendingGarbage).toBe(0);
    const holes = garbageHoles(s);
    expect(holes).toHaveLength(3);
    expect(new Set(holes).size).toBe(1); // clean: one column per event
  });

  it("cheese gives each line its own hole", () => {
    const { s, run, tap } = setup({ mode: "cheese", amount: 6, interval: 1 });
    run(90);
    tap("hardDrop");
    const holes = garbageHoles(s);
    expect(holes).toHaveLength(6);
    for (let i = 1; i < holes.length; i++) expect(holes[i]).not.toBe(holes[i - 1]);
  });

  it("paused time doesn't count toward the next garbage", () => {
    const { s, run } = setup({ mode: "clean", amount: 2, interval: 1 });
    s.setPaused(true);
    run(200);
    expect(s.pendingGarbage).toBe(0);
    s.setPaused(false);
    run(70);
    expect(s.pendingGarbage).toBe(2);
  });

  it("can be turned off and on live", () => {
    const { s, run } = setup();
    expect(s.nextGarbageIn).toBeNull();
    run(120);
    expect(s.pendingGarbage).toBe(0);
    s.setGarbage({ mode: "cheese", amount: 2, interval: 1 });
    run(70);
    expect(s.pendingGarbage).toBe(2);
    s.setGarbage({ mode: "off", amount: 2, interval: 1 });
    run(200);
    expect(s.pendingGarbage).toBe(2);
  });

  it("the mirror counts incoming garbage but plans without it", () => {
    const { s, run } = setup({ mode: "clean", amount: 4, interval: 1 });
    run(70);
    const snap = s.engine.snapshot();
    const m = mirrorFromSnapshot(snap, s.engine.initializer);
    expect(m.incomingGarbage).toBe(4);
    expect(m.snapshot.garbage.queue).toEqual([]);
    expect(snap.garbage.queue).toHaveLength(1); // the source snapshot is untouched
  });
});

describe("hint stats", () => {
  const T: [number, number][] = [[3, 0], [4, 0], [5, 0], [4, 1]];

  it("compares cell sets regardless of order", () => {
    expect(sameCells(T, [...T].reverse())).toBe(true);
    expect(sameCells(T, T.map(([x, y]) => [x + 1, y] as [number, number]))).toBe(false);
    expect(sameCells([], [])).toBe(false);
  });

  it("counts hints and step 1 matches", () => {
    const h = new HintStats();
    expect(h.matchRate).toBeNull();
    h.hintUsed();
    h.hintUsed();
    expect(h.lock(T, T)).toBe(true);
    expect(h.lock(T, T.map(([x, y]) => [x, y + 1] as [number, number]))).toBe(false);
    expect(h.value).toEqual({ hintsUsed: 2, stepsShown: 2, stepsMatched: 1 });
    expect(h.matchRate).toBe(50);
    h.reset();
    expect(h.value).toEqual({ hintsUsed: 0, stepsShown: 0, stepsMatched: 0 });
  });
});
