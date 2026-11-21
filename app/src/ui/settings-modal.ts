/**
 * Settings dialog: handling (DAS/ARR/DCD/SDF…) and keybinds.
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
  type HandlingSettings,
  type SettingsStore
} from "./settings";

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
  #tab: "handling" | "controls" = "handling";
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
    for (const [id, label] of [["handling", "Handling"], ["controls", "Controls"]] as const) {
      const b = el("button", { type: "button", textContent: label, dataset: { tab: id } });
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

  open(tab?: "handling" | "controls"): void {
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
    this.#body.replaceChildren(this.#tab === "handling" ? this.#renderHandling() : this.#renderControls());
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
