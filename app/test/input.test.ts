import { describe, expect, it } from "vitest";

import { InputHandler, type KeyEvent } from "../src/game-core/input";
import { DEFAULT_SETTINGS, type AppAction } from "../src/ui/settings";

const kev = (code: string, extra: Partial<KeyboardEvent> = {}) =>
  ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false, timeStamp: 0, preventDefault() {}, ...extra }) as any;

function setup() {
  const keys: KeyEvent[] = [];
  const apps: AppAction[] = [];
  let t = 0;
  const h = new InputHandler(() => DEFAULT_SETTINGS.keybinds, (e) => keys.push(e), (a) => apps.push(a), () => ++t);
  return { h, keys, apps };
}

describe("InputHandler", () => {
  it("emits keydown/keyup for game actions", () => {
    const { h, keys } = setup();
    h.keydown(kev("ArrowLeft"));
    h.keyup(kev("ArrowLeft"));
    expect(keys.map((k) => [k.key, k.down])).toEqual([["moveLeft", true], ["moveLeft", false]]);
  });

  it("ignores OS key repeat", () => {
    const { h, keys } = setup();
    h.keydown(kev("ArrowLeft"));
    h.keydown(kev("ArrowLeft", { repeat: true }));
    expect(keys).toHaveLength(1);
  });

  it("two keys on one action: down once, up after both release", () => {
    const { h, keys } = setup();
    h.keydown(kev("KeyX"));
    h.keydown(kev("ArrowUp"));
    h.keyup(kev("KeyX"));
    expect(keys.map((k) => k.down)).toEqual([true]);
    h.keyup(kev("ArrowUp"));
    expect(keys.map((k) => k.down)).toEqual([true, false]);
  });

  it("routes app actions and respects modifiers", () => {
    const { h, keys, apps } = setup();
    h.keydown(kev("Tab"));
    h.keydown(kev("KeyZ", { ctrlKey: true }));
    expect(apps).toEqual(["hint", "undo"]);
    expect(keys).toHaveLength(0);
  });

  it("releaseAll sends keyups and disabled ignores input", () => {
    const { h, keys } = setup();
    h.keydown(kev("ArrowDown"));
    h.releaseAll();
    expect(keys.map((k) => [k.key, k.down])).toEqual([["softDrop", true], ["softDrop", false]]);
    h.enabled = false;
    h.keydown(kev("ArrowDown"));
    expect(keys).toHaveLength(2);
  });

  it("prevents default on bound keys only", () => {
    const { h } = setup();
    let prevented = 0;
    h.keydown(kev("Space", { preventDefault: () => prevented++ }));
    h.keydown(kev("KeyQ", { preventDefault: () => prevented++ }));
    expect(prevented).toBe(1);
  });
});
