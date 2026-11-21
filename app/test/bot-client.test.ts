import { describe, expect, it, vi } from "vitest";

import { BotClient, type ClientStatus } from "../src/planner/bot-client";

class FakeSocket {
  readyState = 0;
  sent: any[] = [];
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
  open() {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
  push(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) } as MessageEvent);
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const c = new BotClient("ws://test", () => {
    const s = new FakeSocket();
    sockets.push(s);
    return s as any;
  });
  const statuses: ClientStatus[] = [];
  c.onStatus((s) => statuses.push(s));
  c.connect();
  return { c, sockets, statuses };
}

describe("BotClient", () => {
  it("tracks status from bridge pushes", () => {
    const { c, sockets } = setup();
    expect(c.ready).toBe(false);
    sockets[0]!.open();
    sockets[0]!.push({ op: "status", state: "ready", epoch: 1, bot: { name: "Frostetra", version: "0.1.0" } });
    expect(c.ready).toBe(true);
    expect(c.status).toMatchObject({ kind: "connected", botName: "Frostetra 0.1.0" });
  });

  it("matches responses to requests by id", async () => {
    const { c, sockets } = setup();
    sockets[0]!.open();
    const p1 = c.run([{ type: "suggest" }], "suggestion");
    const p2 = c.run([{ type: "stop" }], null);
    const [r1, r2] = sockets[0]!.sent;
    sockets[0]!.push({ id: r2.id, ok: true, ms: 1, epoch: 1 });
    sockets[0]!.push({ id: r1.id, ok: false, error: "nope", epoch: 1 });
    await expect(p2).resolves.toMatchObject({ ok: true });
    await expect(p1).rejects.toThrow("nope");
  });

  it("rejects in-flight requests on disconnect and schedules a reconnect", async () => {
    vi.useFakeTimers();
    const { c, sockets, statuses } = setup();
    sockets[0]!.open();
    const p = c.run([{ type: "suggest" }], "suggestion");
    sockets[0]!.close();
    await expect(p).rejects.toThrow("bridge disconnected");
    expect(statuses.at(-1)).toMatchObject({ kind: "offline" });
    vi.advanceTimersByTime(600);
    expect(sockets).toHaveLength(2);
    vi.useRealTimers();
  });

  it("refuses to send when not connected", async () => {
    const { c } = setup();
    await expect(c.run([{ type: "suggest" }], "suggestion")).rejects.toThrow("not connected");
  });
});
