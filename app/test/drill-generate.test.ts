/**
 * Spin drill generator: every drill is a verified line of exactly `depth`
 * placements from the start position, where only the last one clears lines,
 * as a spin of the drill's piece.
 */
import type { LockRes } from "@haelp/teto/engine";
import { describe, expect, it } from "vitest";

import { sbpCells } from "../src/adapter/sbp";
import { classifyLock, lockLabels } from "../src/game-core/clear";
import { FORCED_QUEUE, extendBag, generateDrill, isBagWindow, isGrounded, layoutQueue, probeEngine, rngFrom } from "../src/drill/generate";
import { DRILL_PIECES, applyScenario, gridFromRows, type Scenario } from "../src/drill/scenario";
import { cloneEngine } from "../src/verify/verify";

/** Replay the solution's recorded inputs in a fresh engine (independent of the generator's own replay). */
function replayInputs(s: Scenario) {
  let e = probeEngine(s.seed);
  applyScenario(e, s);
  const infos = [];
  for (const step of s.solution) {
    const c = cloneEngine(e);
    for (const k of step.inputs) c.press(k);
    const res = c.press("hardDrop") as LockRes;
    infos.push({ info: classifyLock(res, c.board.state) });
    e = c;
  }
  return infos;
}

const SEEDS = [1, 2, 3];

describe("generateDrill", () => {
  for (const piece of DRILL_PIECES) {
    for (let depth = 1; depth <= 7; depth++) {
      it(`${piece}-spin, ${depth} piece${depth > 1 ? "s" : ""}`, () => {
        for (const seed of SEEDS) {
          const s = generateDrill({ piece, depth, seed });
          expect(s, `seed ${seed}`).not.toBeNull();
          const d = s!;
          expect(d.piece).toBe(piece);
          expect(d.depth).toBe(depth);
          expect(d.solution).toHaveLength(depth);
          expect(d.queue).toHaveLength(FORCED_QUEUE);
          // Everything the user sees is a legal 7-bag stream (hold counts as the piece dealt before current).
          const stream = [...(d.hold ? [d.hold] : []), d.current, ...d.queue];
          expect(isBagWindow(stream), stream.join("")).toBe(true);
          expect(isGrounded(gridFromRows(d.rows))).toBe(true);
          if (depth < 7) expect(d.hold).toBeNull();
          else expect(d.solution.some((st) => st.usesHold)).toBe(true);

          // Every step's recorded inputs really produce it in Triangle.
          const infos = replayInputs(d);
          infos.forEach(({ info }, i) => {
            const last = i === depth - 1;
            if (!last) expect(info.lines, `step ${i + 1} clears lines`).toBe(0);
            else {
              expect(info.piece).toBe(piece);
              expect(info.spin).not.toBe("none");
              expect(info.lines).toBeGreaterThan(0);
            }
          });
          // Outline cells match the placements.
          d.solution.forEach((st) => expect(st.cells).toEqual(sbpCells(st.placement.location)));
          expect(d.intended).toEqual(d.solution.at(-1)!.info);
          // The caption names the spin the drill really ends in.
          expect(d.name).toBe(lockLabels(d.intended).main);
          expect(d.name.startsWith(`${piece}-Spin`)).toBe(true);
        }
      }, 60_000);
    }
  }

  it("is deterministic for a seed", () => {
    const a = generateDrill({ piece: "T", depth: 4, seed: 42 });
    const b = generateDrill({ piece: "T", depth: 4, seed: 42 });
    expect(a?.rows).toEqual(b?.rows);
    expect([a?.current, a?.hold, a?.queue]).toEqual([b?.current, b?.hold, b?.queue]);
    expect(a?.solution.map((s) => s.cells)).toEqual(b?.solution.map((s) => s.cells));
  });

  it("mixed picks one of the six pieces", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) seen.add(generateDrill({ piece: "mixed", depth: 1, seed })!.piece);
    expect([...seen].every((p) => (DRILL_PIECES as readonly string[]).includes(p))).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("layoutQueue", () => {
  it("puts needed pieces in order with hold empty below depth 7", () => {
    const l = layoutQueue(["O", "S", "T"], rngFrom(1));
    expect(l.current).toBe("o");
    expect(l.hold).toBeNull();
    expect(l.queue.slice(0, 2)).toEqual(["s", "t"]);
    expect(l.queue).toHaveLength(FORCED_QUEUE);
  });
  it("fills the queue so it stays 7-bag legal", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const l = layoutQueue(["J", "J"], rngFrom(seed));
      const stream = [l.current, ...l.queue];
      expect(isBagWindow(stream), stream.join("")).toBe(true);
      expect(stream[2]).not.toBe("j"); // never three in a row
    }
  });
  it("at depth 7 starts one needed piece in hold and shows the other six", () => {
    const needed = ["I", "O", "S", "Z", "L", "J", "T"];
    const l = layoutQueue(needed, rngFrom(3));
    const all = [l.hold, l.current, ...l.queue.slice(0, 5)].map((m) => m!.toUpperCase()).sort();
    expect(all).toEqual([...needed].sort());
    expect(isBagWindow([l.hold!, l.current, ...l.queue])).toBe(true);
  });
});

describe("7-bag windows", () => {
  it("allow two of a piece across a bag boundary but never three in a row", () => {
    expect(isBagWindow(["J", "J"])).toBe(true);
    expect(isBagWindow(["J", "J", "J"])).toBe(false);
    expect(isBagWindow(["J", "T", "J"])).toBe(true);
    expect(isBagWindow(["I", "J", "L", "O", "S", "T", "Z"])).toBe(true);
    // Two Js with all six others between them fit (end of one bag, start of the next)...
    expect(isBagWindow(["J", "I", "L", "O", "S", "T", "J"])).toBe(true);
    // ...but three of a piece within eight never do.
    expect(isBagWindow(["J", "I", "J", "O", "S", "T", "J"])).toBe(false);
  });
  it("extendBag keeps the window legal", () => {
    for (let seed = 1; seed <= 30; seed++) expect(isBagWindow(extendBag(["S", "S"], 20, rngFrom(seed)))).toBe(true);
  });
});
