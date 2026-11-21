/**
 * Owns the play engine and the 60 Hz fixed-step loop.
 *
 * Key events carry wall-clock timestamps. Each engine frame covers
 * [frameStart, frameStart + FRAME_MS), and events inside that window are fed
 * to `engine.tick()` with `subframe` = their offset into it, so DAS/ARR timing
 * is sub-frame accurate (as in TETR.IO replays).
 *
 * The class doesn't touch the DOM: `advance(now)` is driven by rAF in main.ts
 * and by fake clocks in tests.
 */

import { Engine, type EngineSnapshot, type LockRes } from "@haelp/teto/engine";
import type { Game as TetoGame } from "@haelp/teto/types";

import { FRAME_MS, toEngineHandling, type HandlingSettings } from "../ui/settings";
import { classifyLock, type LockInfo } from "./clear";
import type { KeyEvent } from "./input";
import { buildEngineParams, randomSeed } from "./rules";

export interface LockEvent {
  info: LockInfo;
  res: LockRes;
  /** Engine state right after the lock (next piece spawned). */
  snapshot: EngineSnapshot;
}

type Listener<T> = (v: T) => void;

/** Max frames simulated per advance() before we drop time (e.g. tab was hidden). */
const MAX_CATCHUP_FRAMES = 10;

export class GameSession {
  engine!: Engine;
  seed = 0;
  paused = false;
  over = false;

  #frameStart = 0;
  #clockStarted = false;
  #pending: KeyEvent[] = [];
  #lockQueue: LockEvent[] = [];
  #lockListeners = new Set<Listener<LockEvent>>();
  #resetListeners = new Set<Listener<"restart" | "undo" | "redo">>();

  constructor(private handling: HandlingSettings, seed?: number) {
    this.restart(seed);
  }

  // ------------------------------------------------------------ lifecycle

  restart(seed: number = randomSeed()): void {
    this.seed = seed;
    this.engine = new Engine(buildEngineParams(seed, toEngineHandling(this.handling)));
    this.engine.events.on("falling.lock", (res) => this.#onLock(res));
    this.over = false;
    this.#pending = [];
    this.#lockQueue = [];
    this.#clockStarted = false;
    this.#emitReset("restart");
  }

  undo(): boolean {
    if (this.engine.practice.undo.length === 0) return false;
    this.engine.undo();
    this.over = false;
    this.#pending = [];
    this.#clockStarted = false;
    this.#emitReset("undo");
    return true;
  }

  redo(): boolean {
    if (this.engine.practice.redo.length === 0) return false;
    this.engine.redo();
    this.#pending = [];
    this.#clockStarted = false;
    this.#emitReset("redo");
    return true;
  }

  setPaused(p: boolean): void {
    if (this.paused === p) return;
    this.paused = p;
    // Restart the clock on resume so paused time isn't simulated.
    if (!p) this.#clockStarted = false;
  }

  /** Live-apply new handling (DAS/ARR/SDF…) without restarting. */
  setHandling(h: HandlingSettings): void {
    this.handling = h;
    this.engine.handling = toEngineHandling(h);
  }

  get running(): boolean {
    return !this.paused && !this.over;
  }

  // ------------------------------------------------------------ input

  keyEvent(e: KeyEvent): void {
    // Drop presses while not running, but always deliver releases so the
    // engine never thinks a key is stuck down.
    if (!this.running && e.down) return;
    this.#pending.push(e);
  }

  // ------------------------------------------------------------ clock

  /** Simulate every whole frame that has elapsed up to `now`. Returns frames run. */
  advance(now: number): number {
    if (!this.running) return 0;
    if (!this.#clockStarted) {
      this.#frameStart = now;
      this.#clockStarted = true;
    }
    if (now - this.#frameStart > MAX_CATCHUP_FRAMES * FRAME_MS) {
      this.#frameStart = now - MAX_CATCHUP_FRAMES * FRAME_MS;
    }
    let n = 0;
    while (this.running && now >= this.#frameStart + FRAME_MS) {
      this.#tickFrame(this.#frameStart);
      this.#frameStart += FRAME_MS;
      n++;
    }
    return n;
  }

  #tickFrame(start: number): void {
    const end = start + FRAME_MS;
    this.#pending.sort((a, b) => a.t - b.t);
    const due: KeyEvent[] = [];
    while (this.#pending.length && this.#pending[0]!.t < end) due.push(this.#pending.shift()!);

    let last = 0;
    const frames: TetoGame.Replay.Frame[] = due.map((e) => {
      const sub = Math.min(0.999, Math.max(last, (e.t - start) / FRAME_MS));
      last = sub;
      return {
        type: e.down ? "keydown" : "keyup",
        frame: this.engine.frame,
        data: { key: e.key, subframe: sub }
      };
    });

    this.engine.tick(frames);
    this.#flushLocks();
  }

  // ------------------------------------------------------------ events

  onLock(fn: Listener<LockEvent>): () => void {
    this.#lockListeners.add(fn);
    return () => this.#lockListeners.delete(fn);
  }

  onReset(fn: Listener<"restart" | "undo" | "redo">): () => void {
    this.#resetListeners.add(fn);
    return () => this.#resetListeners.delete(fn);
  }

  #onLock(res: LockRes): void {
    // Runs synchronously inside engine.tick(), after line clears and the next
    // spawn, so the board is the post-lock board.
    const info = classifyLock(res, this.engine.board.state);
    this.#lockQueue.push({ info, res, snapshot: this.engine.snapshot() });
    if (info.topout) this.over = true;
  }

  #flushLocks(): void {
    const q = this.#lockQueue;
    this.#lockQueue = [];
    for (const ev of q) for (const l of this.#lockListeners) l(ev);
  }

  #emitReset(kind: "restart" | "undo" | "redo"): void {
    for (const l of this.#resetListeners) l(kind);
  }
}
