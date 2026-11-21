/**
 * Records bot/Triangle disagreements (unreachable moves, spin mismatches).
 * Triangle wins. These entries are the bug list for the Frostetra fork
 * (Design_Doc §11).
 */

import type { Placement, StartMsg } from "../adapter/sbp-types";
import type { RejectReason } from "./verify";

export interface MismatchEntry {
  at: string;
  reason: RejectReason | "soft-spin" | "plan-outcome";
  detail: string;
  placement: Placement;
  /** The position it happened in, as sent to the bot (enough to reproduce). */
  start?: StartMsg;
}

export class MismatchLog {
  readonly entries: MismatchEntry[] = [];
  constructor(private readonly max = 500) {}

  add(e: Omit<MismatchEntry, "at">): void {
    const entry = { at: new Date().toISOString(), ...e };
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.shift();
    console.warn(`[verify] ${e.reason}: ${e.detail}`, entry);
  }

  toJSON(): string {
    return JSON.stringify(this.entries, null, 2);
  }
}
