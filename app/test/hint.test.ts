import { describe, expect, it, vi } from "vitest";

import { formatInputs } from "../src/planner/hint";
import { walkLine } from "../src/planner/plan";
import { MismatchLog } from "../src/verify/mismatch-log";
import { engineWith } from "./helpers";

describe("formatInputs", () => {
  it("renders compact glyphs", () => {
    expect(formatInputs(["hold", "dasLeft", "moveRight", "rotateCW", "softDrop", "rotate180"])).toBe("Hold ⇤ → ↻ ↓ 180");
    expect(formatInputs([])).toBe("drop");
  });
});

describe("mismatch logging", () => {
  it("logs an unreachable bot move with its position", () => {
    const log = new MismatchLog();
    log.add = vi.fn();
    const out = walkLine(engineWith([], "t"), [{ location: { piece: "T", orientation: "north", x: 4, y: 10 }, spin: "none" }], { log, start: { type: "start" } });
    expect(out.kind).toBe("rejected");
    expect(log.add).toHaveBeenCalledWith(expect.objectContaining({ reason: "unreachable", start: { type: "start" } }));
  });

  it("keeps entries bounded", () => {
    const log = new MismatchLog(3);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 5; i++) log.add({ reason: "unreachable", detail: String(i), placement: {} as never });
    expect(log.entries.map((e) => e.detail)).toEqual(["2", "3", "4"]);
    warn.mockRestore();
  });
});
