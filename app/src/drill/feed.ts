/**
 * Supplies drills: generates them in a worker (sync fallback where workers
 * aren't available) and keeps the next one ready while the current one is
 * played.
 */

import { generateDrill, type GenerateOptions } from "./generate";
import type { DrillChoice, Scenario } from "./scenario";

export interface DrillRequest {
  piece: DrillChoice;
  depth: number;
  maxGarbageRows: number;
  /** null = a new random seed per drill; otherwise seed, seed+1, … */
  seed: number | null;
}

const keyOf = (r: DrillRequest) => `${r.piece}|${r.depth}|${r.maxGarbageRows}|${r.seed}`;

export class DrillFeed {
  #worker: Worker | null = null;
  #ids = 0;
  #waiting = new Map<number, (s: Scenario | null) => void>();
  #ready: { key: string; promise: Promise<Scenario | null> } | null = null;
  /** Drills handed out for the current fixed seed. */
  #seedKey = "";
  #seedStep = 0;

  constructor(useWorker = typeof Worker !== "undefined") {
    if (!useWorker) return;
    try {
      this.#worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      this.#worker.onmessage = (e: MessageEvent<{ id: number; scenario: Scenario | null }>) => {
        const done = this.#waiting.get(e.data.id);
        this.#waiting.delete(e.data.id);
        done?.(e.data.scenario);
      };
      this.#worker.onerror = (e) => {
        console.error("drill worker failed; generating on the main thread", e);
        this.#worker = null;
        for (const done of this.#waiting.values()) done(null);
        this.#waiting.clear();
      };
    } catch {
      this.#worker = null;
    }
  }

  /** The next drill for these options (the prefetched one if it matches), then prefetch another. */
  next(req: DrillRequest): Promise<Scenario | null> {
    const key = keyOf(req);
    const ready = this.#ready?.key === key ? this.#ready.promise : null;
    this.#ready = null;
    const promise = ready ?? this.#generate(req);
    void promise.then(() => {
      if (!this.#ready) this.#ready = { key, promise: this.#generate(req) };
    });
    return promise;
  }

  /** Drop the prefetched drill (e.g. the options changed). */
  discard(): void {
    this.#ready = null;
  }

  #seedFor(req: DrillRequest): number {
    if (req.seed === null) return Math.floor(Math.random() * 2 ** 31);
    const k = keyOf(req);
    if (k !== this.#seedKey) {
      this.#seedKey = k;
      this.#seedStep = 0;
    }
    return req.seed + this.#seedStep++;
  }

  #generate(req: DrillRequest): Promise<Scenario | null> {
    const opts: GenerateOptions = { piece: req.piece, depth: req.depth, seed: this.#seedFor(req), maxGarbageRows: req.maxGarbageRows };
    if (this.#worker) {
      const id = ++this.#ids;
      return new Promise((resolve) => {
        this.#waiting.set(id, resolve);
        this.#worker!.postMessage({ id, opts });
      });
    }
    // Defer a tick so callers see the same async shape as the worker path.
    return new Promise((resolve) => setTimeout(() => resolve(generateDrill(opts)), 0));
  }
}
