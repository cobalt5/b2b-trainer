import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  bindingFromEvent,
  findConflicts,
  loadSettings,
  msToFrames,
  framesToMs,
  rebind,
  resolveAction,
  sanitizeSettings,
  saveSettings,
  SettingsStore,
  toEngineHandling
} from "../src/ui/settings";

const ev = (code: string, mods: Partial<Record<"ctrlKey" | "shiftKey" | "altKey" | "metaKey", boolean>> = {}) => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods
});

const memStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("defaults", () => {
  it("have no conflicting binds", () => {
    expect(findConflicts(DEFAULT_SETTINGS.keybinds).size).toBe(0);
  });
  it("round-trip through sanitize unchanged", () => {
    expect(sanitizeSettings(structuredClone(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
  });
});

describe("resolveAction", () => {
  const kb = DEFAULT_SETTINGS.keybinds;
  it("maps plain keys", () => {
    expect(resolveAction(kb, ev("ArrowLeft"))).toBe("moveLeft");
    expect(resolveAction(kb, ev("Tab"))).toBe("hint");
  });
  it("plain binds still fire with unrelated modifiers held", () => {
    expect(resolveAction(kb, ev("ArrowLeft", { shiftKey: true }))).toBe("moveLeft");
  });
  it("modified binds beat plain binds on the same key", () => {
    expect(resolveAction(kb, ev("KeyZ"))).toBe("rotateCCW");
    expect(resolveAction(kb, ev("KeyZ", { ctrlKey: true }))).toBe("undo");
    expect(resolveAction(kb, ev("KeyZ", { ctrlKey: true, shiftKey: true }))).toBe("redo");
  });
  it("returns null for unbound keys", () => {
    expect(resolveAction(kb, ev("KeyQ"))).toBeNull();
  });
});

describe("rebind", () => {
  it("moves a key from its old action to the new one", () => {
    const kb = rebind(DEFAULT_SETTINGS.keybinds, "hint", "KeyZ");
    expect(kb.hint).toContain("KeyZ");
    expect(kb.rotateCCW).not.toContain("KeyZ");
    expect(findConflicts(kb).size).toBe(0);
  });
  it("replaces a specific slot", () => {
    const kb = rebind(DEFAULT_SETTINGS.keybinds, "rotateCW", "KeyD", 1);
    expect(kb.rotateCW).toEqual(["KeyX", "KeyD"]);
  });
});

describe("bindingFromEvent", () => {
  it("records modifiers for normal keys", () => {
    expect(bindingFromEvent(ev("KeyZ", { ctrlKey: true }))).toBe("Ctrl+KeyZ");
  });
  it("binds a bare modifier key by code", () => {
    expect(bindingFromEvent(ev("ShiftLeft", { shiftKey: true }))).toBe("ShiftLeft");
  });
});

describe("sanitize", () => {
  it("clamps handling and fills missing fields", () => {
    const s = sanitizeSettings({ handling: { das: -5, arr: 99, sdf: "fast" }, keybinds: { hint: ["KeyH"] } });
    expect(s.handling.das).toBe(0);
    expect(s.handling.arr).toBe(5);
    expect(s.handling.sdf).toBe(DEFAULT_SETTINGS.handling.sdf);
    expect(s.keybinds.hint).toEqual(["KeyH"]);
    expect(s.keybinds.moveLeft).toEqual(DEFAULT_SETTINGS.keybinds.moveLeft);
  });
  it("survives garbage input", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings("nope")).toEqual(DEFAULT_SETTINGS);
  });
});

describe("persistence", () => {
  it("saves and loads", () => {
    const st = memStorage();
    const s = sanitizeSettings({ handling: { das: 7 } });
    saveSettings(s, st);
    expect(loadSettings(st).handling.das).toBe(7);
  });
  it("falls back to defaults on corrupt JSON or missing storage", () => {
    expect(loadSettings({ getItem: () => "{bad" })).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
  it("store notifies subscribers with sanitized values", () => {
    const store = new SettingsStore(structuredClone(DEFAULT_SETTINGS));
    let seen = -1;
    store.subscribe((s) => (seen = s.handling.arr));
    store.update((s) => ({ ...s, handling: { ...s.handling, arr: 100 } }));
    expect(seen).toBe(5);
  });
});

describe("conversion", () => {
  it("frames <-> ms", () => {
    expect(framesToMs(10)).toBe(167);
    expect(msToFrames(167)).toBe(10);
    expect(toEngineHandling(DEFAULT_SETTINGS.handling)).toMatchObject({ das: 10, arr: 2, sdf: 6, may20g: true });
  });
});

describe("hint strategy migration (M6)", () => {
  it("defaults to the beam planner", () => {
    expect(DEFAULT_SETTINGS.hint.strategy).toBe("beam");
    expect(DEFAULT_SETTINGS.hint.beamWidth).toBe(300);
  });

  it("moves pre-M6 profiles (no beamWidth) off the old pv-walk default", () => {
    const old = { ...DEFAULT_SETTINGS, hint: { ...DEFAULT_SETTINGS.hint, strategy: "pv-walk" } } as Record<string, any>;
    delete old.hint.beamWidth;
    expect(sanitizeSettings(old).hint.strategy).toBe("beam");
  });

  it("keeps an explicit pv-walk choice and clamps the beam width", () => {
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, hint: { ...DEFAULT_SETTINGS.hint, strategy: "pv-walk", beamWidth: 1e9 } });
    expect(s.hint.strategy).toBe("pv-walk");
    expect(s.hint.beamWidth).toBe(5000);
  });
});

describe("drill settings (M8)", () => {
  it("profiles saved before drills get drill defaults and free play", () => {
    const { mode: _m, drill: _d, ...old } = structuredClone(DEFAULT_SETTINGS);
    const s = sanitizeSettings(old);
    expect(s.mode).toBe("free");
    expect(s.drill).toEqual(DEFAULT_SETTINGS.drill);
    expect(s.keybinds.nextDrill).toEqual(["KeyN"]);
  });
  it("clamps and validates drill values", () => {
    const s = sanitizeSettings({ mode: "drill", drill: { piece: "O", depth: 12, gravity: "yes", maxGarbageRows: -3, seed: 7.9 } });
    expect(s.mode).toBe("drill");
    expect(s.drill).toEqual({ ...DEFAULT_SETTINGS.drill, depth: 7, maxGarbageRows: 0, seed: 7 });
    expect(sanitizeSettings({ drill: { piece: "mixed", depth: 0 } }).drill).toMatchObject({ piece: "mixed", depth: 1 });
  });
});
