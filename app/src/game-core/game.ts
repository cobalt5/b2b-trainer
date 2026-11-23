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

import { applyScenario, type Scenario } from "../drill/scenario";
import { FRAME_MS, toEngineHandling, type HandlingSettings } from "../ui/settings";
import { classifyLock, type LockInfo } from "./clear";
import type { KeyEvent } from "./input";
import { buildEngineParams, garbageMessiness, randomSeed, type GarbageMode } from "./rules";

/** Garbage practice: `amount` lines arrive every `interval` seconds of play. */
export interface GarbageSettings {
  mode: GarbageMode;
  amount: number;
  /** Seconds of play (paused time doesn't count). */
  interval: number;
}

export const NO_GARBAGE: GarbageSettings = { mode: "off", amount: 4, interval: 10 };

export interface LockEvent {
  info: LockInfo;
  res: LockRes;
  /** Engine state right after the lock (next piece spawned). */
  snapshot: EngineSnapshot;
  /** Cells the piece was placed on, absolute (x, y up), before lines cleared. */
  cells: [number, number][];
}

type Listener<T> = (v: T) => void;

export type ResetKind = "restart" | "undo" | "redo" | "scenario";

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
  #resetListeners = new Set<Listener<ResetKind>>();
  #placed: [number, number][] = [];
  #garbage: GarbageSettings;
  /** Engine frame at which the next garbage event is sent (garbage practice). */
  #nextGarbageFrame = 0;
  #garbageId = 0;
  /** A spin drill is loaded: garbage practice is off until the next restart(). */
  #scenario = false;

  constructor(private handling: HandlingSettings, seed?: number, garbage: GarbageSettings = NO_GARBAGE) {
    this.#garbage = { ...garbage };
    this.restart(seed);
  }

  // ------------------------------------------------------------ lifecycle

  restart(seed: number = randomSeed()): void {
    this.seed = seed;
    this.#scenario = false;
    this.#start(new Engine(buildEngineParams(seed, toEngineHandling(this.handling), this.#garbage.mode)), "restart");
  }

  /**
   * Start a spin drill: its board, hold and previews, no garbage, and
   * optionally no gravity (pieces lock on hard drop).
   */
  loadScenario(s: Scenario, opts: { gravity: boolean }): void {
    this.seed = s.seed;
    this.#scenario = true;
    const e = new Engine(buildEngineParams(s.seed, toEngineHandling(this.handling), "off", { gravity: opts.gravity }));
    applyScenario(e, s);
    this.#start(e, "scenario");
  }

  get inScenario(): boolean {
    return this.#scenario;
  }

  #start(engine: Engine, kind: ResetKind): void {
    this.engine = engine;
    this.engine.events.on("falling.lock", (res) => this.#onLock(res));
    this.#capturePlacements();
    this.#scheduleGarbage();
    this.over = false;
    this.#pending = [];
    this.#lockQueue = [];
    this.#clockStarted = false;
    this.#emitReset(kind);
  }

  undo(): boolean {
    if (this.engine.practice.undo.length === 0) return false;
    this.engine.undo();
    this.over = false;
    this.#scheduleGarbage();
    this.#pending = [];
    this.#clockStarted = false;
    this.#emitReset("undo");
    return true;
  }

  redo(): boolean {
    if (this.engine.practice.redo.length === 0) return false;
    this.engine.redo();
    this.#scheduleGarbage();
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

  /** Live-apply garbage practice settings. A new interval starts counting now. */
  setGarbage(g: GarbageSettings): void {
    const prev = this.#garbage;
    this.#garbage = { ...g };
    this.#applyMessiness();
    if (prev.mode !== g.mode || prev.interval !== g.interval) this.#scheduleGarbage();
  }

  get garbage(): Readonly<GarbageSettings> {
    return this.#garbage;
  }

  /** Garbage lines received but not yet on the board. */
  get pendingGarbage(): number {
    return this.engine.garbageQueue.size;
  }

  /** Seconds of play until the next garbage event, or null with garbage off. */
  get nextGarbageIn(): number | null {
    if (this.#garbage.mode === "off" || this.#scenario) return null;
    return Math.max(0, (this.#nextGarbageFrame - this.engine.frame) / 60);
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
    this.#maybeSendGarbage();
  }

  // ------------------------------------------------------------ garbage practice

  #scheduleGarbage(): void {
    this.#nextGarbageFrame = this.engine.frame + Math.round(this.#garbage.interval * 60);
  }

  #applyMessiness(): void {
    // The queue keeps its own copy of the options; holes are rolled at tank time.
    this.engine.garbageQueue.options.messiness = garbageMessiness(this.#garbage.mode);
  }

  /**
   * Garbage enters the queue like an opponent's attack: it waits
   * `garbage.speed` frames, can be cancelled by the player's own attack, and
   * rises onto the board at the next lock that clears no lines (capped at 8
   * lines per lock), as in TETR.IO.
   */
  #maybeSendGarbage(): void {
    const g = this.#garbage;
    if (g.mode === "off" || this.#scenario || this.over || this.engine.frame < this.#nextGarbageFrame) return;
    this.engine.receiveGarbage({
      frame: this.engine.frame,
      amount: g.amount,
      size: 1,
      cid: ++this.#garbageId,
      gameid: 0,
      confirmed: true
    });
    this.#nextGarbageFrame = this.engine.frame + Math.round(g.interval * 60);
  }

  /** Record the cells of each lock: Triangle's LockRes doesn't carry them. */
  #capturePlacements(): void {
    const board = this.engine.board;
    const add = board.add.bind(board);
    board.add = (...blocks) => {
      // #lock places the falling piece with one add() call, before clearing lines.
      this.#placed = blocks.map(([, x, y]) => [x, y]);
      return add(...blocks);
    };
  }

  // ------------------------------------------------------------ events

  onLock(fn: Listener<LockEvent>): () => void {
    this.#lockListeners.add(fn);
    return () => this.#lockListeners.delete(fn);
  }

  onReset(fn: Listener<ResetKind>): () => void {
    this.#resetListeners.add(fn);
    return () => this.#resetListeners.delete(fn);
  }

  #onLock(res: LockRes): void {
    // Runs synchronously inside engine.tick(), after line clears and the next
    // spawn, so the board is the post-lock board.
    const info = classifyLock(res, this.engine.board.state);
    this.#lockQueue.push({ info, res, snapshot: this.engine.snapshot(), cells: this.#placed });
    this.#placed = [];
    if (info.topout) this.over = true;
  }

  #flushLocks(): void {
    const q = this.#lockQueue;
    this.#lockQueue = [];
    for (const ev of q) for (const l of this.#lockListeners) l(ev);
  }

  #emitReset(kind: ResetKind): void {
    for (const l of this.#resetListeners) l(kind);
  }
}
