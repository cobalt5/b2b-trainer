import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import WebSocket from "ws";

import type { BridgeResponse, RunErr, RunOk, StatusPush } from "../../app/src/adapter/bridge-types.ts";
import { emptySbpBoard, type StartMsg } from "../../app/src/adapter/sbp-types.ts";
import { isAllowedOrigin, startBridge, type Bridge } from "./server.ts";

const START: StartMsg = {
  type: "start",
  board: emptySbpBoard(),
  active: "T",
  queue: ["I", "O", "L", "J", "S"],
  hold: null,
  combo: 0,
  back_to_back: 0
};

let bridge: Bridge;
let nextId = 1;

function connect(origin?: string): Promise<WebSocket> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`, origin ? { origin } : {});
    ws.once("open", () => res(ws));
    ws.once("error", rej);
    ws.once("unexpected-response", (_req, r) => rej(new Error(`HTTP ${r.statusCode}`)));
  });
}

function request(ws: WebSocket, body: object): Promise<RunOk | RunErr> {
  const id = nextId++;
  return new Promise((res) => {
    const onMsg = (d: WebSocket.RawData) => {
      const m = JSON.parse(String(d)) as BridgeResponse;
      if ("id" in m && m.id === id) {
        ws.off("message", onMsg);
        res(m);
      }
    };
    ws.on("message", onMsg);
    ws.send(JSON.stringify({ id, op: "run", expect: null, ...body }));
  });
}

const waitStatus = (ws: WebSocket, state: StatusPush["state"]) =>
  new Promise<StatusPush>((res) => {
    const onMsg = (d: WebSocket.RawData) => {
      const m = JSON.parse(String(d)) as BridgeResponse;
      if ("op" in m && m.op === "status" && m.state === state) {
        ws.off("message", onMsg);
        res(m);
      }
    };
    ws.on("message", onMsg);
  });

before(async () => {
  bridge = await startBridge({ port: 0, log: () => {} });
});
after(async () => {
  await bridge.close();
});

describe("origin check", () => {
  it("allows localhost origins and no origin, rejects others", async () => {
    assert.ok(isAllowedOrigin(undefined));
    assert.ok(isAllowedOrigin("http://127.0.0.1:5173"));
    assert.ok(isAllowedOrigin("http://localhost:5173"));
    assert.ok(!isAllowedOrigin("https://example.com"));
    assert.ok(!isAllowedOrigin("http://127.0.0.1.evil.com"));
    await assert.rejects(connect("https://example.com"), /HTTP 401/);
    (await connect("http://127.0.0.1:5173")).close();
  });
});

describe("requests", () => {
  it("returns a suggestion for stop + start + suggest", async () => {
    const ws = await connect();
    const r = await request(ws, { msgs: [{ type: "stop" }, START, { type: "suggest" }], expect: "suggestion" });
    assert.ok(r.ok, !r.ok ? r.error : "");
    assert.ok(r.suggestion && r.suggestion.moves.length > 0);
    assert.equal(typeof r.ms, "number");
    ws.close();
  });

  it("rejects malformed messages without touching the bot", async () => {
    const ws = await connect();
    const epoch = bridge.supervisor.epoch;
    const bad = await request(ws, { msgs: [{ ...START, board: [[null]] }], expect: null });
    assert.equal(bad.ok, false);
    const rules = await request(ws, { msgs: [{ type: "rules" }], expect: null });
    assert.equal(rules.ok, false);
    const neg = await request(ws, { msgs: [{ ...START, combo: -1 }], expect: null });
    assert.equal(neg.ok, false);
    const ext = await request(ws, { msgs: [{ type: "suggest", extensions: "pv" }], expect: null });
    assert.equal(ext.ok, false);
    const good = await request(ws, { msgs: [{ type: "stop" }, START, { type: "suggest" }], expect: "suggestion" });
    assert.ok(good.ok);
    assert.equal(bridge.supervisor.epoch, epoch);
    ws.close();
  });

  it("runs concurrent requests in FIFO order", async () => {
    const ws = await connect();
    const order: number[] = [];
    const reqs = [0, 1, 2].map((i) =>
      request(ws, { msgs: [{ type: "stop" }, START, { type: "suggest" }], expect: "suggestion" }).then((r) => {
        order.push(i);
        return r;
      })
    );
    const results = await Promise.all(reqs);
    assert.deepEqual(order, [0, 1, 2]);
    assert.ok(results.every((r) => r.ok));
    ws.close();
  });
});

describe("crash recovery", () => {
  it("restarts the bot and serves the next request with a new epoch", async () => {
    const ws = await connect();
    const epoch = bridge.supervisor.epoch;
    const ready = waitStatus(ws, "ready");
    process.kill(bridge.supervisor.pid!, "SIGKILL");
    await ready;
    const r = await request(ws, { msgs: [{ type: "stop" }, START, { type: "suggest" }], expect: "suggestion" });
    assert.ok(r.ok, !r.ok ? r.error : "");
    assert.equal(r.epoch, epoch + 1);
    ws.close();
  });
});

describe("b2b-trainer extensions through the bridge", () => {
  it("returns top-N moves and a PV", async () => {
    const ws = await connect();
    const r = await request(ws, {
      msgs: [{ type: "stop" }, START, { type: "suggest", extensions: { "b2btrainer.top_n": 3, "b2btrainer.pv": 6 } }],
      expect: "suggestion"
    });
    assert.ok(r.ok, !r.ok ? r.error : "");
    assert.ok(r.suggestion!.moves.length > 1);
    const pv = r.suggestion!.extensions?.["b2btrainer.pv"] as unknown[];
    assert.ok(Array.isArray(pv) && pv.length >= 1 && pv.length <= 6);
    assert.deepEqual(pv[0], r.suggestion!.moves[0]);
    ws.close();
  });
});
