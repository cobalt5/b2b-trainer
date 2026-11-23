/**
 * TETRA LEAGUE-like engine configuration (see docs/notes.md §1).
 * Field names and defaults confirmed against Triangle @ aa0698ab.
 */

import type { EngineInitializeParams } from "@haelp/teto/engine";
import type { Game } from "@haelp/teto/types";

export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20; // visible rows
export const BOARD_BUFFER = 20; // hidden rows above; fullHeight = 40
export const PREVIEWS = 5;

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export type GarbageMode = "off" | "clean" | "cheese";

/**
 * Garbage hole placement (Triangle's GarbageQueue messiness):
 * - clean: every line of a garbage event shares one hole column, and the
 *   column changes between events;
 * - cheese: every line gets its own hole column, never the same as the line below.
 */
export function garbageMessiness(mode: GarbageMode): EngineInitializeParams["garbage"]["messiness"] {
  return mode === "cheese"
    ? { change: 1, within: 1, nosame: true, timeout: 0, center: false }
    : { change: 1, within: 0, nosame: true, timeout: 0, center: false };
}

/** Lock delay with gravity off: an hour of frames, i.e. never in practice. */
const NO_GRAVITY_LOCK_FRAMES = 60 * 60 * 60;

export interface EngineParamOptions {
  /**
   * false = no gravity (spin drills): the piece only falls on soft drop and
   * only locks on hard drop (lock delay is effectively off and lock resets
   * are unlimited, so holding soft drop or fiddling with a spin never locks).
   */
  gravity?: boolean;
}

export function buildEngineParams(seed: number, handling: Game.Handling, garbage: GarbageMode = "off", opts: EngineParamOptions = {}): EngineInitializeParams {
  const gravity = opts.gravity ?? true;
  return {
    board: { width: BOARD_WIDTH, height: BOARD_HEIGHT, buffer: BOARD_BUFFER },
    kickTable: "SRS+",
    options: {
      spinBonuses: "all-mini+",
      comboTable: "multiplier",
      garbageTargetBonus: "none",
      clutch: true,
      garbageBlocking: "combo blocking",
      stock: 0
    },
    queue: { seed, type: "7-bag", minLength: 10 },
    garbage: {
      cap: { value: 8, marginTime: 0, increase: 0, absolute: 0, max: 40 },
      messiness: garbageMessiness(garbage),
      garbage: { speed: 20, holeSize: 1 },
      multiplier: { value: 1, increase: 0.008, marginTime: 10800 },
      bombs: false,
      seed,
      boardWidth: BOARD_WIDTH,
      rounding: "down",
      openerPhase: 0,
      specialBonus: false
    },
    gravity: { value: gravity ? 0.02 : 0, increase: 0, marginTime: 0 },
    handling,
    // Surge: B2B charges from 4 and releases on break (TETR.IO defaults).
    b2b: { chaining: false, charging: { at: 4, base: 3 } },
    pc: { garbage: 10, b2b: 1 },
    misc: {
      movement: { infinite: !gravity, lockResets: 15, lockTime: gravity ? 30 : NO_GRAVITY_LOCK_FRAMES, may20G: true },
      allowed: { spin180: true, hardDrop: true, hold: true, undo: true, retry: true },
      infiniteHold: false,
      stride: false
    }
  };
}
