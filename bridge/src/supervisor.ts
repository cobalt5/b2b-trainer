/**
 * Keeps one Frostetra process alive and runs requests against it one at a time.
 * On exit it rejects the in-flight request and restarts with backoff,
 * re-sending `rules`.
 */
import { EventEmitter } from "node:events";

import type { BotState, RunErr, RunOk, RunRequest, StatusPush } from "../../app/src/adapter/bridge-types.ts";
import type { RulesMsg, SuggestionMsg } from "../../app/src/adapter/sbp-types.ts";
import { BotProcess, type BotOptions } from "./bot.ts";

const BACKOFF_MS = [250, 500, 1000, 2000, 5000];
const DEFAULT_TIMEOUT = 5000;

export class Supervisor extends EventEmitter<{ status: [StatusPush]; log: [string] }> {
  state: BotState = "starting";
  epoch = 0;
  #bot: BotProcess | null = null;
  #queue: { req: RunRequest; resolve: (r: RunOk | RunErr) => void }[] = [];
  #busy = false;
  #failures = 0;
  #stopping = false;
  #readyWaiters: (() => void)[] = [];
  #restartTimer: NodeJS.Timeout | null = null;

  constructor(private rules: RulesMsg, private botOpts: BotOptions = {}) {
    super();
  }

  get status(): StatusPush {
    const reg = this.#bot?.register;
    return { op: "status", state: this.state, epoch: this.epoch, bot: reg ? { name: reg.name, version: reg.version } : undefined };
  }

  /** PID of the current bot process (tests use it to simulate crashes). */
  get pid(): number | undefined {
    return this.#bot?.pid;
  }

  async start(): Promise<void> {
    this.#stopping = false;
    await this.#spawn();
  }

  async #spawn(): Promise<void> {
    this.epoch++;
    this.#setState(this.epoch === 1 ? "starting" : "restarting");
    const bot = new BotProcess(this.botOpts);
    this.#bot = bot;
    bot.on("stderr", (l) => this.emit("log", `[bot] ${l}`));
    bot.on("message", (m) => {
      if (m.type === "info" && m.topic === "warning") this.emit("log", `[bot warning] ${JSON.stringify(m.data)}`);
    });
    bot.on("exit", (code) => {
      if (this.#bot !== bot) return;
      this.#bot = null;
      if (this.#stopping) return;
      this.emit("log", `bot exited (code ${code}); restarting`);
      this.#scheduleRestart();
    });
    try {
      await bot.start(this.rules);
      if (this.#bot !== bot) return;
      this.#failures = 0;
      this.#setState("ready");
      for (const w of this.#readyWaiters.splice(0)) w();
      void this.#pump();
    } catch (e) {
      this.emit("log", `bot start failed: ${(e as Error).message}`);
      if (this.#bot === bot) {
        this.#bot = null;
        await bot.stop().catch(() => {});
        if (!this.#stopping) this.#scheduleRestart(String((e as Error).message));
      }
    }
  }

  #scheduleRestart(detail?: string): void {
    const delay = BACKOFF_MS[Math.min(this.#failures, BACKOFF_MS.length - 1)]!;
    this.#failures++;
    if (this.#failures > 8) {
      this.#setState("failed", detail ?? "bot keeps crashing");
      return;
    }
    this.#setState("restarting", detail);
    this.#restartTimer = setTimeout(() => void this.#spawn(), delay);
  }

  #setState(state: BotState, detail?: string): void {
    this.state = state;
    this.emit("status", { ...this.status, detail });
  }

  /** Queue a request; resolves (never rejects) with ok or error. */
  run(req: RunRequest): Promise<RunOk | RunErr> {
    return new Promise((resolve) => {
      this.#queue.push({ req, resolve });
      void this.#pump();
    });
  }

  async #pump(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try {
      while (this.#queue.length) {
        const job = this.#queue.shift()!;
        job.resolve(await this.#exec(job.req));
      }
    } finally {
      this.#busy = false;
    }
  }

  #waitReady(timeoutMs: number): Promise<boolean> {
    if (this.state === "ready" && this.#bot) return Promise.resolve(true);
    if (this.state === "failed") return Promise.resolve(false);
    return new Promise((res) => {
      const t = setTimeout(() => res(false), timeoutMs);
      this.#readyWaiters.push(() => {
        clearTimeout(t);
        res(true);
      });
    });
  }

  async #exec(req: RunRequest): Promise<RunOk | RunErr> {
    const timeout = req.timeoutMs ?? DEFAULT_TIMEOUT;
    if (!(await this.#waitReady(timeout))) return { id: req.id, ok: false, error: `bot not ready (${this.state})`, epoch: this.epoch };
    const bot = this.#bot!;
    const epoch = this.epoch;
    try {
      const t0 = performance.now();
      const pending = req.expect ? bot.waitFor("suggestion", timeout) : null;
      pending?.catch(() => {}); // avoid an unhandled rejection if send() throws first
      for (const m of req.msgs) bot.send(m);
      const suggestion = pending ? ((await pending) as SuggestionMsg) : undefined;
      return { id: req.id, ok: true, suggestion, ms: Math.round((performance.now() - t0) * 10) / 10, epoch };
    } catch (e) {
      return { id: req.id, ok: false, error: (e as Error).message, epoch };
    }
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    await this.#bot?.stop();
    this.#bot = null;
  }
}
