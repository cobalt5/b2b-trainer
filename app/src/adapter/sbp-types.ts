/**
 * Stacker Bot Protocol (SBP/1) message types, per spec/sbp-1.md @ ff643c20.
 * Shared by the app and the bridge.
 */

export type PieceId = "I" | "J" | "L" | "O" | "S" | "T" | "Z";
export type Orientation = "north" | "east" | "south" | "west";
export type Cell = string | null;
/** Rows bottom-up; each row is `width` cells. */
export type SbpBoard = Cell[][];

export interface PieceLocation {
  piece: PieceId;
  orientation: Orientation;
  x: number;
  y: number;
}

export interface Placement {
  location: PieceLocation;
  spin: "none" | "mini" | "full";
}

/** Namespaced extension keys used by our Frostetra fork. */
export const EXT = {
  topN: "b2btrainer.top_n",
  pv: "b2btrainer.pv",
  pvAll: "b2btrainer.pv_all",
  pvs: "b2btrainer.pvs",
  iterations: "b2btrainer.iterations",
  b2bPlan: "b2btrainer.b2b_plan",
  b2bPlans: "b2btrainer.b2b_plans"
} as const;

/** `suggest.extensions["b2btrainer.b2b_plan"]` (all fields optional). */
export interface B2BPlanRequest {
  max_depth?: number;
  beam_width?: number;
  top_n?: number;
  length_penalty?: number;
  spin_bonus?: number;
}

/** One entry of `suggestion.extensions["b2btrainer.b2b_plans"]`, best first. */
export interface B2BPlanWire {
  moves: Placement[];
  final_clear: {
    lines: number;
    spin: Placement["spin"];
    b2b_class: "quad" | "t-spin" | "t-spin-mini" | "allspin" | "allspin-mini" | "perfect-clear";
    perfect_clear: boolean;
  };
  score: number;
}

// ---- client → bot

export interface RulesMsg {
  type: "rules";
  randomizer?: string;
  kickset?: string;
  rot180?: boolean;
  sonic_drop?: "none" | "allow" | "only";
  spin_detection?: string;
  back_to_back_sources?: string[];
  spawn_position?: { x: number; y: number };
  board_size?: { width: number; height: number };
}

export interface StartMsg {
  type: "start";
  board: SbpBoard;
  active: PieceId;
  queue: PieceId[];
  hold: PieceId | null;
  combo: number;
  back_to_back: number | boolean;
  piece_stream?: { pieces: PieceId[]; offset: number | null };
  incoming_garbage?: number[] | null;
  extensions?: Record<string, unknown>;
}

export interface SuggestMsg {
  type: "suggest";
  incoming_garbage?: number[] | null;
  extensions?: Record<string, unknown>;
}

export interface AdvanceMsg {
  type: "advance";
  move: Placement;
}

export interface NewPieceMsg {
  type: "new_piece";
  piece: PieceId;
}

export interface BoardMsg {
  type: "board";
  board: SbpBoard;
}

export interface StopMsg {
  type: "stop";
  reason?: string;
}

export interface QuitMsg {
  type: "quit";
}

export type ClientMsg = RulesMsg | StartMsg | SuggestMsg | AdvanceMsg | NewPieceMsg | BoardMsg | StopMsg | QuitMsg;

// ---- bot → client

export interface RegisterMsg {
  type: "register";
  name: string;
  version?: string;
  author?: string;
  capabilities?: Record<string, unknown>;
}

export interface ReadyMsg {
  type: "ready";
}

export interface ErrorMsg {
  type: "error";
  reason: string;
}

export interface InfoMsg {
  type: "info";
  topic: string;
  data: unknown;
}

export interface SuggestionMsg {
  type: "suggestion";
  moves: Placement[];
  extensions?: Record<string, unknown>;
}

export type BotMsg = RegisterMsg | ReadyMsg | ErrorMsg | InfoMsg | SuggestionMsg;

// ---- our rules (matches Minorail tetrio.settings.toml)

export const TRAINER_RULES: RulesMsg = {
  type: "rules",
  randomizer: "seven_bag",
  kickset: "srs_plus",
  rot180: true,
  sonic_drop: "only",
  spin_detection: "all-mini+",
  back_to_back_sources: ["quad", "t-spin", "t-spin-mini", "allspin", "allspin-mini", "perfect-clear"],
  spawn_position: { x: 4, y: 21 },
  board_size: { width: 10, height: 40 }
};

export function emptySbpBoard(width = 10, height = 40): SbpBoard {
  return Array.from({ length: height }, () => Array<Cell>(width).fill(null));
}
