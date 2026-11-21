/**
 * Browser-side client for the bridge (ws://127.0.0.1:8765 by default).
 * Reconnects with backoff. Requests reject on error, timeout or disconnect.
 */

import {
  DEFAULT_BRIDGE_PORT,
  type BotState,
  type BridgeResponse,
  type ForwardableMsg,
  type RunOk
} from "../adapter/bridge-types";

export type ClientStatus =
  | { kind: "connecting" }
  | { kind: "offline"; retryInMs: number }
  | { kind: "connected"; bot: BotState; botName?: string };

/** What the planner needs from a bot connection (a fake in tests). */
export interface BotRunner {
  run(msgs: ForwardableMsg[], expect: "suggestion" | null, timeoutMs?: number): Promise<RunOk>;
}

type WSLike = Pick<WebSocket, "send" | "close" | "readyState"> & {
  onopen: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
};

const BACKOFF = [500, 1000, 2000, 4000];

export class BotClient implements BotRunner {
  status: ClientStatus = { kind: "connecting" };
  #ws: WSLike | null = null;
  #nextId = 1;
  #pending = new Map<number, { resolve: (r: RunOk) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  #listeners = new Set<(s: ClientStatus) => void>();
  #attempt = 0;
  #closed = false;

  constructor(
    readonly url: string = (import.meta.env?.VITE_BRIDGE_URL as string | undefined) ?? `ws://127.0.0.1:${DEFAULT_BRIDGE_PORT}`,
    private makeSocket: (url: string) => WSLike = (u) => new WebSocket(u)
  ) {}

  connect(): void {
    if (this.#closed) return;
    this.#setStatus({ kind: "connecting" });
    const ws = this.makeSocket(this.url);
    this.#ws = ws;
    ws.onopen = () => {
      this.#attempt = 0;
      this.#setStatus({ kind: "connected", bot: "starting" });
    };
    ws.onmessage = (ev) => this.#onMessage(String(ev.data));
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = () => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.#failAll("bridge disconnected");
      if (this.#closed) return;
      const delay = BACKOFF[Math.min(this.#attempt++, BACKOFF.length - 1)]!;
      this.#setStatus({ kind: "offline", retryInMs: delay });
      setTimeout(() => this.connect(), delay);
    };
  }

  close(): void {
    this.#closed = true;
    this.#ws?.close();
  }

  get ready(): boolean {
    return this.status.kind === "connected" && this.status.bot === "ready";
  }

  onStatus(fn: (s: ClientStatus) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  run(msgs: ForwardableMsg[], expect: "suggestion" | null, timeoutMs = 5000): Promise<RunOk> {
    const ws = this.#ws;
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error("bridge not connected"));
    const id = this.#nextId++;
    return new Promise<RunOk>((resolve, reject) => {
      // The bridge times out at timeoutMs; allow slack for queueing.
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error("bridge request timed out"));
      }, timeoutMs + 2000);
      this.#pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, op: "run", msgs, expect, timeoutMs }));
    });
  }

  #onMessage(raw: string): void {
    let m: BridgeResponse;
    try {
      m = JSON.parse(raw) as BridgeResponse;
    } catch {
      return;
    }
    if ("op" in m) {
      this.#setStatus({ kind: "connected", bot: m.state, botName: m.bot ? `${m.bot.name} ${m.bot.version?.split(" ")[0] ?? ""}`.trim() : undefined });
      return;
    }
    const p = this.#pending.get(m.id);
    if (!p) return;
    this.#pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m);
    else p.reject(new Error(m.error));
  }

  #failAll(reason: string): void {
    for (const [, p] of this.#pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.#pending.clear();
  }

  #setStatus(s: ClientStatus): void {
    this.status = s;
    for (const l of this.#listeners) l(s);
  }
}
