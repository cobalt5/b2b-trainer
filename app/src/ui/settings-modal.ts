/**
 * Settings dialog: handling (DAS/ARR/DCD/SDF…), keybinds, hints and practice.
 * Every change is applied live through the SettingsStore.
 */

import {
  ACTION_LABELS,
  APP_ACTIONS,
  GAME_ACTIONS,
  HANDLING_LIMITS,
  SDF_INSTANT,
  bindingFromEvent,
  formatBinding,
  framesToMs,
  rebind,
  unbind,
  type Action,
  type DrillChoice,
  type DrillSettings,
  type GarbageMode,
  type HandlingSettings,
  type HintLifetime,
  type HintSettings,
  type PlanStrategy,
  type PracticeSettings,
  type SettingsStore
} from "./settings";

export type SettingsTab = "handling" | "controls" | "hints" | "practice" | "drills";
export const SETTINGS_TABS: readonly SettingsTab[] = ["handling", "controls", "hints", "practice", "drills"];
const TAB_LABELS: Record<SettingsTab, string> = { handling: "Handling", controls: "Controls", hints: "Hints", practice: "Practice", drills: "Drills" };

export const DRILL_CHOICE_LABELS: readonly (readonly [DrillChoice, string])[] = [
  ["T", "T-spins"],
  ["L", "L-spins"],
  ["J", "J-spins"],
  ["S", "S-spins"],
  ["Z", "Z-spins"],
  ["I", "I-spins"],
  ["mixed", "Mixed"]
];

/** Depth labels: 1 = only the spin piece; 7 = every known piece, hold included. */
export function depthLabel(d: number): string {
  if (d === 1) return "1 · spin only";
  if (d === 7) return "7 · uses hold";
  return `${d} · ${d - 1} setup piece${d > 2 ? "s" : ""}`;
}

/** One labelled row of the hints / practice forms. */
function formRow(label: string, hint: string, control: HTMLElement, id: string): HTMLElement[] {
  control.id = id;
  return [el("label", { htmlFor: id, class: "h-label" }, label, el("small", { textContent: hint })), control];
}

function selectOf<T extends string>(options: readonly (readonly [T, string])[], value: T, onChange: (v: T) => void): HTMLSelectElement {
  const s = el("select");
  for (const [v, label] of options) s.append(el("option", { value: v, textContent: label, selected: v === value }));
  s.addEventListener("change", () => onChange(s.value as T));
  return s;
}

function checkboxOf(value: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const c = el("input", { type: "checkbox", checked: value });
  c.addEventListener("change", () => onChange(c.checked));
  return c;
}

/** Number input that writes on change and shows the value the store kept (after clamping). */
function numberOf(value: number, lim: { min: number; max: number; step: number }, onChange: (v: number) => number): HTMLInputElement {
  const n = el("input", { type: "number", min: String(lim.min), max: String(lim.max), step: String(lim.step), value: String(value), class: "num" });
  n.addEventListener("change", () => {
    const v = Number(n.value);
    if (n.value.trim() === "" || !Number.isFinite(v)) {
      n.value = String(value);
      return;
    }
    value = onChange(v);
    n.value = String(value);
  });
  return n;
}

const SLOTS = 2;

type NumKey = "das" | "arr" | "dcd" | "sdf";

const HANDLING_ROWS: { key: NumKey; label: string; hint: string }[] = [
  { key: "das", label: "DAS", hint: "Delay before a held move starts repeating" },
  { key: "arr", label: "ARR", hint: "Time between repeated moves (0 = instant)" },
  { key: "dcd", label: "DCD", hint: "DAS cut delay after rotating or spawning" },
  { key: "sdf", label: "SDF", hint: "Soft drop speed multiplier" }
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; dataset?: Record<string, string> } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { class: cls, dataset, ...rest } = props;
  if (cls) e.className = cls;
  if (dataset) Object.assign(e.dataset, dataset);
  Object.assign(e, rest);
  e.append(...children);
  return e;
}

export class SettingsModal {
  readonly dialog: HTMLDialogElement;
  #body: HTMLElement;
  #tab: SettingsTab = "handling";
  #capture: { action: Action; slot: number; button: HTMLButtonElement } | null = null;

  constructor(
    private store: SettingsStore,
    private hooks: { onOpen: () => void; onClose: () => void }
  ) {
    this.dialog = el("dialog", { class: "settings" });
    // Focus the dialog itself on open, not its first tab button.
    this.dialog.tabIndex = -1;
    this.#body = el("div", { class: "settings-body" });

    const tabs = el("nav", { class: "tabs" });
    for (const id of SETTINGS_TABS) {
      const b = el("button", { type: "button", textContent: TAB_LABELS[id], dataset: { tab: id } });
      b.addEventListener("click", () => {
        this.#tab = id;
        this.render();
      });
      tabs.append(b);
    }

    const close = el("button", { type: "button", class: "icon-btn", textContent: "✕", title: "Close" });
    close.setAttribute("aria-label", "Close settings");
    close.addEventListener("click", () => this.close());

    const header = el("header", {}, el("h2", { textContent: "Settings" }), tabs, close);
    this.dialog.append(header, this.#body);

    // Capture-phase key listener for "press a key to bind".
    this.dialog.addEventListener("keydown", (e) => this.#onCaptureKey(e), true);
    // Esc closes a native <dialog>. Don't close while capturing a key.
    this.dialog.addEventListener("cancel", (e) => {
      if (this.#capture) e.preventDefault();
    });
    this.dialog.addEventListener("close", () => {
      this.#endCapture();
      this.hooks.onClose();
    });
    // Click on backdrop closes.
    this.dialog.addEventListener("click", (e) => {
      if (e.target === this.dialog) this.close();
    });

    document.body.append(this.dialog);
  }

  get isOpen() {
    return this.dialog.open;
  }

  open(tab?: SettingsTab): void {
    if (tab) this.#tab = tab;
    this.render();
    this.hooks.onOpen();
    this.dialog.showModal();
    this.dialog.focus();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  render(): void {
    for (const b of this.dialog.querySelectorAll<HTMLButtonElement>(".tabs button")) {
      b.classList.toggle("active", b.dataset.tab === this.#tab);
    }
    const body = {
      handling: () => this.#renderHandling(),
      controls: () => this.#renderControls(),
      hints: () => this.#renderHints(),
      practice: () => this.#renderPractice(),
      drills: () => this.#renderDrills()
    };
    this.#body.replaceChildren(body[this.#tab]());
  }

  // ------------------------------------------------------------ hints

  #setHint<K extends keyof HintSettings>(key: K, v: HintSettings[K]): HintSettings[K] {
    this.store.update((s) => ({ ...s, hint: { ...s.hint, [key]: v } }));
    return this.store.value.hint[key];
  }

  #renderHints(): HTMLElement {
    const h = this.store.value.hint;
    const form = el("div", { class: "form" });
    const beam = h.strategy === "beam";

    form.append(
      ...formRow(
        "After a lock",
        "What happens to a shown hint when the next piece locks",
        selectOf<HintLifetime>(
          [
            ["clear", "Clear it"],
            ["auto-refresh", "Refresh if I followed step 1"],
            ["off", "Keep it (marked stale)"]
          ],
          h.lifetime,
          (v) => this.#setHint("lifetime", v)
        ),
        "set-lifetime"
      ),
      ...formRow("Show full plan", "Outline every step, or only step 1", checkboxOf(h.showFullPlan, (v) => this.#setHint("showFullPlan", v)), "set-fullplan"),
      ...formRow(
        "Pause while shown",
        "Freeze the game while a hint is up. Any move key resumes",
        checkboxOf(h.pauseWhileShown, (v) => this.#setHint("pauseWhileShown", v)),
        "set-pausehint"
      ),
      ...formRow(
        "Planner",
        "Beam: B2B planner in the bot (best). Bot line: the bot's own line, cut at the next B2B clear",
        selectOf<PlanStrategy>(
          [
            ["beam", "Beam search"],
            ["pv-walk", "Bot line"]
          ],
          h.strategy,
          (v) => {
            this.#setHint("strategy", v);
            this.render(); // swap the budget row
          }
        ),
        "set-strategy"
      ),
      ...(beam
        ? formRow("Beam width", "States kept per piece. Higher is slower and finds more (10–5000)", numberOf(h.beamWidth, { min: 10, max: 5000, step: 10 }, (v) => this.#setHint("beamWidth", v)), "set-beam")
        : formRow(
            "Search iterations",
            "Bot search budget per hint. 4000 ≈ 280 ms p95 (100–1,000,000)",
            numberOf(h.searchIterations, { min: 100, max: 1_000_000, step: 500 }, (v) => this.#setHint("searchIterations", v)),
            "set-iters"
          )),
      ...formRow("Plans to cycle", "How many plans [ and ] cycle through (1–5)", numberOf(h.topN, { min: 1, max: 5, step: 1 }, (v) => this.#setHint("topN", v)), "set-topn")
    );

    const reset = el("button", { type: "button", class: "secondary", textContent: "Reset hints" });
    reset.addEventListener("click", () => {
      this.store.reset("hint");
      this.render();
    });
    return el("div", {}, form, el("div", { class: "row-actions" }, reset));
  }

  // ------------------------------------------------------------ practice

  #setPractice<K extends keyof PracticeSettings>(key: K, v: PracticeSettings[K]): PracticeSettings[K] {
    this.store.update((s) => ({ ...s, practice: { ...s.practice, [key]: v } }));
    return this.store.value.practice[key];
  }

  #renderPractice(): HTMLElement {
    const p = this.store.value.practice;
    const form = el("div", { class: "form" });

    const seed = el("input", { type: "number", step: "1", min: "0", placeholder: "random", value: p.seed === null ? "" : String(p.seed), class: "num" });
    seed.addEventListener("change", () => {
      const raw = seed.value.trim();
      const v = raw === "" ? null : Number(raw);
      const kept = this.#setPractice("seed", v === null || !Number.isFinite(v) ? null : Math.max(0, Math.trunc(v)));
      seed.value = kept === null ? "" : String(kept);
    });

    const garbageOff = p.garbage === "off";
    form.append(
      ...formRow("Seed", "Piece order for every restart. Empty = a new random seed each time. Applies on restart", seed, "set-seed"),
      ...formRow(
        "Garbage",
        "Clean: one hole column per garbage event. Cheese: a different hole on every line",
        selectOf<GarbageMode>(
          [
            ["off", "Off"],
            ["clean", "Clean"],
            ["cheese", "Cheese"]
          ],
          p.garbage,
          (v) => {
            this.#setPractice("garbage", v);
            this.render();
          }
        ),
        "set-garbage"
      )
    );
    if (!garbageOff) {
      form.append(
        ...formRow("Lines per event", "Garbage lines sent each time (1–20). At most 8 rise per lock", numberOf(p.garbageAmount, { min: 1, max: 20, step: 1 }, (v) => this.#setPractice("garbageAmount", v)), "set-gamount"),
        ...formRow("Every (seconds)", "Seconds of play between garbage events (1–120)", numberOf(p.garbageInterval, { min: 1, max: 120, step: 1 }, (v) => this.#setPractice("garbageInterval", v)), "set-ginterval")
      );
    }

    const note = el("p", {
      class: "muted small",
      textContent: "Garbage waits a moment, can be cancelled by your own attack, and rises at the next lock that clears no lines, as in TETR.IO. Hints plan as if no more garbage arrives."
    });
    const reset = el("button", { type: "button", class: "secondary", textContent: "Reset practice" });
    reset.addEventListener("click", () => {
      this.store.reset("practice");
      this.render();
    });
    return el("div", {}, form, garbageOff ? "" : note, el("div", { class: "row-actions" }, reset));
  }

  // ------------------------------------------------------------ drills

  #setDrill<K extends keyof DrillSettings>(key: K, v: DrillSettings[K]): DrillSettings[K] {
    this.store.update((s) => ({ ...s, drill: { ...s.drill, [key]: v } }));
    return this.store.value.drill[key];
  }

  #renderDrills(): HTMLElement {
    const d = this.store.value.drill;
    const form = el("div", { class: "form" });

    const seed = el("input", { type: "number", step: "1", min: "0", placeholder: "random", value: d.seed === null ? "" : String(d.seed), class: "num" });
    seed.addEventListener("change", () => {
      const raw = seed.value.trim();
      const v = raw === "" ? null : Number(raw);
      const kept = this.#setDrill("seed", v === null || !Number.isFinite(v) ? null : Math.max(0, Math.trunc(v)));
      seed.value = kept === null ? "" : String(kept);
    });

    const depths = Array.from({ length: 7 }, (_, i) => [String(i + 1), depthLabel(i + 1)] as const);
    form.append(
      ...formRow("Spin", "Which piece the drills end with a spin of", selectOf<DrillChoice>(DRILL_CHOICE_LABELS, d.piece, (v) => this.#setDrill("piece", v)), "set-drill-piece"),
      ...formRow(
        "Pieces to place",
        "1 = the slot is ready. More = build the setup first with the pieces in your queue. 7 also uses the hold piece",
        selectOf(depths, String(d.depth), (v) => this.#setDrill("depth", Number(v))),
        "set-drill-depth"
      ),
      ...formRow("Gravity", "Off: pieces only fall when you soft drop, and lock on hard drop", checkboxOf(d.gravity, (v) => this.#setDrill("gravity", v)), "set-drill-gravity"),
      ...formRow("Auto-advance", "Load the next drill shortly after a pass", checkboxOf(d.autoAdvance, (v) => this.#setDrill("autoAdvance", v)), "set-drill-auto"),
      ...formRow("Garbage rows", "Up to this many garbage rows under the stack (0–4)", numberOf(d.maxGarbageRows, { min: 0, max: 4, step: 1 }, (v) => this.#setDrill("maxGarbageRows", v)), "set-drill-garbage"),
      ...formRow("Seed", "Fixed drill sequence. Empty = random drills", seed, "set-drill-seed")
    );

    const note = el("p", {
      class: "muted small",
      textContent: "Any line-clearing spin of the chosen piece passes. The hint key shows the generated solution; a better spin you missed is pointed out after the drill."
    });
    const reset = el("button", { type: "button", class: "secondary", textContent: "Reset drills" });
    reset.addEventListener("click", () => {
      this.store.reset("drill");
      this.render();
    });
    return el("div", {}, form, note, el("div", { class: "row-actions" }, reset));
  }

  // ------------------------------------------------------------ handling

  #renderHandling(): HTMLElement {
    const h = this.store.value.handling;
    const wrap = el("div", { class: "handling" });

    for (const row of HANDLING_ROWS) {
      const lim = HANDLING_LIMITS[row.key];
      const range = el("input", { type: "range", min: String(lim.min), max: String(lim.max), step: String(lim.step), value: String(h[row.key]) });
      const num = el("input", { type: "number", min: String(lim.min), max: String(lim.max), step: String(lim.step), value: String(h[row.key]), class: "num" });
      const readout = el("span", { class: "readout" });
      const id = `set-${row.key}`;
      range.id = id;

      const show = (v: number) => {
        if (row.key === "sdf") readout.textContent = v >= SDF_INSTANT ? "instant" : `${v}×`;
        else readout.textContent = `${v}F · ${framesToMs(v)} ms`;
      };
      const set = (raw: string, from: HTMLInputElement) => {
        const v = Number(raw);
        if (!Number.isFinite(v)) return;
        this.store.update((s) => ({ ...s, handling: { ...s.handling, [row.key]: v } }));
        const applied = this.store.value.handling[row.key];
        if (from !== range) range.value = String(applied);
        if (from !== num) num.value = String(applied);
        show(applied);
      };
      range.addEventListener("input", () => set(range.value, range));
      num.addEventListener("change", () => set(num.value, num));
      show(h[row.key]);

      wrap.append(
        el("label", { htmlFor: id, class: "h-label", title: row.hint }, row.label, el("small", { textContent: row.hint })),
        range,
        num,
        readout
      );
    }

    const toggles = el("div", { class: "toggles" });
    const check = (key: "safelock" | "cancel", label: string, hint: string) => {
      const input = el("input", { type: "checkbox", checked: h[key] });
      input.addEventListener("change", () =>
        this.store.update((s) => ({ ...s, handling: { ...s.handling, [key]: input.checked } }))
      );
      return el("label", { class: "check", title: hint }, input, ` ${label}`);
    };
    const select = (key: "irs" | "ihs", label: string) => {
      const s = el("select");
      for (const o of ["off", "hold", "tap"] as HandlingSettings["irs"][]) s.append(el("option", { value: o, textContent: o, selected: h[key] === o }));
      s.addEventListener("change", () =>
        this.store.update((st) => ({ ...st, handling: { ...st.handling, [key]: s.value as HandlingSettings["irs"] } }))
      );
      return el("label", { class: "select" }, `${label} `, s);
    };
    toggles.append(
      check("cancel", "Cancel DAS on direction change", "Releasing one direction resets the other's DAS"),
      check("safelock", "Safe lock", "Ignore hard drop for a moment after a piece spawns"),
      select("irs", "Initial rotation"),
      select("ihs", "Initial hold")
    );

    const reset = el("button", { type: "button", class: "secondary", textContent: "Reset handling" });
    reset.addEventListener("click", () => {
      this.store.reset("handling");
      this.render();
    });

    return el("div", {}, wrap, toggles, el("div", { class: "row-actions" }, reset));
  }

  // ------------------------------------------------------------ controls

  #renderControls(): HTMLElement {
    const kb = this.store.value.keybinds;
    const table = el("table", { class: "binds" });

    const section = (title: string, actions: readonly Action[]) => {
      table.append(el("tr", {}, el("th", { colSpan: SLOTS + 1, textContent: title })));
      for (const a of actions) {
        const tr = el("tr", {}, el("td", { textContent: ACTION_LABELS[a] }));
        for (let slot = 0; slot < SLOTS; slot++) {
          const b = kb[a][slot];
          const btn = el("button", { type: "button", class: "bind" + (b ? "" : " empty"), textContent: b ? formatBinding(b) : "—" });
          btn.title = "Click, then press a key. Esc cancels, Backspace clears.";
          btn.addEventListener("click", () => this.#beginCapture(a, slot, btn));
          tr.append(el("td", {}, btn));
        }
        table.append(tr);
      }
    };
    section("Gameplay", GAME_ACTIONS);
    section("Trainer", APP_ACTIONS);

    const reset = el("button", { type: "button", class: "secondary", textContent: "Reset controls" });
    reset.addEventListener("click", () => {
      this.store.reset("keybinds");
      this.render();
    });
    const note = el("p", {
      class: "muted small",
      textContent: "Click a slot, then press a key or combo. A key bound elsewhere moves to the new action. Esc cancels, Backspace clears the slot."
    });
    return el("div", {}, note, table, el("div", { class: "row-actions" }, reset));
  }

  #beginCapture(action: Action, slot: number, button: HTMLButtonElement): void {
    this.#endCapture();
    this.#capture = { action, slot, button };
    button.classList.add("capturing");
    button.textContent = "Press a key…";
  }

  #endCapture(): void {
    if (!this.#capture) return;
    this.#capture.button.classList.remove("capturing");
    this.#capture = null;
  }

  #onCaptureKey(e: KeyboardEvent): void {
    const cap = this.#capture;
    if (!cap) return;
    // Wait for the non-modifier key of a combo, unless a modifier is released alone (handled on keyup).
    if (/^(Control|Alt|Meta)(Left|Right)$/.test(e.code)) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.code === "Escape") {
      this.#endCapture();
      this.render();
      return;
    }
    const kb = this.store.value.keybinds;
    const current = kb[cap.action][cap.slot];
    let next = kb;
    if (e.code === "Backspace" || e.code === "Delete") {
      if (current) next = unbind(kb, cap.action, current);
    } else {
      // rebind() replaces this slot and removes the key from any other action.
      next = rebind(kb, cap.action, bindingFromEvent(e), cap.slot);
    }
    this.store.update((s) => ({ ...s, keybinds: next }));
    this.#endCapture();
    this.render();
  }
}
