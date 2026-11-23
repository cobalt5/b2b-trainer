/**
 * Drill bar (spin drills mode): which spin, how many pieces to place, the
 * drill's progress, and retry / next buttons.
 */

import { DRILL_CHOICES, MAX_DEPTH, type DrillChoice } from "../drill/scenario";
import { depthLabel } from "./settings-modal";

export interface DrillBarHooks {
  onPiece(p: DrillChoice): void;
  onDepth(d: number): void;
  onRetry(): void;
  onNext(): void;
}

const CHOICE_TEXT: Record<DrillChoice, string> = { T: "T", L: "L", J: "J", S: "S", Z: "Z", I: "I", mixed: "Mixed" };

export class DrillBar {
  #pieces = new Map<DrillChoice, HTMLButtonElement>();
  #depth: HTMLSelectElement;
  #info: HTMLElement;
  #last = "";

  constructor(
    readonly root: HTMLElement,
    hooks: DrillBarHooks
  ) {
    root.replaceChildren();
    const blur = (fn: () => void) => (e: Event) => {
      (e.currentTarget as HTMLElement).blur(); // keep Space from re-clicking
      fn();
    };

    const group = document.createElement("div");
    group.className = "seg";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Spin piece");
    for (const c of DRILL_CHOICES) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = CHOICE_TEXT[c];
      b.dataset.piece = c;
      if (c !== "mixed") b.classList.add(`mino-${c.toLowerCase()}`);
      b.addEventListener("click", blur(() => hooks.onPiece(c)));
      this.#pieces.set(c, b);
      group.append(b);
    }

    const depthWrap = document.createElement("label");
    depthWrap.className = "depth";
    depthWrap.textContent = "Pieces ";
    this.#depth = document.createElement("select");
    for (let d = 1; d <= MAX_DEPTH; d++) {
      const o = document.createElement("option");
      o.value = String(d);
      o.textContent = depthLabel(d);
      this.#depth.append(o);
    }
    this.#depth.addEventListener("change", () => {
      hooks.onDepth(Number(this.#depth.value));
      this.#depth.blur();
    });
    depthWrap.append(this.#depth);

    this.#info = document.createElement("span");
    this.#info.className = "drill-info";
    this.#info.setAttribute("aria-live", "polite");

    const spacer = document.createElement("div");
    spacer.className = "spacer";

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "secondary";
    retry.textContent = "Retry";
    retry.addEventListener("click", blur(hooks.onRetry));
    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "Next drill";
    next.addEventListener("click", blur(hooks.onNext));

    root.append(group, depthWrap, this.#info, spacer, retry, next);
  }

  set(piece: DrillChoice, depth: number, info: string): void {
    const key = `${piece}|${depth}|${info}`;
    if (key === this.#last) return;
    this.#last = key;
    for (const [c, b] of this.#pieces) {
      b.classList.toggle("active", c === piece);
      b.setAttribute("aria-pressed", String(c === piece));
    }
    this.#depth.value = String(depth);
    this.#info.textContent = info;
  }
}
