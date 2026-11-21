import { Engine, Mino } from "@haelp/teto/engine";
import { describe, expect, it } from "vitest";

import { sbpCells, toSbpBackToBack, toSbpBoard, toSbpCombo, toStart } from "../src/adapter/sbp";
import { mirrorFromSnapshot } from "../src/game-core/mirror";
import { buildEngineParams } from "../src/game-core/rules";
import { DEFAULT_SETTINGS, toEngineHandling } from "../src/ui/settings";

const engine = (seed = 1) => new Engine(buildEngineParams(seed, toEngineHandling(DEFAULT_SETTINGS.handling)));
const sortCells = (c: readonly (readonly number[])[]) => c.map((p) => p.join(",")).sort();

describe("board conversion", () => {
  it("keeps row order bottom-up, uppercases pieces, maps garbage to G", () => {
    const board = Array.from({ length: 40 }, () => Array(10).fill(null));
    board[0]![0] = { mino: "t", connections: 0 };
    board[0]![1] = { mino: "gb", connections: 0 };
    board[3]![9] = { mino: "i", connections: 0 };
    const sbp = toSbpBoard(board);
    expect(sbp).toHaveLength(40);
    expect(sbp[0]!.slice(0, 2)).toEqual(["T", "G"]);
    expect(sbp[3]![9]).toBe("I");
    expect(sbp[39]!.every((c) => c === null)).toBe(true);
  });
});

describe("counters", () => {
  it("map Triangle's -1-based counters to SBP's non-negative counts", () => {
    expect(toSbpBackToBack(-1)).toBe(0);
    expect(toSbpBackToBack(0)).toBe(1);
    expect(toSbpBackToBack(4)).toBe(5);
    expect(toSbpCombo(-1)).toBe(0);
    expect(toSbpCombo(2)).toBe(3);
  });
});

describe("toStart", () => {
  it("sends the mirror's piece, hold and only the visible previews", () => {
    const e = engine(11);
    e.press("hold");
    e.press("hardDrop");
    const m = mirrorFromSnapshot(e.snapshot(), e.initializer);
    const st = toStart(m, 5);
    expect(st.active).toBe(e.falling.symbol.toUpperCase());
    expect(st.hold).toBe(e.held!.toUpperCase());
    expect(st.queue).toEqual(e.queue.slice(0, 5).map((p) => p.toUpperCase()));
    expect(st.board).toHaveLength(40);
    expect(st.back_to_back).toBe(0);
    expect(st.combo).toBe(0);
  });
});

describe("sbpCells", () => {
  it("T north at the SBP spawn (4,21) covers the same cells as Triangle's spawned T", () => {
    const e = engine();
    e.initiatePiece(Mino.T);
    expect(sortCells(sbpCells({ piece: "T", orientation: "north", x: 4, y: 21 }))).toEqual(sortCells(e.falling.absoluteBlocks));
  });
  it("rotates around the anchor", () => {
    expect(sortCells(sbpCells({ piece: "T", orientation: "south", x: 4, y: 1 }))).toEqual(sortCells([[3, 1], [4, 1], [5, 1], [4, 0]]));
    expect(sortCells(sbpCells({ piece: "I", orientation: "east", x: 0, y: 2 }))).toEqual(sortCells([[0, 3], [0, 2], [0, 1], [0, 0]]));
  });
});
