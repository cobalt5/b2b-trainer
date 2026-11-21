/**
 * Bridge: WebSocket server on 127.0.0.1 that relays app requests to Frostetra.
 *
 *   npm run dev -w bridge   (BRIDGE_PORT, BOT_PATH, BOT_CONFIG env overrides)
 *
 * Only localhost page origins may connect. A web page can open a WebSocket
 * to 127.0.0.1, so we check the Origin header.
 */
import { WebSocketServer, type WebSocket } from "ws";

import { DEFAULT_BRIDGE_PORT, type BridgeResponse } from "../../app/src/adapter/bridge-types.ts";
import { TRAINER_RULES } from "../../app/src/adapter/sbp-types.ts";
import type { BotOptions } from "./bot.ts";
import { Supervisor } from "./supervisor.ts";
import { checkRequest } from "./validate.ts";

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const MAX_MESSAGE_BYTES = 256 * 1024;

export function isAllowedOrigin(origin: string | undefined): boolean {
  // Non-browser clients (tests, CLI) send no Origin.
  return origin === undefined || LOCAL_ORIGIN.test(origin);
}

export interface BridgeOptions {
  port?: number;
  host?: string;
  bot?: BotOptions;
  log?: (msg: string) => void;
}

export interface Bridge {
  port: number;
  supervisor: Supervisor;
  close(): Promise<void>;
}

export async function startBridge(opts: BridgeOptions = {}): Promise<Bridge> {
  const log = opts.log ?? ((m: string) => console.log(`[bridge] ${m}`));
  const rules = TRAINER_RULES;
  const shape = rules.board_size ?? { width: 10, height: 40 };
  const supervisor = new Supervisor(rules, opts.bot);
  const clients = new Set<WebSocket>();
  const send = (ws: WebSocket, msg: BridgeResponse) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  supervisor.on("log", log);
  supervisor.on("status", (s) => {
    log(`bot ${s.state}${s.detail ? `: ${s.detail}` : ""}`);
    for (const c of clients) send(c, s);
  });

  const wss = new WebSocketServer({
    host: opts.host ?? "127.0.0.1",
    port: opts.port ?? DEFAULT_BRIDGE_PORT,
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: ({ origin }: { origin?: string }) => {
      const ok = isAllowedOrigin(origin);
      if (!ok) log(`rejected connection from origin ${origin}`);
      return ok;
    }
  });
  await new Promise<void>((res, rej) => {
    wss.once("listening", () => res());
    wss.once("error", rej);
  });
  const addr = wss.address();
  const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? DEFAULT_BRIDGE_PORT);

  wss.on("connection", (ws) => {
    clients.add(ws);
    send(ws, supervisor.status);
    ws.on("close", () => clients.delete(ws));
    ws.on("message", async (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        send(ws, { id: -1, ok: false, error: "invalid JSON", epoch: supervisor.epoch });
        return;
      }
      const checked = checkRequest(parsed, shape);
      if (!checked.ok) {
        send(ws, { id: checked.id, ok: false, error: checked.error, epoch: supervisor.epoch });
        return;
      }
      send(ws, await supervisor.run(checked.req));
    });
  });

  await supervisor.start();
  log(`listening on ws://${opts.host ?? "127.0.0.1"}:${port}`);

  return {
    port,
    supervisor,
    async close() {
      for (const c of clients) c.close();
      await new Promise<void>((r) => wss.close(() => r()));
      await supervisor.stop();
    }
  };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const bridge = await startBridge({
    port: process.env.BRIDGE_PORT ? Number(process.env.BRIDGE_PORT) : undefined,
    bot: {
      binPath: process.env.BOT_PATH || undefined,
      configPath: process.env.BOT_CONFIG || undefined
    }
  }).catch((e) => {
    console.error(`[bridge] failed to start: ${(e as Error).message}`);
    process.exit(1);
  });
  const shutdown = async () => {
    await bridge.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
