import { describe, expect, it } from "vitest";

import { classifyLock, lockLabels } from "../src/game-core/clear";

const empty = [[null, null]];
const filled = [[{ mino: "t" }, null]];
const res = (mino: string, lines: number, spin: "none" | "mini" | "normal", b2b = -1, combo = 0) =>
  ({ mino, lines, spin, stats: { b2b, combo }, surge: 0, topout: false }) as any;

describe("classifyLock", () => {
  it("quad is a B2B source", () => {
    expect(classifyLock(res("i", 4, "none", 0), filled)).toMatchObject({ b2bClass: "quad", breaksB2B: false });
  });
  it("T-spin full / mini", () => {
    expect(classifyLock(res("t", 2, "normal"), filled).b2bClass).toBe("t-spin");
    expect(classifyLock(res("t", 1, "mini"), filled).b2bClass).toBe("t-spin-mini");
  });
  it("all-spin full / mini for non-T", () => {
    expect(classifyLock(res("s", 2, "normal"), filled).b2bClass).toBe("allspin");
    expect(classifyLock(res("j", 1, "mini"), filled).b2bClass).toBe("allspin-mini");
  });
  it("plain clears break B2B, non-clears don't", () => {
    expect(classifyLock(res("l", 2, "none"), filled)).toMatchObject({ b2bClass: null, breaksB2B: true });
    expect(classifyLock(res("l", 0, "none"), filled)).toMatchObject({ b2bClass: null, breaksB2B: false });
    expect(classifyLock(res("t", 0, "normal"), filled)).toMatchObject({ b2bClass: null, breaksB2B: false });
  });
  it("perfect clear from a plain clear is a B2B source", () => {
    expect(classifyLock(res("o", 2, "none"), empty)).toMatchObject({ perfectClear: true, b2bClass: "perfect-clear", breaksB2B: false });
  });
});

describe("lockLabels", () => {
  it("names spins and extras", () => {
    expect(lockLabels(classifyLock(res("t", 2, "normal", 3, 2), filled))).toEqual({ main: "T-Spin Double", extras: ["B2B ×3", "2 Combo"] });
    expect(lockLabels(classifyLock(res("s", 1, "mini"), filled)).main).toBe("S-Spin Single Mini");
    expect(lockLabels(classifyLock(res("i", 4, "none", 0), filled))).toEqual({ main: "Quad", extras: [] });
    expect(lockLabels(classifyLock(res("t", 0, "normal"), filled)).main).toBe("T-Spin");
    expect(lockLabels(classifyLock(res("l", 0, "none"), filled))).toEqual({ main: null, extras: [] });
  });
});
