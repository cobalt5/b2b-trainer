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

export function buildEngineParams(seed: number, handling: Game.Handling): EngineInitializeParams {
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
      messiness: { change: 1, within: 0, nosame: false, timeout: 0, center: false },
      garbage: { speed: 20, holeSize: 1 },
      multiplier: { value: 1, increase: 0.008, marginTime: 10800 },
      bombs: false,
      seed,
      boardWidth: BOARD_WIDTH,
      rounding: "down",
      openerPhase: 0,
      specialBonus: false
    },
    gravity: { value: 0.02, increase: 0, marginTime: 0 },
    handling,
    // Surge: B2B charges from 4 and releases on break (TETR.IO defaults).
    b2b: { chaining: false, charging: { at: 4, base: 3 } },
    pc: { garbage: 10, b2b: 1 },
    misc: {
      movement: { infinite: false, lockResets: 15, lockTime: 30, may20G: true },
      allowed: { spin180: true, hardDrop: true, hold: true, undo: true, retry: true },
      infiniteHold: false,
      stride: false
    }
  };
}
