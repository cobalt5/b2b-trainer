/**
 * Shape checks before anything reaches the bot. Frostetra panics on a known
 * message type with a malformed body (docs/notes.md §3), so reject here.
 */
import { FORWARDABLE_TYPES, type BridgeRequest, type ForwardableMsg } from "../../app/src/adapter/bridge-types.ts";

const PIECES = new Set(["I", "J", "L", "O", "S", "T", "Z"]);
const ORIENT = new Set(["north", "east", "south", "west"]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isUint = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
const isInt = (v: unknown) => Number.isInteger(v);
const isPiece = (v: unknown) => typeof v === "string" && PIECES.has(v);

export interface BoardShape {
  width: number;
  height: number;
}

function checkBoard(b: unknown, shape: BoardShape): string | null {
  if (!Array.isArray(b) || b.length !== shape.height) return `board must have ${shape.height} rows`;
  for (const row of b) {
    if (!Array.isArray(row) || row.length !== shape.width) return `board rows must have ${shape.width} cells`;
    for (const c of row) if (c !== null && typeof c !== "string") return "board cells must be null or strings";
  }
  return null;
}

function checkLocation(l: unknown): string | null {
  if (!isObj(l)) return "location must be an object";
  if (!isPiece(l.piece)) return "location.piece invalid";
  if (typeof l.orientation !== "string" || !ORIENT.has(l.orientation)) return "location.orientation invalid";
  if (!isInt(l.x) || !isInt(l.y)) return "location.x/y must be integers";
  return null;
}

export function checkMsg(m: unknown, shape: BoardShape): string | null {
  if (!isObj(m) || typeof m.type !== "string") return "message must be an object with a string type";
  if (!(FORWARDABLE_TYPES as readonly string[]).includes(m.type)) return `message type not allowed: ${m.type}`;
  switch (m.type as ForwardableMsg["type"]) {
    case "start": {
      const e = checkBoard(m.board, shape);
      if (e) return e;
      if (!isPiece(m.active)) return "start.active invalid";
      if (!Array.isArray(m.queue) || !m.queue.every(isPiece)) return "start.queue invalid";
      if (m.hold !== null && !isPiece(m.hold)) return "start.hold invalid";
      if (!isUint(m.combo)) return "start.combo must be a non-negative integer";
      if (!isUint(m.back_to_back) && typeof m.back_to_back !== "boolean") return "start.back_to_back invalid";
      return null;
    }
    case "board":
      return checkBoard(m.board, shape);
    case "advance": {
      if (!isObj(m.move)) return "advance.move must be an object";
      if (typeof m.move.spin !== "string") return "advance.move.spin must be a string";
      return checkLocation(m.move.location);
    }
    case "new_piece":
      return isPiece(m.piece) ? null : "new_piece.piece invalid";
    case "suggest":
      // Frostetra deserializes this as a JSON object; anything else panics it.
      if (m.extensions !== undefined && !isObj(m.extensions)) return "suggest.extensions must be an object";
      return null;
    case "stop":
      return null;
  }
}

export function checkRequest(r: unknown, shape: BoardShape): { ok: true; req: BridgeRequest } | { ok: false; id: number; error: string } {
  const id = isObj(r) && isInt(r.id) ? (r.id as number) : -1;
  if (!isObj(r) || r.op !== "run") return { ok: false, id, error: "unknown op" };
  if (!Array.isArray(r.msgs)) return { ok: false, id, error: "msgs must be an array" };
  for (const m of r.msgs) {
    const e = checkMsg(m, shape);
    if (e) return { ok: false, id, error: e };
  }
  if (r.expect !== null && r.expect !== "suggestion") return { ok: false, id, error: "expect must be 'suggestion' or null" };
  if (r.timeoutMs !== undefined && !(isUint(r.timeoutMs) && (r.timeoutMs as number) <= 60_000)) return { ok: false, id, error: "bad timeoutMs" };
  return { ok: true, req: r as unknown as BridgeRequest };
}
