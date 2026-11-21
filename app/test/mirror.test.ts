import { describe, expect, it } from "vitest";

import { GameSession } from "../src/game-core/game";
import { mirrorFromSnapshot, type MirrorState } from "../src/game-core/mirror";
import { pieceCellsAt } from "../src/render/cells";
import { DEFAULT_SETTINGS, FRAME_MS } from "../src/ui/settings";

function setup(seed = 3) {
  const s = new GameSession(DEFAULT_SETTINGS.handling, seed);
  let mirror: MirrorState = mirrorFromSnapshot(s.engine.snapshot(), s.engine.initializer);
  s.onLock((e) => (mirror = mirrorFromSnapshot(e.snapshot, s.engine.initializer)));
  s.onReset(() => (mirror = mirrorFromSnapshot(s.engine.snapshot(), s.engine.initializer)));
  let now = 0;
  s.advance(0);
  const tap = (key: any) => {
    s.keyEvent({ key, down: true, t: now + 1 });
    s.keyEvent({ key, down: false, t: now + 2 });
    now += FRAME_MS + 0.001;
    s.advance(now);
  };
  return { s, tap, get mirror() { return mirror; } };
}

describe("mirror", () => {
  it("matches the engine right after a lock", () => {
    const t = setup();
    t.tap("moveLeft");
    t.tap("hardDrop");
    const e = t.s.engine;
    expect(t.mirror.board).toEqual(e.board.state);
    expect(t.mirror.current.mino).toBe(e.falling.symbol);
    expect(t.mirror.queue.slice(0, 5)).toEqual(e.queue.slice(0, 5));
    expect(t.mirror.hold).toBe(e.held);
  });

  it("does not follow live input between locks", () => {
    const t = setup();
    t.tap("hardDrop");
    const before = structuredClone(t.mirror);
    t.tap("hold"); // swaps the live piece, no lock
    t.tap("moveRight");
    expect(t.s.engine.held).not.toBeNull();
    expect(t.mirror).toEqual(before);
  });

  it("is a copy: later engine changes don't leak into it", () => {
    const t = setup();
    t.tap("hardDrop");
    const board = JSON.stringify(t.mirror.board);
    t.tap("hardDrop");
    const m1 = t.mirror;
    t.tap("hardDrop");
    expect(JSON.stringify(m1.board)).not.toBe(JSON.stringify(t.mirror.board));
    expect(board).not.toBe(JSON.stringify(m1.board));
  });

  it("updates on undo and restart", () => {
    const t = setup();
    t.tap("hardDrop");
    const afterOne = structuredClone(t.mirror.board);
    t.tap("hardDrop");
    t.s.undo();
    expect(t.mirror.board).toEqual(afterOne);
    t.s.restart(5);
    expect(t.mirror.board.flat().every((c) => c === null)).toBe(true);
  });

  it("current piece cells match the engine's falling piece at spawn", () => {
    const t = setup();
    t.tap("hardDrop");
    const c = t.mirror.current;
    const cells = pieceCellsAt(c.mino, c.x, c.y, c.rotation);
    expect(cells).toEqual(t.s.engine.falling.absoluteBlocks.map(([x, y]) => [x, y]));
  });
});
