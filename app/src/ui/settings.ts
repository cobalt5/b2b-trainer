/**
 * User settings: controls (handling and keybinds), hints, and practice options.
 *
 * Every value here can be changed by the user. Handling is stored in the
 * engine's own units (frames at 60 fps; SDF is a multiplier) so it maps onto
 * Triangle's `engine.handling` with no rounding. The settings UI shows ms
 * alongside frames.
 */

import type { Game } from "@haelp/teto/types";

import { MAX_DEPTH, type DrillChoice } from "../drill/scenario";
import type { PlanStrategy } from "../planner/plan";

export const FRAME_MS = 1000 / 60;
/** Triangle treats SDF >= 41 as instant soft drop (as TETR.IO does). */
export const SDF_INSTANT = 41;

// ---------------------------------------------------------------- actions

/** Keys forwarded to the engine as keydown/keyup frames. */
export const GAME_ACTIONS = [
  "moveLeft",
  "moveRight",
  "softDrop",
  "hardDrop",
  "rotateCCW",
  "rotateCW",
  "rotate180",
  "hold"
] as const satisfies readonly Game.Key[];
export type GameAction = (typeof GAME_ACTIONS)[number];

/** App-level actions handled outside the engine. */
export const APP_ACTIONS = [
  "hint",
  "prevPlan",
  "nextPlan",
  "restart",
  "undo",
  "redo",
  "pause",
  "openSettings",
  "nextDrill",
  "toggleMode"
] as const;
export type AppAction = (typeof APP_ACTIONS)[number];

export type Action = GameAction | AppAction;
export const ALL_ACTIONS: readonly Action[] = [...GAME_ACTIONS, ...APP_ACTIONS];

export const ACTION_LABELS: Record<Action, string> = {
  moveLeft: "Move left",
  moveRight: "Move right",
  softDrop: "Soft drop",
  hardDrop: "Hard drop",
  rotateCCW: "Rotate CCW",
  rotateCW: "Rotate CW",
  rotate180: "Rotate 180",
  hold: "Hold",
  hint: "Show hint",
  prevPlan: "Previous plan",
  nextPlan: "Next plan",
  restart: "Restart",
  undo: "Undo",
  redo: "Redo",
  pause: "Pause",
  openSettings: "Settings",
  nextDrill: "Next drill",
  toggleMode: "Free play / drills"
};

/**
 * A binding is a `KeyboardEvent.code`, optionally prefixed by modifiers:
 * "ArrowLeft", "KeyZ", "Ctrl+KeyZ", "Ctrl+Shift+KeyZ".
 * Using `code` (physical key) keeps binds layout-independent.
 */
export type Binding = string;

export type Keybinds = Record<Action, Binding[]>;

// ---------------------------------------------------------------- schema

export interface HandlingSettings {
  /** Delayed auto shift, frames. */
  das: number;
  /** Auto repeat rate, frames (0 = instant). */
  arr: number;
  /** DAS cut delay, frames. */
  dcd: number;
  /** Soft drop factor, multiplier (>= 41 = instant). */
  sdf: number;
  /** Prevent accidental hard drop right after spawn. */
  safelock: boolean;
  /** Cancel DAS when changing direction. */
  cancel: boolean;
  /** Initial rotation / hold system. */
  irs: "off" | "hold" | "tap";
  ihs: "off" | "hold" | "tap";
}

export type HintLifetime = "off" | "clear" | "auto-refresh";
export type { PlanStrategy };

export interface HintSettings {
  lifetime: HintLifetime;
  /** Show every step, or only step 1. */
  showFullPlan: boolean;
  pauseWhileShown: boolean;
  /** Frostetra iterations per suggest. */
  searchIterations: number;
  topN: number;
  /** "beam" = B2B planner in the bot (strategy B); "pv-walk" = the bot's own line (A). */
  strategy: PlanStrategy;
  /** Strategy B: states kept per search layer. */
  beamWidth: number;
}

export type { GarbageMode } from "../game-core/rules";
import type { GarbageMode } from "../game-core/rules";

export interface PracticeSettings {
  /** null = random seed each restart. */
  seed: number | null;
  garbage: GarbageMode;
  /** Lines per garbage event. */
  garbageAmount: number;
  /** Seconds between garbage events. */
  garbageInterval: number;
}

export type AppMode = "free" | "drill";
export type { DrillChoice };

export interface DrillSettings {
  piece: DrillChoice;
  /** Pieces to place per drill, the spin included (1–7). */
  depth: number;
  /** Normal gravity and lock delay; off = pieces lock on hard drop. */
  gravity: boolean;
  /** Load the next drill shortly after a pass. */
  autoAdvance: boolean;
  /** Garbage rows under the stack: up to this many (0–4). */
  maxGarbageRows: number;
  /** null = random drills; otherwise a fixed sequence. */
  seed: number | null;
}

export interface Settings {
  version: 1;
  mode: AppMode;
  handling: HandlingSettings;
  keybinds: Keybinds;
  hint: HintSettings;
  practice: PracticeSettings;
  drill: DrillSettings;
}

// ---------------------------------------------------------------- defaults

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  mode: "free",
  handling: {
    das: 10, // 167 ms
    arr: 2, // 33 ms
    dcd: 1, // 17 ms
    sdf: 6,
    safelock: false,
    cancel: false,
    irs: "tap",
    ihs: "tap"
  },
  keybinds: {
    moveLeft: ["ArrowLeft"],
    moveRight: ["ArrowRight"],
    softDrop: ["ArrowDown"],
    hardDrop: ["Space"],
    rotateCCW: ["KeyZ"],
    rotateCW: ["KeyX", "ArrowUp"],
    rotate180: ["KeyA"],
    hold: ["KeyC", "ShiftLeft"],
    hint: ["Tab"],
    prevPlan: ["BracketLeft"],
    nextPlan: ["BracketRight"],
    restart: ["KeyR"],
    undo: ["Ctrl+KeyZ"],
    redo: ["Ctrl+KeyY", "Ctrl+Shift+KeyZ"],
    pause: ["Escape"],
    openSettings: ["F1"],
    nextDrill: ["KeyN"],
    toggleMode: ["F2"]
  },
  hint: {
    lifetime: "clear",
    showFullPlan: true,
    pauseWhileShown: false,
    searchIterations: 4000, // p95 hint latency ≈ 280 ms (Design_Doc §3.2 target: 300 ms)
    topN: 3,
    strategy: "beam",
    beamWidth: 300
  },
  practice: {
    seed: null,
    garbage: "off",
    garbageAmount: 4,
    garbageInterval: 10
  },
  drill: {
    piece: "T",
    depth: 1,
    gravity: false,
    autoAdvance: true,
    maxGarbageRows: 2,
    seed: null
  }
};

/** Range limits used by validation and the settings UI. */
export const HANDLING_LIMITS = {
  das: { min: 0, max: 20, step: 0.1 },
  arr: { min: 0, max: 5, step: 0.1 },
  dcd: { min: 0, max: 20, step: 0.1 },
  sdf: { min: 5, max: SDF_INSTANT, step: 1 }
} as const;

// ---------------------------------------------------------------- conversion

export const framesToMs = (f: number) => Math.round(f * FRAME_MS);
export const msToFrames = (ms: number) => Math.round((ms / FRAME_MS) * 10) / 10;

/** Build Triangle's `Game.Handling` from user settings. */
export function toEngineHandling(h: HandlingSettings): Game.Handling {
  return {
    das: h.das,
    arr: h.arr,
    dcd: h.dcd,
    sdf: h.sdf,
    safelock: h.safelock,
    cancel: h.cancel,
    may20g: true,
    irs: h.irs,
    ihs: h.ihs
  };
}

// ---------------------------------------------------------------- bindings

const MODIFIERS = ["Ctrl", "Shift", "Alt", "Meta"] as const;
type Modifier = (typeof MODIFIERS)[number];

export interface ParsedBinding {
  code: string;
  mods: Set<Modifier>;
}

export function parseBinding(b: Binding): ParsedBinding {
  const parts = b.split("+");
  const code = parts.pop() ?? "";
  const mods = new Set<Modifier>();
  for (const p of parts) {
    if ((MODIFIERS as readonly string[]).includes(p)) mods.add(p as Modifier);
  }
  return { code, mods };
}

export function formatBinding(b: Binding): string {
  const { code, mods } = parseBinding(b);
  const named: Record<string, string> = {
    ShiftLeft: "Left Shift",
    ShiftRight: "Right Shift",
    ControlLeft: "Left Ctrl",
    ControlRight: "Right Ctrl",
    AltLeft: "Left Alt",
    AltRight: "Right Alt",
    MetaLeft: "Left Meta",
    MetaRight: "Right Meta",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\"
  };
  const key = (named[code] ?? code)
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace(/^Arrow/, "")
    .replace(/^Bracket(Left|Right)$/, (_, s) => (s === "Left" ? "[" : "]"));
  return [...MODIFIERS.filter((m) => mods.has(m)), key].join(" + ");
}

/** Build a binding string from a keyboard event (for "press a key to bind"). */
export function bindingFromEvent(e: Pick<KeyboardEvent, "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): Binding {
  const isModifierKey = /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(e.code);
  const mods: string[] = [];
  // A bare modifier key (e.g. ShiftLeft for hold) is bound by its code alone.
  if (!isModifierKey) {
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.shiftKey) mods.push("Shift");
    if (e.altKey) mods.push("Alt");
    if (e.metaKey) mods.push("Meta");
  }
  return [...mods, e.code].join("+");
}

type KeyEventLike = Pick<KeyboardEvent, "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;

function modsOf(e: KeyEventLike): Set<Modifier> {
  const s = new Set<Modifier>();
  if (e.ctrlKey) s.add("Ctrl");
  if (e.shiftKey) s.add("Shift");
  if (e.altKey) s.add("Alt");
  if (e.metaKey) s.add("Meta");
  return s;
}

/**
 * Resolve a key event to an action.
 *
 * - A binding with modifiers matches only when exactly those modifiers are held,
 *   and it wins over a plain binding on the same key (Ctrl+Z = undo, not rotate).
 * - A plain binding matches regardless of held modifiers, so holding Shift (hold)
 *   doesn't stop the arrows from moving the piece.
 */
export function resolveAction(keybinds: Keybinds, e: KeyEventLike): Action | null {
  const held = modsOf(e);
  let plain: Action | null = null;
  for (const action of ALL_ACTIONS) {
    for (const b of keybinds[action]) {
      const p = parseBinding(b);
      if (p.code !== e.code) continue;
      if (p.mods.size === 0) {
        plain ??= action;
      } else if (p.mods.size === held.size && [...p.mods].every((m) => held.has(m))) {
        return action;
      }
    }
  }
  return plain;
}

/** Bindings assigned to more than one action. */
export function findConflicts(keybinds: Keybinds): Map<Binding, Action[]> {
  const seen = new Map<Binding, Action[]>();
  for (const action of ALL_ACTIONS) {
    for (const b of keybinds[action]) {
      const list = seen.get(b) ?? [];
      list.push(action);
      seen.set(b, list);
    }
  }
  return new Map([...seen].filter(([, actions]) => actions.length > 1));
}

/** Assign `binding` to `action`, removing it from any other action. */
export function rebind(keybinds: Keybinds, action: Action, binding: Binding, slot = 0): Keybinds {
  const next = Object.fromEntries(
    ALL_ACTIONS.map((a) => [a, keybinds[a].filter((b) => b !== binding)])
  ) as Keybinds;
  const list = [...next[action]];
  if (slot < list.length) list[slot] = binding;
  else list.push(binding);
  next[action] = [...new Set(list)];
  return next;
}

export function unbind(keybinds: Keybinds, action: Action, binding: Binding): Keybinds {
  return { ...keybinds, [action]: keybinds[action].filter((b) => b !== binding) };
}

// ---------------------------------------------------------------- validation / merge

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const oneOf = <T extends string>(v: unknown, opts: readonly T[], fallback: T): T =>
  opts.includes(v as T) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/**
 * Merge untrusted stored data over the defaults. Unknown fields are dropped,
 * bad values fall back to defaults, and numbers are clamped. New actions added
 * in later versions get their default binds.
 */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const h = (r.handling ?? {}) as Record<string, unknown>;
  const hint = (r.hint ?? {}) as Record<string, unknown>;
  const pr = (r.practice ?? {}) as Record<string, unknown>;
  const dr = (r.drill ?? {}) as Record<string, unknown>;
  const kb = (r.keybinds ?? {}) as Record<string, unknown>;
  const L = HANDLING_LIMITS;
  const irsOpts = ["off", "hold", "tap"] as const;

  const keybinds = {} as Keybinds;
  for (const a of ALL_ACTIONS) {
    const v = kb[a];
    keybinds[a] =
      Array.isArray(v) && v.every((b) => typeof b === "string" && b.length > 0)
        ? [...new Set(v as string[])]
        : [...d.keybinds[a]];
  }

  return {
    version: 1,
    mode: oneOf(r.mode, ["free", "drill"] as const, d.mode),
    handling: {
      das: clamp(num(h.das, d.handling.das), L.das.min, L.das.max),
      arr: clamp(num(h.arr, d.handling.arr), L.arr.min, L.arr.max),
      dcd: clamp(num(h.dcd, d.handling.dcd), L.dcd.min, L.dcd.max),
      sdf: clamp(num(h.sdf, d.handling.sdf), L.sdf.min, L.sdf.max),
      safelock: bool(h.safelock, d.handling.safelock),
      cancel: bool(h.cancel, d.handling.cancel),
      irs: oneOf(h.irs, irsOpts, d.handling.irs),
      ihs: oneOf(h.ihs, irsOpts, d.handling.ihs)
    },
    keybinds,
    hint: {
      lifetime: oneOf(hint.lifetime, ["off", "clear", "auto-refresh"] as const, d.hint.lifetime),
      showFullPlan: bool(hint.showFullPlan, d.hint.showFullPlan),
      pauseWhileShown: bool(hint.pauseWhileShown, d.hint.pauseWhileShown),
      searchIterations: Math.round(clamp(num(hint.searchIterations, d.hint.searchIterations), 100, 1_000_000)),
      topN: Math.round(clamp(num(hint.topN, d.hint.topN), 1, 5)),
      // Profiles saved before M6 (no beamWidth) only have the old default
      // strategy, which had no UI, so they move to the new default.
      strategy: "beamWidth" in hint ? oneOf(hint.strategy, ["pv-walk", "beam"] as const, d.hint.strategy) : d.hint.strategy,
      beamWidth: Math.round(clamp(num(hint.beamWidth, d.hint.beamWidth), 10, 5000))
    },
    practice: {
      seed: pr.seed === null || pr.seed === undefined ? null : Math.trunc(num(pr.seed, 0)),
      garbage: oneOf(pr.garbage, ["off", "clean", "cheese"] as const, d.practice.garbage),
      garbageAmount: Math.round(clamp(num(pr.garbageAmount, d.practice.garbageAmount), 1, 20)),
      garbageInterval: clamp(num(pr.garbageInterval, d.practice.garbageInterval), 1, 120)
    },
    drill: {
      piece: oneOf(dr.piece, ["T", "L", "J", "S", "Z", "I", "mixed"] as const, d.drill.piece),
      depth: Math.round(clamp(num(dr.depth, d.drill.depth), 1, MAX_DEPTH)),
      gravity: bool(dr.gravity, d.drill.gravity),
      autoAdvance: bool(dr.autoAdvance, d.drill.autoAdvance),
      maxGarbageRows: Math.round(clamp(num(dr.maxGarbageRows, d.drill.maxGarbageRows), 0, 4)),
      seed: dr.seed === null || dr.seed === undefined ? null : Math.max(0, Math.trunc(num(dr.seed, 0)))
    }
  };
}

// ---------------------------------------------------------------- persistence

const STORAGE_KEY = "b2b-trainer.settings.v1";

/** Load settings; falls back to defaults if storage is unavailable or corrupt. */
export function loadSettings(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Settings {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return sanitizeSettings({});
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** Small observable store so the input handler and engine pick up changes live. */
export class SettingsStore {
  #value: Settings;
  #listeners = new Set<(s: Settings) => void>();

  constructor(initial: Settings = loadSettings()) {
    this.#value = initial;
  }

  get value(): Settings {
    return this.#value;
  }

  update(fn: (s: Settings) => Settings): void {
    this.#value = sanitizeSettings(fn(structuredClone(this.#value)));
    saveSettings(this.#value);
    for (const l of this.#listeners) l(this.#value);
  }

  reset(section?: keyof Omit<Settings, "version">): void {
    this.update((s) => (section ? { ...s, [section]: structuredClone(DEFAULT_SETTINGS[section]) } : structuredClone(DEFAULT_SETTINGS)));
  }

  subscribe(fn: (s: Settings) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
}
