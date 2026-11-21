/**
 * Spawns Frostetra and speaks SBP/1 over JSON lines.
 *
 * Frostetra unwraps every stdin parse (docs/notes.md §3), so only ever write
 * values produced by JSON.stringify, one per line.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import type { BotMsg, ClientMsg, RegisterMsg, RulesMsg } from "../../app/src/adapter/sbp-types.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_BOT_PATH = resolve(ROOT, "frostetra/target/release/frostetra");
export const DEFAULT_CONFIG_PATH = resolve(ROOT, "bot-config/b2b.json");

export interface BotOptions {
  binPath?: string;
  configPath?: string | null;
  /** ms to wait for register/ready. */
  handshakeTimeout?: number;
}

export class BotProcess extends EventEmitter<{ message: [BotMsg]; exit: [number | null]; stderr: [string] }> {
  #proc: ChildProcessWithoutNullStreams | null = null;
  register: RegisterMsg | null = null;

  constructor(private readonly opts: BotOptions = {}) {
    super();
  }

  get running() {
    return this.#proc !== null;
  }

  get pid(): number | undefined {
    return this.#proc?.pid;
  }

  /** Spawn, wait for `register`, send `rules`, wait for `ready`. */
  async start(rules: RulesMsg): Promise<RegisterMsg> {
    const bin = this.opts.binPath ?? DEFAULT_BOT_PATH;
    if (!existsSync(bin)) throw new Error(`bot binary not found: ${bin} (run \`npm run build:bot\`)`);
    const configPath = this.opts.configPath === undefined ? DEFAULT_CONFIG_PATH : this.opts.configPath;
    const args = configPath ? ["--config", configPath] : [];

    const proc = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.#proc = proc;
    createInterface({ input: proc.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      try {
        this.emit("message", JSON.parse(line) as BotMsg);
      } catch {
        this.emit("stderr", `unparseable stdout line: ${line}`);
      }
    });
    createInterface({ input: proc.stderr }).on("line", (l) => this.emit("stderr", l));
    proc.on("exit", (code) => {
      this.#proc = null;
      this.emit("exit", code);
    });

    const timeout = this.opts.handshakeTimeout ?? 5000;
    this.register = (await this.waitFor("register", timeout)) as RegisterMsg;
    this.send(rules);
    const reply = await this.waitFor(["ready", "error"], timeout);
    if (reply.type === "error") throw new Error(`bot rejected rules: ${reply.reason}`);
    return this.register;
  }

  send(msg: ClientMsg): void {
    if (!this.#proc) throw new Error("bot not running");
    this.#proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  waitFor(types: BotMsg["type"] | BotMsg["type"][], timeoutMs: number): Promise<BotMsg> {
    const want = Array.isArray(types) ? types : [types];
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        cleanup();
        rej(new Error(`timed out waiting for ${want.join("/")}`));
      }, timeoutMs);
      const onMsg = (m: BotMsg) => {
        if (want.includes(m.type)) {
          cleanup();
          res(m);
        }
      };
      const onExit = (code: number | null) => {
        cleanup();
        rej(new Error(`bot exited (code ${code}) while waiting for ${want.join("/")}`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.off("message", onMsg);
        this.off("exit", onExit);
      };
      this.on("message", onMsg);
      this.on("exit", onExit);
    });
  }

  async stop(): Promise<void> {
    const proc = this.#proc;
    if (!proc) return;
    const exited = new Promise<void>((r) => proc.once("exit", () => r()));
    try {
      this.send({ type: "quit" });
    } catch {
      /* already gone */
    }
    const killTimer = setTimeout(() => proc.kill("SIGKILL"), 1000);
    await exited;
    clearTimeout(killTimer);
  }
}
