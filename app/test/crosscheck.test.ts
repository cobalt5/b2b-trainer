/**
 * Frostetra ⇄ Triangle cross-check (Design_Doc §10, M4).
 * Runs the real bot binary over the golden positions and a seeded self-play
 * game. Every suggestion must pass verify: reachable in Triangle, with the
 * same spin classification. Skipped if the bot hasn't been built.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

import { Engine } from "@haelp/teto/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { toSbpBackToBack, toSbpBoard, toSbpCombo, toPieceId } from "../src/adapter/sbp";
import { TRAINER_RULES, type BotMsg, type ClientMsg, type SuggestionMsg } from "../src/adapter/sbp-types";
import { buildEngineParams } from "../src/game-core/rules";
import { DEFAULT_SETTINGS, toEngineHandling } from "../src/ui/settings";
import { verifyPlacement, type RejectedStep } from "../src/verify/verify";
import type { ForwardableMsg, RunOk } from "../src/adapter/bridge-types";
import { mirrorFromSnapshot } from "../src/game-core/mirror";
import type { BotRunner } from "../src/planner/bot-client";
import { requestPlans } from "../src/planner/plan";
import golden from "./golden/spins.json";
import { engineWith } from "./helpers";

const ROOT = resolve(__dirname, "../..");
const BIN = resolve(ROOT, "frostetra/target/release/frostetra");
const CONFIG = process.env.BOT_CONFIG_OVERRIDE ?? resolve(ROOT, "bot-config/b2b.json");

class Bot {
  proc!: ChildProcessWithoutNullStreams;
  waiters: ((m: BotMsg) => boolean)[] = [];
  start(): Promise<void> {
    this.proc = spawn(BIN, ["--config", CONFIG]);
    createInterface({ input: this.proc.stdout }).on("line", (l) => {
      const m = JSON.parse(l) as BotMsg;
      this.waiters = this.waiters.filter((w) => !w(m));
    });
    const reg = this.next("register");
    return reg.then(() => {
      const ready = this.next("ready");
      this.send(TRAINER_RULES);
      return ready.then(() => {});
    });
  }
  next(type: BotMsg["type"]): Promise<BotMsg> {
    return new Promise((res) => this.waiters.push((m) => (m.type === type ? (res(m), true) : false)));
  }
  send(m: ClientMsg) {
    this.proc.stdin.write(JSON.stringify(m) + "\n");
  }
  async suggest(e: Engine): Promise<SuggestionMsg> {
    const p = this.next("suggestion");
    this.send({ type: "stop" });
    this.send({
      type: "start",
      board: toSbpBoard(e.board.state),
      active: toPieceId(e.falling.symbol),
      queue: e.queue.slice(0, 5).map(toPieceId),
      hold: e.held ? toPieceId(e.held) : null,
      combo: toSbpCombo(e.stats.combo),
      back_to_back: toSbpBackToBack(e.stats.b2b)
    });
    this.send({ type: "suggest" });
    return (await p) as SuggestionMsg;
  }
  stop() {
    this.send({ type: "quit" });
  }
  /** The planner's BotRunner interface over this process (requests are sequential). */
  runner(): BotRunner {
    let chain: Promise<unknown> = Promise.resolve();
    return {
      run: (msgs: ForwardableMsg[], expect) => {
        const job = chain.then(async (): Promise<RunOk> => {
          const t0 = performance.now();
          const p = expect ? this.next("suggestion") : null;
          for (const m of msgs) this.send(m);
          const suggestion = p ? ((await p) as SuggestionMsg) : undefined;
          return { id: 0, ok: true, ms: performance.now() - t0, epoch: 1, suggestion };
        });
        chain = job.catch(() => {});
        return job;
      }
    };
  }
}

const describeIfBot = existsSync(BIN) ? describe : describe.skip;
/** Matches the app's default search budget (settings.hint.searchIterations). */
const ITERS = Number(process.env.PLAN_ITERS ?? DEFAULT_SETTINGS.hint.searchIterations);

describeIfBot("Frostetra suggestions pass Triangle verification", () => {
  const bot = new Bot();
  beforeAll(() => bot.start(), 10_000);
  afterAll(() => bot.stop());

  it("on every golden position", async () => {
    const rejects: string[] = [];
    for (const g of golden as { name: string; piece: string; rows: string[] }[]) {
      const e = engineWith(g.rows, g.piece);
      const move = (await bot.suggest(e)).moves[0];
      expect(move, g.name).toBeDefined();
      const v = verifyPlacement(e, move!);
      if (!v.ok) rejects.push(`${g.name}: ${v.reason} (${v.detail})`);
    }
    expect(rejects).toEqual([]);
  }, 30_000);

  it("on 150 pieces of seeded self-play (spin mismatch rate 0)", async () => {
    let e = new Engine(buildEngineParams(2024, toEngineHandling(DEFAULT_SETTINGS.handling)));
    const rejects: RejectedStep[] = [];
    let spins = 0;
    for (let i = 0; i < 150; i++) {
      const move = (await bot.suggest(e)).moves[0];
      if (!move) break;
      const v = verifyPlacement(e, move);
      if (!v.ok) {
        rejects.push(v);
        break;
      }
      if (v.info.spin !== "none" && v.info.lines > 0) spins++;
      e = v.after;
      if (v.info.topout) e = new Engine(buildEngineParams(2025 + i, toEngineHandling(DEFAULT_SETTINGS.handling)));
    }
    expect(rejects.map((r) => `${r.reason}: ${r.detail} @ ${JSON.stringify(r.placement)}`)).toEqual([]);
    console.log(`self-play: 150 pieces verified, ${spins} spin clears`);
  }, 60_000);

  it("planner finds the B2B finish on spin-ready golden boards", async () => {
    const runner = bot.runner();
    const missing: string[] = [];
    for (const g of (golden as { name: string; piece: string; rows: string[]; expect: { b2b: string | null } }[]).filter((x) => x.expect.b2b && x.piece === "t")) {
      const e = engineWith(g.rows, g.piece);
      const r = await requestPlans(runner, mirrorFromSnapshot(e.snapshot(), e.initializer), { previews: 5, topN: 3 });
      expect(r.rejected, g.name).toBe(0);
      if (!r.plans.length) missing.push(g.name);
    }
    expect(missing).toEqual([]);
  }, 60_000);

  it("plans for 40 positions of a seeded game: all verified, p95 latency reported", async () => {
    const runner = bot.runner();
    let e = new Engine(buildEngineParams(77, toEngineHandling(DEFAULT_SETTINGS.handling)));
    const latencies: number[] = [];
    let withPlan = 0;
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      const r = await requestPlans(runner, mirrorFromSnapshot(e.snapshot(), e.initializer), { previews: 5, topN: 3, iterations: ITERS });
      latencies.push(performance.now() - t0);
      if (process.env.PLAN_DEBUG && performance.now() - t0 > 300) console.log(`slow #${i}: bot ${r.botMs.toFixed(0)} ms, verify ${r.verifyMs.toFixed(0)} ms, plans ${r.plans.length}, lens ${r.plans.map((p) => p.steps.length)}`);
      expect(r.rejected).toBe(0);
      if (r.plans.length) withPlan++;
      // advance the game with the bot's best move
      const mv = (await bot.suggest(e)).moves[0]!;
      const v = verifyPlacement(e, mv);
      expect(v.ok).toBe(true);
      if (v.ok) e = v.after;
    }
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)]!;
    console.log(`planner: ${withPlan}/40 positions had a B2B plan; median ${latencies[20]!.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms`);
  }, 120_000);

  it("beam planner (strategy B) finds a verified B2B finish on every golden position that has one", async () => {
    const runner = bot.runner();
    const missing: string[] = [];
    for (const g of (golden as { name: string; piece: string; rows: string[]; expect: { b2b: string | null } }[]).filter((x) => x.expect.b2b)) {
      const e = engineWith(g.rows, g.piece);
      const r = await requestPlans(runner, mirrorFromSnapshot(e.snapshot(), e.initializer), { previews: 5, topN: 3, strategy: "beam" });
      expect(r.rejected, g.name).toBe(0);
      if (!r.plans.length) missing.push(g.name);
      for (const plan of r.plans) {
        expect(plan.final.b2bClass, g.name).not.toBeNull();
        expect(plan.steps.slice(0, -1).every((st) => st.info.lines === 0), g.name).toBe(true);
      }
    }
    expect(missing).toEqual([]);
  }, 60_000);

  it("beam planner: 40 positions of a seeded game, all verified, latency vs pv-walk", async () => {
    const runner = bot.runner();
    let e = new Engine(buildEngineParams(77, toEngineHandling(DEFAULT_SETTINGS.handling)));
    const lat: Record<"beam" | "pv", number[]> = { beam: [], pv: [] };
    const found = { beam: 0, pv: 0 };
    let multi = 0;
    for (let i = 0; i < 40; i++) {
      const m = mirrorFromSnapshot(e.snapshot(), e.initializer);
      let t0 = performance.now();
      const b = await requestPlans(runner, m, { previews: 5, topN: 3, strategy: "beam", beamWidth: DEFAULT_SETTINGS.hint.beamWidth });
      lat.beam.push(performance.now() - t0);
      expect(b.rejected, `position ${i}`).toBe(0);
      if (b.plans.length) found.beam++;
      if (b.plans.length > 1) multi++;
      t0 = performance.now();
      const a = await requestPlans(runner, m, { previews: 5, topN: 3, iterations: ITERS });
      lat.pv.push(performance.now() - t0);
      if (a.plans.length) found.pv++;
      const mv = (await bot.suggest(e)).moves[0]!;
      const v = verifyPlacement(e, mv);
      expect(v.ok).toBe(true);
      if (v.ok) e = v.after;
    }
    const q = (xs: number[], f: number) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length * f)]!.toFixed(0);
    console.log(
      `beam: ${found.beam}/40 with a plan (${multi} with ≥2 to cycle), median ${q(lat.beam, 0.5)} ms, p95 ${q(lat.beam, 0.95)} ms\n` +
        `pv-walk: ${found.pv}/40 with a plan, median ${q(lat.pv, 0.5)} ms, p95 ${q(lat.pv, 0.95)} ms`
    );
    expect(found.beam).toBeGreaterThanOrEqual(found.pv);
  }, 180_000);

  it.runIf(!!process.env.PLAN_DEBUG)("debug: per-request timings", async () => {
    let e = new Engine(buildEngineParams(77, toEngineHandling(DEFAULT_SETTINGS.handling)));
    for (let i = 0; i < 4; i++) {
      const v = verifyPlacement(e, (await bot.suggest(e)).moves[0]!);
      if (v.ok) e = v.after;
    }
    const m = mirrorFromSnapshot(e.snapshot(), e.initializer);
    const { toStart } = await import("../src/adapter/sbp");
    const start = toStart(m, 5);
    const time = async (label: string, msgs: ClientMsg[]) => {
      const t0 = performance.now();
      const p = bot.next("suggestion");
      for (const x of msgs) bot.send(x);
      const sg = (await p) as SuggestionMsg;
      console.log(label, (performance.now() - t0).toFixed(0), "ms", "moves", sg.moves.length, "pv", (sg.extensions?.["b2btrainer.pv"] as unknown[] | undefined)?.length);
      return sg;
    };
    await time("plain", [{ type: "stop" }, start, { type: "suggest" }]);
    await time("topN3", [{ type: "stop" }, start, { type: "suggest", extensions: { "b2btrainer.top_n": 3 } }]);
    const r = await time("topN3+pv6", [{ type: "stop" }, start, { type: "suggest", extensions: { "b2btrainer.top_n": 3, "b2btrainer.pv": 6 } }]);
    await time("advance+suggest", [{ type: "stop" }, start, { type: "advance", move: r.moves[1]! }, { type: "suggest" }]);
    await time("advance+pv5", [{ type: "stop" }, start, { type: "advance", move: r.moves[1]! }, { type: "suggest", extensions: { "b2btrainer.pv": 5 } }]);
  }, 60_000);
});
