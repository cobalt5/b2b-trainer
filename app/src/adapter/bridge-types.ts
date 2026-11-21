/**
 * App ⇄ bridge protocol over ws://127.0.0.1:<port>. Shared by both sides.
 *
 * The bridge owns the bot process and the `rules` handshake. The app sends
 * batches of SBP client messages; requests run one at a time in FIFO order.
 */

import type { ClientMsg, SuggestionMsg } from "./sbp-types";

export const DEFAULT_BRIDGE_PORT = 8765;

/** SBP message types the app may send (the bridge owns rules/quit). */
export const FORWARDABLE_TYPES = ["start", "suggest", "advance", "new_piece", "board", "stop"] as const;
export type ForwardableMsg = Extract<ClientMsg, { type: (typeof FORWARDABLE_TYPES)[number] }>;

export interface RunRequest {
  id: number;
  op: "run";
  msgs: ForwardableMsg[];
  /** Wait for the bot's next `suggestion` after sending `msgs`. */
  expect: "suggestion" | null;
  timeoutMs?: number;
}

export type BridgeRequest = RunRequest;

export interface RunOk {
  id: number;
  ok: true;
  suggestion?: SuggestionMsg;
  /** Bot time for this request (send → suggestion), ms. */
  ms: number;
  /** Bot process generation; changes after a restart (bot session state was lost). */
  epoch: number;
}

export interface RunErr {
  id: number;
  ok: false;
  error: string;
  epoch: number;
}

export type BotState = "starting" | "ready" | "restarting" | "failed";

export interface StatusPush {
  op: "status";
  state: BotState;
  epoch: number;
  bot?: { name: string; version?: string };
  detail?: string;
}

export type BridgeResponse = RunOk | RunErr | StatusPush;
