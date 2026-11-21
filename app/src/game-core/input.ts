/**
 * Keyboard → engine key frames.
 *
 * DAS/ARR/SDF are not done here. We forward timestamped keydown/keyup
 * events and the engine applies `engine.handling` itself, exactly as TETR.IO
 * does (docs/notes.md §1). App actions (hint, restart, …) go to a callback.
 */

import {
  APP_ACTIONS,
  GAME_ACTIONS,
  resolveAction,
  type AppAction,
  type GameAction,
  type Keybinds
} from "../ui/settings";

export interface KeyEvent {
  key: GameAction;
  down: boolean;
  /** performance.now() timestamp. */
  t: number;
}

type DomKeyEvent = Pick<KeyboardEvent, "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey" | "repeat" | "timeStamp" | "preventDefault">;

const isGame = (a: string): a is GameAction => (GAME_ACTIONS as readonly string[]).includes(a);
const isApp = (a: string): a is AppAction => (APP_ACTIONS as readonly string[]).includes(a);

export class InputHandler {
  enabled = true;
  /** physical key code → game action it pressed (so keyup releases the right action). */
  #codeAction = new Map<string, GameAction>();
  /** action → number of physical keys holding it. */
  #held = new Map<GameAction, number>();

  constructor(
    private getKeybinds: () => Keybinds,
    private onKey: (e: KeyEvent) => void,
    private onApp: (a: AppAction) => void,
    private now: () => number = () => performance.now()
  ) {}

  attach(target: Window = window): () => void {
    const down = (e: KeyboardEvent) => this.keydown(e);
    const up = (e: KeyboardEvent) => this.keyup(e);
    const blur = () => this.releaseAll();
    target.addEventListener("keydown", down);
    target.addEventListener("keyup", up);
    target.addEventListener("blur", blur);
    return () => {
      target.removeEventListener("keydown", down);
      target.removeEventListener("keyup", up);
      target.removeEventListener("blur", blur);
    };
  }

  isHeld(a: GameAction): boolean {
    return (this.#held.get(a) ?? 0) > 0;
  }

  keydown(e: DomKeyEvent): void {
    if (!this.enabled) return;
    const action = resolveAction(this.getKeybinds(), e);
    if (!action) return;
    e.preventDefault();
    if (e.repeat) return;

    if (isApp(action)) {
      this.onApp(action);
      return;
    }
    if (!isGame(action) || this.#codeAction.has(e.code)) return;
    this.#codeAction.set(e.code, action);
    const n = this.#held.get(action) ?? 0;
    this.#held.set(action, n + 1);
    if (n === 0) this.onKey({ key: action, down: true, t: e.timeStamp || this.now() });
  }

  keyup(e: Pick<DomKeyEvent, "code"> & { timeStamp?: number }): void {
    const action = this.#codeAction.get(e.code);
    if (!action) return;
    this.#codeAction.delete(e.code);
    const n = (this.#held.get(action) ?? 1) - 1;
    if (n <= 0) {
      this.#held.delete(action);
      this.onKey({ key: action, down: false, t: e.timeStamp || this.now() });
    } else this.#held.set(action, n);
  }

  /** Release every held key (window blur, pause, opening a dialog). */
  releaseAll(): void {
    for (const code of [...this.#codeAction.keys()]) this.keyup({ code });
  }
}
