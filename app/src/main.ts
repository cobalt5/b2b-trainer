/**
 * B2B Trainer.
 * Layout: [hold | play board | next · stats]   [hold | mirror board | next]
 * The mirror is a read-only copy of the state as of the last lock (M2).
 * The hint key asks the bot (via the bridge) for plans up to the next B2B clear,
 * verifies them in Triangle, and outlines the best one on the mirror. Plans
 * come from the bot's B2B beam planner (M6) or its own line (M5); [ / ] cycle
 * through the top 3. M7: hint stats, auto-refresh after a followed step 1,
 * pause while a hint is shown, and garbage practice.
 * M8: spin drills: generated positions that end in a spin of a chosen piece,
 * with the generated solution as the hint.
 */

import { DrillController, type DrillResult } from "./drill/drill";
import { DrillFeed } from "./drill/feed";
import type { Scenario } from "./drill/scenario";
import { lockLabels, type LockInfo } from "./game-core/clear";
import { GameSession, type GarbageSettings } from "./game-core/game";
import { InputHandler } from "./game-core/input";
import { mirrorFromSnapshot, type MirrorState } from "./game-core/mirror";
import { BOARD_HEIGHT, BOARD_WIDTH, PREVIEWS } from "./game-core/rules";
import { BoardRenderer, ghostCells } from "./render/board";
import { BotClient, type ClientStatus } from "./planner/bot-client";
import { formatInputs, type HintStep } from "./planner/hint";
import { HintStats } from "./planner/hint-stats";
import { requestPlans, type PlanResult } from "./planner/plan";
import { MismatchLog } from "./verify/mismatch-log";
import { engineFrom } from "./verify/verify";
import { DrillBar } from "./ui/drill-bar";
import { pieceCellsAt } from "./render/cells";
import { OverlayRenderer } from "./render/overlay";
import { PreviewRenderer } from "./render/preview";
import { SETTINGS_TABS, SettingsModal, type SettingsTab } from "./ui/settings-modal";
import { ACTION_LABELS, SettingsStore, formatBinding, type Action, type AppAction, type Settings } from "./ui/settings";

const BUFFER_ROWS_SHOWN = 3;

// ------------------------------------------------------------ DOM

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <header class="top">
    <h1>B2B Trainer</h1>
    <div class="seg mode-switch" role="group" aria-label="Mode">
      <button type="button" id="mode-free">Free play</button>
      <button type="button" id="mode-drill">Spin drills</button>
    </div>
    <span class="seed muted" id="seed"></span>
    <div class="spacer"></div>
    <span class="bot-status" id="bot-status" role="status"></span>
    <button type="button" id="btn-restart" class="secondary">Restart</button>
    <button type="button" id="btn-settings">Settings</button>
  </header>
  <div class="drill-bar" id="drill-bar" hidden></div>
  <div class="stage">
    <section class="playfield" aria-label="Play">
      <aside class="side left">
        <div class="panel"><h3>Hold</h3><canvas id="hold"></canvas></div>
      </aside>
      <div class="board-wrap">
        <canvas id="play" aria-label="Play board"></canvas>
        <div class="clear-label" id="clear-label" aria-live="polite"></div>
        <div class="state-overlay" id="state-overlay" hidden></div>
      </div>
      <aside class="side right">
        <div class="panel"><h3>Next</h3><canvas id="queue"></canvas></div>
        <div class="panel stats"><h3>Stats</h3><dl id="stats"></dl></div>
      </aside>
    </section>
    <section class="playfield mirror" aria-label="Mirror">
      <aside class="side left">
        <div class="panel" id="m-hold-panel"><h3>Hold</h3><canvas id="m-hold"></canvas></div>
      </aside>
      <div class="board-wrap">
        <div class="board-caption muted">Mirror · as of last lock</div>
        <canvas id="mirror" aria-label="Mirror board"></canvas>
        <canvas id="plan" class="plan-overlay" aria-hidden="true"></canvas>
        <div class="mirror-note" id="mirror-note"></div>
      </div>
      <aside class="side right">
        <div class="panel"><h3>Next</h3><canvas id="m-queue"></canvas></div>
      </aside>
    </section>
  </div>
  <footer class="legend muted" id="legend"></footer>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ------------------------------------------------------------ state

const settings = new SettingsStore();
const garbageOf = (s: Settings): GarbageSettings => ({ mode: s.practice.garbage, amount: s.practice.garbageAmount, interval: s.practice.garbageInterval });
const session = new GameSession(settings.value.handling, settings.value.practice.seed ?? undefined, garbageOf(settings.value));

const geo = { width: BOARD_WIDTH, visibleRows: BOARD_HEIGHT, bufferRows: BUFFER_ROWS_SHOWN };
const play = new BoardRenderer($<HTMLCanvasElement>("play"), geo);
const mirror = new BoardRenderer($<HTMLCanvasElement>("mirror"), geo);
const hold = new PreviewRenderer($<HTMLCanvasElement>("hold"), { slots: 1, cell: 18 });
const queue = new PreviewRenderer($<HTMLCanvasElement>("queue"), { slots: PREVIEWS, cell: 18 });
const mHold = new PreviewRenderer($<HTMLCanvasElement>("m-hold"), { slots: 1, cell: 18 });
const mQueue = new PreviewRenderer($<HTMLCanvasElement>("m-queue"), { slots: PREVIEWS, cell: 18 });
const planOverlay = new OverlayRenderer($<HTMLCanvasElement>("plan"), mirror);

/** Spin drills (M8): grading, the drill generator, and loading state. */
const drill = new DrillController();
const feed = new DrillFeed();
/** A drill is being generated (the session is paused meanwhile). */
let drillLoading = false;
let drillError = "";
/** Bumped to drop an in-flight drill request. */
let drillRequest = 0;
let advanceTimer = 0;

/** Mirror state: refreshed on every lock and on restart / undo / redo. */
let mirrorState: MirrorState = mirrorFromSnapshot(session.engine.snapshot(), session.engine.initializer);
let mirrorDirty = true;
function setMirror(m: MirrorState): void {
  mirrorState = m;
  mirrorDirty = true;
}

// ------------------------------------------------------------ hints

const bot = new BotClient();
const mismatches = new MismatchLog();
// Console access to bot/Triangle disagreements: copy(__b2b.mismatches.toJSON())
(globalThis as Record<string, unknown>).__b2b = { mismatches };

const RESULT_LABEL = (info: LockInfo): string => {
  const { main, extras } = lockLabels(info);
  const parts = [main ?? (info.lines ? "" : "No clear"), ...extras.filter((x) => !x.startsWith("B2B"))].filter(Boolean);
  if (info.b2bClass) parts.push("keeps B2B");
  else if (info.breaksB2B) parts.push("breaks B2B");
  return parts.join(" · ");
};
/** Latest plans for the mirror position, and which one is shown. */
let planResult: PlanResult | null = null;
let planIndex = 0;
/** Text under the mirror: thinking / errors / what the plan shows. */
let hintNote = "";
let hintBusy = false;
/** Bumped to drop an in-flight hint request (hidden by a second press). */
let hintRequest = 0;
const hintStats = new HintStats();
/** The session was paused by "pause while shown" (not by the user). */
let hintPaused = false;

function pauseForHint(): void {
  if (!settings.value.hint.pauseWhileShown || session.paused || session.over) return;
  input.releaseAll();
  session.setPaused(true);
  hintPaused = true;
  mirrorDirty = true;
}

function resumeFromHint(): void {
  if (!hintPaused) return;
  hintPaused = false;
  session.setPaused(false);
  mirrorDirty = true;
}

function setPlans(r: PlanResult | null, note = ""): void {
  planResult = r;
  planIndex = 0;
  hintNote = note;
  mirrorDirty = true;
}

/** The steps to outline right now, and whether the last one is the B2B finish. */
function shownSteps(): { steps: HintStep[]; hasFinal: boolean } {
  if (!planResult) return { steps: [], hasFinal: false };
  const plan = planResult.plans[planIndex];
  if (plan) {
    const steps = settings.value.hint.showFullPlan ? plan.steps : plan.steps.slice(0, 1);
    return { steps, hasFinal: steps.length === plan.steps.length };
  }
  return { steps: planResult.fallback ? [planResult.fallback] : [], hasFinal: false };
}

function describePlans(r: PlanResult): string {
  const ms = Math.round(r.botMs + r.verifyMs);
  const plan = r.plans[planIndex];
  if (plan) {
    const n = plan.steps.length;
    const kb = settings.value.keybinds;
    const keys = [kb.prevPlan[0], kb.nextPlan[0]].filter(Boolean).map((b) => formatBinding(b!)).join(" ");
    const head = `${r.plans.length > 1 ? `Plan ${planIndex + 1}/${r.plans.length} · ` : ""}${n} piece${n > 1 ? "s" : ""} → ${RESULT_LABEL(plan.final)}`;
    const tail = `Step 1: ${formatInputs(plan.steps[0]!.inputs)} · ${ms} ms${r.plans.length > 1 && keys ? ` · ${keys} cycles plans` : ""}`;
    return `${head}\n${tail}`;
  }
  if (r.fallback) return `No B2B clear in visible queue\nBest move: ${RESULT_LABEL(r.fallback.info)} · ${formatInputs(r.fallback.inputs)} · ${ms} ms`;
  return r.rejected ? "Bot moves were rejected by the engine (logged)" : "Bot found no move";
}

function cyclePlan(delta: number): void {
  if (!planResult || planResult.plans.length < 2) return;
  const n = planResult.plans.length;
  planIndex = (planIndex + delta + n) % n;
  hintNote = describePlans(planResult);
  mirrorDirty = true;
}

/** The hint key toggles: a shown (or pending) hint is hidden, otherwise one is requested. */
function toggleHint(): void {
  if (inDrill()) return toggleDrillHint();
  if (planResult || hintBusy) {
    hintRequest++;
    hintBusy = false;
    resumeFromHint();
    setPlans(null);
    return;
  }
  void requestHint();
}

/** `auto`: an auto-refresh after a followed step 1 (not counted as a hint used). */
async function requestHint(auto = false): Promise<void> {
  if (hintBusy) return;
  if (!bot.ready) {
    const s = bot.status;
    setPlans(null, s.kind === "connected" ? `Bot is ${s.bot}…` : "Bot bridge offline. Run npm run dev.");
    return;
  }
  const m = mirrorState;
  const id = ++hintRequest;
  hintBusy = true;
  if (!auto) hintStats.hintUsed();
  pauseForHint();
  setPlans(null, "Thinking…");
  try {
    const h = settings.value.hint;
    const r = await requestPlans(bot, m, {
      previews: PREVIEWS,
      topN: h.topN,
      strategy: h.strategy,
      beamWidth: h.beamWidth,
      iterations: h.searchIterations,
      log: mismatches
    });
    if (mirrorState.version !== m.version || id !== hintRequest) return; // a piece locked or the hint was hidden meanwhile
    setPlans(r);
    hintNote = describePlans(r);
    if (m.incomingGarbage) hintNote += `\n${m.incomingGarbage} garbage incoming · the plan ignores it`;
    if (!r.plans.length && !r.fallback) resumeFromHint();
  } catch (e) {
    if (mirrorState.version !== m.version || id !== hintRequest) return;
    resumeFromHint();
    setPlans(null, `Hint failed: ${(e as Error).message}`);
  } finally {
    if (id === hintRequest) hintBusy = false;
  }
}

function renderBotStatus(s: ClientStatus): void {
  const el = $("bot-status");
  const [cls, text] =
    s.kind === "connected"
      ? s.bot === "ready"
        ? ["ok", s.botName ?? "Bot ready"]
        : s.bot === "failed"
          ? ["bad", "Bot failed"]
          : ["warn", `Bot ${s.bot}…`]
      : s.kind === "connecting"
        ? ["warn", "Connecting to bridge…"]
        : ["bad", "Bridge offline"];
  el.className = `bot-status ${cls}`;
  el.textContent = text;
  el.title = s.kind === "offline" ? "Start it with npm run dev (runs the bridge and the app)" : bot.url;
}
bot.onStatus(renderBotStatus);
renderBotStatus(bot.status);
bot.connect();

// ------------------------------------------------------------ input

const input = new InputHandler(
  () => settings.value.keybinds,
  (e) => {
    // Pause while shown: the first game key resumes play and still counts.
    if (e.down && hintPaused && !modal.isOpen) resumeFromHint();
    session.keyEvent(e);
  },
  (a) => onAppAction(a)
);
input.attach();

let pausedBeforeModal = false;
const modal = new SettingsModal(settings, {
  onOpen: () => {
    input.releaseAll();
    input.enabled = false;
    pausedBeforeModal = session.paused;
    session.setPaused(true);
  },
  onClose: () => {
    input.enabled = true;
    // A finished or loading drill stays paused whatever changed meanwhile.
    session.setPaused(pausedBeforeModal || (inDrill() && (drillLoading || drill.status !== "playing")));
  }
});

function restart(): void {
  if (inDrill()) return retryDrill();
  input.releaseAll();
  hintStats.reset();
  session.restart(settings.value.practice.seed ?? undefined);
}

function onAppAction(a: AppAction): void {
  switch (a) {
    case "restart":
      return restart();
    case "undo":
      input.releaseAll();
      // Drills: undo within a running drill only; the lock count follows.
      if (inDrill() && (drillLoading || drill.status !== "playing" || !drill.undo())) return;
      session.undo();
      return;
    case "redo":
      input.releaseAll();
      if (inDrill()) return; // a redo replays a lock without a lock event; drills can't grade it
      session.redo();
      return;
    case "pause":
      input.releaseAll();
      if (inDrill() && (drillLoading || drill.status !== "playing")) return;
      if (hintPaused) return resumeFromHint();
      session.setPaused(!session.paused);
      return;
    case "openSettings":
      modal.open();
      return;
    case "hint":
      toggleHint();
      return;
    case "prevPlan":
      cyclePlan(-1);
      return;
    case "nextPlan":
      cyclePlan(1);
      return;
    case "nextDrill":
      if (inDrill()) void loadNextDrill();
      return;
    case "toggleMode":
      setMode(inDrill() ? "free" : "drill");
      return;
  }
}

const blurAfter = (fn: () => void) => (e: Event) => {
  (e.currentTarget as HTMLElement).blur(); // keep Space/Enter from re-clicking
  fn();
};
// Dev only: #drop=N places N pieces at spread-out columns on load (visual checks).
if (import.meta.env.DEV) {
  const n = Number(/drop=(\d+)/.exec(location.hash)?.[1] ?? 0);
  for (let i = 0; i < n; i++) {
    const e = session.engine;
    for (let k = 0; k < 5; k++) e.press(i % 2 ? "moveRight" : "moveLeft");
    for (let k = 0; k < (i * 3) % 5; k++) e.press(i % 2 ? "moveLeft" : "moveRight");
    if (i % 3 === 0) e.press("rotateCW");
    e.press("hardDrop");
  }
  // Hold the live piece so play hold ≠ mirror hold (the mirror only updates on lock).
  if (n) session.engine.press("hold");

  // #board=<rows top-down, "/"-separated, X = filled>&piece=t&next=ios : a set position.
  const params = new URLSearchParams(location.hash.slice(1));
  const rows = params.get("board");
  if (rows !== null) {
    const e = session.engine;
    const top = rows.split("/").reverse();
    for (let y = 0; y < e.board.state.length; y++) {
      e.board.state[y] = Array.from({ length: 10 }, (_, x) => (top[y]?.[x] === "X" ? { mino: "gb" as never, connections: 0 } : null));
    }
    const next = (params.get("next") ?? "").toLowerCase();
    for (let i = 0; i < next.length; i++) e.queue[i] = next[i] as never;
    e.initiatePiece((params.get("piece") ?? e.falling.symbol) as never);
    setMirror(mirrorFromSnapshot(e.snapshot(), e.initializer));
  }
}

// Deep link: #settings or #settings-<tab> (controls, hints, practice) opens the dialog on load.
if (location.hash.startsWith("#settings")) {
  const tab = location.hash.slice("#settings-".length) as SettingsTab;
  queueMicrotask(() => modal.open(SETTINGS_TABS.includes(tab) ? tab : "handling"));
}

$("btn-restart").addEventListener("click", blurAfter(restart));
$("btn-settings").addEventListener("click", blurAfter(() => modal.open()));

let lastMode = settings.value.mode;
let lastDrill = settings.value.drill;
settings.subscribe((s) => {
  session.setHandling(s.handling);
  session.setGarbage(garbageOf(s));
  mirrorDirty = true; // e.g. "show full plan" changed
  renderLegend();
  if (s.mode !== lastMode) {
    lastMode = s.mode;
    lastDrill = s.drill;
    applyMode();
    return;
  }
  const prev = lastDrill;
  lastDrill = s.drill;
  if (s.mode !== "drill") return;
  const d = s.drill;
  if (d.piece !== prev.piece || d.depth !== prev.depth || d.maxGarbageRows !== prev.maxGarbageRows || d.seed !== prev.seed) {
    feed.discard();
    void loadNextDrill();
  } else if (d.gravity !== prev.gravity) {
    retryDrill();
  }
});

// ------------------------------------------------------------ lock feedback

const label = $("clear-label");
let labelTimer = 0;

function flash(main: string, extras: string[] = []): void {
  label.replaceChildren();
  const m = document.createElement("div");
  m.className = "main";
  m.textContent = main;
  label.append(m);
  for (const x of extras) {
    const d = document.createElement("div");
    d.className = "extra";
    d.textContent = x;
    label.append(d);
  }
  label.classList.remove("show");
  void label.offsetWidth; // restart the CSS animation
  label.classList.add("show");
  clearTimeout(labelTimer);
  labelTimer = window.setTimeout(() => label.classList.remove("show"), 1400);
}

session.onLock(({ info, snapshot, cells }) => {
  if (inDrill() && session.inScenario) return onDrillLock(info, snapshot, cells);
  // Stats: did this lock follow the step 1 shown for the position it was made from?
  const step1 = planResult && planResult.version === mirrorState.version ? shownSteps().steps[0] : undefined;
  const followed = step1 ? hintStats.lock(cells, step1.cells) : false;

  setMirror(mirrorFromSnapshot(snapshot, session.engine.initializer));
  // Hint lifetime: the plan is for the previous position. "off" keeps it up
  // (marked stale); "clear" drops it; "auto-refresh" asks again for the new
  // position when the user followed step 1, and otherwise drops it.
  if (planResult || hintNote) {
    const lifetime = settings.value.hint.lifetime;
    if (lifetime === "off" && planResult) hintNote = "Hint is from an earlier position";
    else setPlans(null);
    if (lifetime === "auto-refresh" && followed && !info.topout) queueMicrotask(() => void requestHint(true));
  }
  const { main, extras } = lockLabels(info);
  if (main || extras.length) flash(main ?? extras.shift()!, extras);
  else if (info.breaksB2B) flash("B2B lost");
});

session.onReset(() => {
  label.classList.remove("show");
  resumeFromHint();
  setPlans(null);
  setMirror(mirrorFromSnapshot(session.engine.snapshot(), session.engine.initializer));
  renderSeed();
});

function renderSeed(): void {
  $("seed").textContent = inDrill() ? (drill.scenario ? `drill · ${drill.scenario.name}` : "") : `seed ${session.seed}`;
}
renderSeed();

// ------------------------------------------------------------ layout

const SMALL_RATIO = 0.62; // preview mino size relative to a board cell
/** One playfield ≈ board (10 cells) + two side columns (5 preview minos + panel chrome) + gaps. */
const PLAYFIELD_CELLS = BOARD_WIDTH + 2 * 5 * SMALL_RATIO;
const PLAYFIELD_CHROME = 2 * 22 + 2 * 12;

function layout(): void {
  const W = window.innerWidth;
  const barH = document.body.classList.contains("drill-mode") ? 44 : 0;
  const byH = Math.floor((window.innerHeight - 56 - barH - 40 - 48) / (BOARD_HEIGHT + BUFFER_ROWS_SHOWN + 1));
  const byW = Math.floor((W - 32 - 32 - 2 * PLAYFIELD_CHROME) / (2 * PLAYFIELD_CELLS));
  let cell = Math.min(34, byH, byW);
  const stacked = cell < 18;
  document.body.classList.toggle("stacked", stacked);
  if (stacked) cell = Math.min(34, Math.floor((W - 32 - PLAYFIELD_CHROME) / PLAYFIELD_CELLS));
  cell = Math.max(12, cell);
  const small = Math.max(8, Math.round(cell * SMALL_RATIO));
  document.documentElement.style.setProperty("--field-top", `${BUFFER_ROWS_SHOWN * cell}px`);
  play.resize(cell);
  mirror.resize(cell);
  planOverlay.resize();
  for (const p of [hold, queue, mHold, mQueue]) p.resize(small);
  mirrorDirty = true;
}
window.addEventListener("resize", layout);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  play.refreshTheme();
  mirror.refreshTheme();
  mirrorDirty = true;
});
layout();

// ------------------------------------------------------------ render

const overlay = $("state-overlay");
const statsEl = $("stats");

function renderLegend(): void {
  const kb = settings.value.keybinds;
  const show: Action[] = inDrill()
    ? ["moveLeft", "moveRight", "softDrop", "hardDrop", "rotateCCW", "rotateCW", "rotate180", "hold", "hint", "undo", "restart", "nextDrill", "toggleMode", "openSettings"]
    : ["moveLeft", "moveRight", "softDrop", "hardDrop", "rotateCCW", "rotateCW", "rotate180", "hold", "hint", "undo", "restart", "pause", "toggleMode", "openSettings"];
  $("legend").replaceChildren(
    ...show.map((a) => {
      const s = document.createElement("span");
      const k = document.createElement("kbd");
      k.textContent = kb[a][0] ? formatBinding(kb[a][0]!) : "—";
      s.append(k, ` ${a === "restart" && inDrill() ? "Retry" : ACTION_LABELS[a]}`);
      return s;
    })
  );
}
renderLegend();

let lastStats = "";
function renderStats(): void {
  const e = session.engine;
  if (inDrill()) return renderDrillStats();
  const charging = e.b2b.charging;
  const surge = charging && e.stats.b2b >= charging.at ? e.dynamicStats.surgePower : 0;
  const hs = hintStats.value;
  const rate = hintStats.matchRate;
  const rows: [string, string][] = [
    ["B2B", e.stats.b2b > 0 ? `×${e.stats.b2b}` : e.stats.b2b === 0 ? "ready" : "—"],
    ["Surge", surge > 0 ? String(surge) : "—"],
    ["Combo", e.stats.combo > 0 ? String(e.stats.combo) : "—"],
    ["Pieces", String(e.stats.pieces)],
    ["Lines", String(e.stats.lines)],
    ["PPS", e.dynamicStats.pps.toFixed(2)],
    ["Hints", String(hs.hintsUsed)],
    ["Step 1", rate === null ? "—" : `${Math.round(rate)}% (${hs.stepsMatched}/${hs.stepsShown})`]
  ];
  const g = session.nextGarbageIn;
  if (g !== null) {
    const pending = session.pendingGarbage;
    rows.push(["Garbage", pending ? `${pending} incoming` : `in ${Math.ceil(g)} s`]);
  }
  const html = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  if (html !== lastStats) {
    statsEl.innerHTML = html;
    lastStats = html;
  }
}

function renderOverlay(): void {
  if (inDrill() && (drillLoading || drillError || drill.result)) return renderDrillOverlay();
  const msg = session.over ? "Game over" : session.paused && !modal.isOpen && !hintPaused ? "Paused" : "";
  overlay.hidden = !msg;
  if (msg) {
    const kb = settings.value.keybinds;
    const key = session.over ? kb.restart[0] : kb.pause[0];
    overlay.innerHTML = `<div class="title">${msg}</div><div class="muted">${key ? `Press <kbd>${formatBinding(key)}</kbd> to ${session.over ? "restart" : "resume"}` : ""}</div>`;
  }
}

/** Mirror: locked board + the piece that will be placed next, faded at its spawn. */
function renderMirror(): void {
  const m = mirrorState;
  mirror.draw({
    board: m.board,
    falling: { mino: m.current.mino, cells: pieceCellsAt(m.current.mino, m.current.x, m.current.y, m.current.rotation), alpha: 0.45 }
  });
  mHold.draw([m.hold]);
  mQueue.draw(m.queue.slice(0, PREVIEWS));

  const { steps, hasFinal } = shownSteps();
  planOverlay.draw(
    steps.map((st, i) => ({ cells: st.cells, mino: st.mino, n: i + 1, usesHold: st.usesHold, final: hasFinal && i === steps.length - 1 }))
  );
  $("m-hold-panel").classList.toggle("highlight", steps.some((st) => st.usesHold));
  $("mirror-note").textContent = hintPaused && hintNote ? `${hintNote}\nPaused · any move key resumes` : hintNote;
  mirrorDirty = false;
}

// ------------------------------------------------------------ spin drills

const drillBar = new DrillBar($("drill-bar"), {
  onPiece: (piece) => settings.update((s) => ({ ...s, drill: { ...s.drill, piece } })),
  onDepth: (depth) => settings.update((s) => ({ ...s, drill: { ...s.drill, depth } })),
  onRetry: () => retryDrill(),
  onNext: () => void loadNextDrill()
});
function inDrill(): boolean {
  return settings.value.mode === "drill";
}

function setMode(mode: Settings["mode"]): void {
  settings.update((s) => ({ ...s, mode }));
}

/** Switch the page between free play and drills (after settings.mode changed). */
function applyMode(): void {
  const on = inDrill();
  document.body.classList.toggle("drill-mode", on);
  $("drill-bar").hidden = !on;
  $("mode-free").classList.toggle("active", !on);
  $("mode-drill").classList.toggle("active", on);
  $("mode-free").setAttribute("aria-pressed", String(!on));
  $("mode-drill").setAttribute("aria-pressed", String(on));
  $("btn-restart").hidden = on; // the drill bar has its own Retry
  layout();
  clearTimeout(advanceTimer);
  input.releaseAll();
  resumeFromHint();
  setPlans(null);
  renderLegend();
  if (on) {
    void loadNextDrill();
  } else {
    drillRequest++;
    drillLoading = false;
    drillError = "";
    drill.scenario = null;
    drill.retry();
    session.setPaused(false);
    hintStats.reset();
    session.restart(settings.value.practice.seed ?? undefined);
  }
  renderSeed();
}

async function loadNextDrill(): Promise<void> {
  clearTimeout(advanceTimer);
  const d = settings.value.drill;
  const id = ++drillRequest;
  drillLoading = true;
  drillError = "";
  input.releaseAll();
  resumeFromHint();
  setPlans(null);
  session.setPaused(true);
  const s = await feed.next({ piece: d.piece, depth: d.depth, maxGarbageRows: d.maxGarbageRows, seed: d.seed });
  if (id !== drillRequest || !inDrill()) return;
  drillLoading = false;
  if (!s) {
    drillError = "Couldn't build a drill for these options";
    return;
  }
  startDrill(s);
}

function startDrill(s: Scenario): void {
  input.releaseAll();
  drill.load(s);
  session.loadScenario(s, { gravity: settings.value.drill.gravity });
  session.setPaused(modal.isOpen);
  renderSeed();
}

/** Back to the start of the current drill. */
function retryDrill(): void {
  const s = drill.scenario;
  if (!s || drillLoading) return;
  clearTimeout(advanceTimer);
  drill.retry();
  startDrill(s);
}

/** The steps still ahead on the generated line, as a plan the overlay can draw. */
function solutionPlan(steps: HintStep[]): PlanResult {
  return { version: mirrorState.version, plans: [{ steps, final: steps.at(-1)!.info, score: 0 }], fallback: null, botMs: 0, verifyMs: 0, rejected: 0 };
}

function describeSolution(steps: HintStep[]): string {
  const n = steps.length;
  const fin = lockLabels(steps.at(-1)!.info).main ?? "";
  const first = steps[0]!;
  return `Solution · ${n} piece${n > 1 ? "s" : ""} → ${fin}\nStep 1: ${formatInputs(first.inputs)}`;
}

function showSolution(): boolean {
  const steps = drill.remainingSolution();
  if (!steps?.length) return false;
  pauseForHint();
  setPlans(solutionPlan(steps), describeSolution(steps));
  return true;
}

/** Drills: the hint is the generated solution (no bot needed). */
function toggleDrillHint(): void {
  if (drillLoading || !drill.scenario) return;
  if (planResult) {
    resumeFromHint();
    setPlans(null);
    return;
  }
  // After a drill ends, the hint key replays it with the solution shown.
  if (drill.status !== "playing") retryDrill();
  drill.hintUsed();
  if (!showSolution()) {
    const key = settings.value.keybinds.restart[0];
    setPlans(null, `You left the generated line.${key ? ` Retry (${formatBinding(key)}) to see the solution.` : ""}`);
  }
}

function onDrillLock(info: LockInfo, snapshot: Parameters<typeof mirrorFromSnapshot>[0], cells: [number, number][]): void {
  const before = mirrorState;
  const result = drill.onLock({ info, cells, before: () => engineFrom(before.initializer, before.snapshot) });
  setMirror(mirrorFromSnapshot(snapshot, session.engine.initializer));

  // Hint lifetime, as in free play: "auto-refresh" moves on to the rest of
  // the line while the user follows it.
  if (planResult || hintNote) {
    const lifetime = settings.value.hint.lifetime;
    if (lifetime === "off" && planResult) hintNote = "Hint is from an earlier position";
    else setPlans(null);
    if (lifetime === "auto-refresh" && !result && !showSolution()) resumeFromHint();
  }

  const { main, extras } = lockLabels(info);
  if (main || extras.length) flash(main ?? extras.shift()!, extras);
  if (result) onDrillResult(result);
}

function onDrillResult(r: DrillResult): void {
  input.releaseAll();
  hintPaused = false;
  setPlans(null);
  session.setPaused(true);
  if (r.status === "passed" && settings.value.drill.autoAdvance) {
    advanceTimer = window.setTimeout(() => void loadNextDrill(), r.notes.length ? 2600 : 1200);
  }
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

let lastDrillOverlay = "";
function renderDrillOverlay(): void {
  const kb = settings.value.keybinds;
  const k = (a: Action) => (kb[a][0] ? `<kbd>${esc(formatBinding(kb[a][0]!))}</kbd>` : "");
  let html: string;
  if (drillLoading) html = `<div class="title">Building a drill…</div>`;
  else if (drillError) html = `<div class="title">${esc(drillError)}</div><div class="muted">${k("nextDrill")} try again · ${k("openSettings")} settings</div>`;
  else {
    const r = drill.result!;
    const pass = r.status === "passed";
    const auto = pass && settings.value.drill.autoAdvance;
    html =
      `<div class="title ${pass ? "pass" : "fail"}">${pass ? "✓ " : "✗ "}${esc(r.headline)}</div>` +
      r.notes.map((n) => `<div class="note">${esc(n)}</div>`).join("") +
      `<div class="muted keys">${k("restart")} retry · ${k("nextDrill")} ${auto ? "next (auto)" : "next"} · ${k("hint")} solution</div>`;
  }
  overlay.hidden = false;
  if (html !== lastDrillOverlay) {
    overlay.innerHTML = html;
    lastDrillOverlay = html;
  }
}

function renderDrillStats(): void {
  const st = drill.stats;
  const s = drill.scenario;
  const pct = (p: number, n: number) => (n ? `${Math.round((100 * p) / n)}% (${p}/${n})` : "—");
  const rows: [string, string][] = [
    ["Drill", s ? `${s.piece}-spin` : "—"],
    ["Pieces", s ? `${drill.placed}/${s.depth}` : "—"],
    ["Passed", pct(st.passed, st.attempted)],
    ["Streak", st.streak ? String(st.streak) : "—"],
    ["Best", st.bestStreak ? String(st.bestStreak) : "—"],
    ["Hints", String(st.hintsUsed)]
  ];
  if (s) {
    const per = st.byPiece[s.piece];
    rows.splice(3, 0, [`${s.piece} rate`, pct(per.passed, per.attempted)]);
  }
  const html = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join("");
  if (html !== lastStats) {
    statsEl.innerHTML = html;
    lastStats = html;
  }
}

function renderDrillBar(): void {
  if (!inDrill()) return;
  const d = settings.value.drill;
  const s = drill.scenario;
  const info = drillLoading ? "Building…" : s ? `Place ${s.depth} piece${s.depth > 1 ? "s" : ""}, end with ${s.piece === "I" || s.piece === "L" || s.piece === "S" ? "an" : "a"} ${s.piece}-spin` : "";
  drillBar.set(d.piece, d.depth, info);
}

$("mode-free").addEventListener("click", blurAfter(() => setMode("free")));
$("mode-drill").addEventListener("click", blurAfter(() => setMode("drill")));
// Deep link: #drill opens spin drills.
if (location.hash === "#drill" && !inDrill()) setMode("drill");
// Initial mode: the dev #board= position is free play only.
else if (inDrill()) applyMode();
else {
  $("mode-free").classList.add("active");
  $("mode-free").setAttribute("aria-pressed", "true");
  $("mode-drill").setAttribute("aria-pressed", "false");
}

function frame(now: number): void {
  session.advance(now);
  const e = session.engine;
  const cells = e.falling.absoluteBlocks.map(([x, y]) => [x, y] as const);
  play.draw({
    board: e.board.state,
    falling: session.over ? null : { mino: e.falling.symbol, cells },
    ghost: session.over ? null : ghostCells(e.board.state, cells),
    dimmed: session.over || (session.paused && !modal.isOpen && !hintPaused)
  });
  hold.draw([e.held], e.holdLocked);
  queue.draw(e.queue.slice(0, PREVIEWS));
  if (mirrorDirty) renderMirror();
  renderDrillBar();
  renderStats();
  renderOverlay();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
