/**
 * Spin drill generator (Design_Doc §13).
 *
 *  1. Dress a spin core (drill/templates.ts): column offset, outside fill with
 *     random bumps, optional garbage rows underneath.
 *  2. Ask Triangle which line-clearing spins the target piece can reach there
 *     (BFS over press(), then a real hard drop). The best one is the finish.
 *  3. For depth d, take d−1 pieces back off the board, one at a time: a
 *     tetromino-shaped group of filled cells whose piece can reach exactly
 *     those cells once they are removed, and whose removal leaves nothing
 *     floating. Groups near the slot, and ones the spin needs, are preferred.
 *     Removing cells never makes a full row, so no step before the spin clears
 *     lines and every outline stays in the start board's coordinates.
 *  4. Lay out current / previews / hold (depth 7 starts a needed piece in hold).
 *  5. Replay the whole line forward in a fresh engine (verifyPlacement), which
 *     gives the hint steps. Triangle is the truth: anything that fails is
 *     thrown away and the generator tries again.
 */

import { Engine, type LockRes, type Mino } from "@haelp/teto/engine";

import { cellsKey, locationFromCells } from "../adapter/coords";
import { ORIENTATIONS, sbpCells } from "../adapter/sbp";
import type { PieceId, Placement } from "../adapter/sbp-types";
import { classifyLock, lockLabels, type LockInfo } from "../game-core/clear";
import { buildEngineParams } from "../game-core/rules";
import type { HintStep } from "../planner/hint";
import { scorePlan, toStep } from "../planner/plan";
import { DEFAULT_SETTINGS, toEngineHandling } from "../ui/settings";
import { enumerateFinals, type Final } from "../verify/search";
import { cloneEngine, verifyPlacement } from "../verify/verify";
import { BOARD_COLS, DRILL_PIECES, MAX_DEPTH, applyScenario, rowsFromGrid, writeGrid, type DrillChoice, type DrillPiece, type Grid, type Scenario } from "./scenario";
import { flipRows, templatesFor, type SpinTemplate } from "./templates";

export interface GenerateOptions {
  piece: DrillChoice;
  /** Pieces to place, spin included (1–7). */
  depth: number;
  seed: number;
  /** Garbage rows under the stack: 0..max, picked per drill. */
  maxGarbageRows?: number;
  /** Boards tried before giving up. */
  maxAttempts?: number;
}

/** A reachable line-clearing spin of the falling piece. */
export interface SpinFinish {
  final: Final;
  info: LockInfo;
  /** scorePlan with no length penalty: higher is the better clear. */
  score: number;
}

// ------------------------------------------------------------------ rng

/** mulberry32: small, fast, seedable. */
export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const randInt = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

// ------------------------------------------------------------------ Triangle probes

const HEIGHT = 40;
const ALL_PIECES: readonly PieceId[] = ["I", "J", "L", "O", "S", "T", "Z"];

/** An engine with the drill rules, for probing positions. */
export function probeEngine(seed = 1): Engine {
  return new Engine(buildEngineParams(seed, toEngineHandling(DEFAULT_SETTINGS.handling), "off", { gravity: false }));
}

function setPosition(e: Engine, g: Grid, piece: string, hold: Mino | null = null): void {
  writeGrid(e, g);
  e.held = hold;
  e.holdLocked = false;
  e.lastSpin = null;
  e.initiatePiece(piece.toLowerCase() as Mino);
}

const scoreOf = (info: LockInfo) => scorePlan(info, 1, { lengthPenalty: 0 });

/**
 * Every line-clearing spin the engine's falling piece can reach, best first.
 * Each is replayed for real so the label is Triangle's own.
 */
export function spinFinishes(e: Engine): SpinFinish[] {
  const out: SpinFinish[] = [];
  for (const f of enumerateFinals(e)) {
    if (!f.spin) continue;
    const c = cloneEngine(e);
    for (const k of f.path) c.press(k);
    const res = c.press("hardDrop") as LockRes;
    const info = classifyLock(res, c.board.state);
    if (info.spin !== "none" && info.lines > 0) out.push({ final: f, info, score: scoreOf(info) });
  }
  return out.sort((a, b) => b.score - a.score || a.final.path.length - b.final.path.length);
}

/**
 * Best line-clearing spin of `piece` from an engine state, using hold if the
 * piece is held. Null if the piece isn't playable or no spin clears lines.
 */
export function bestSpin(e: Engine, piece: string): SpinFinish | null {
  const want = piece.toLowerCase();
  let work = e;
  if (e.falling.symbol !== want) {
    if (e.holdLocked) return null;
    work = cloneEngine(e);
    work.press("hold");
    if (work.falling.symbol !== want) return null;
  }
  return spinFinishes(work)[0] ?? null;
}

// ------------------------------------------------------------------ boards

interface Dressed {
  grid: Grid;
  /** Rows at the bottom that are garbage (never taken back as pieces). */
  garbageRows: number;
}

/** Place a core and fill around it. Null if the result has a full row. */
export function dressTemplate(t: SpinTemplate, flip: boolean, rng: Rng, maxGarbageRows: number): Dressed | null {
  const rows = flip ? flipRows(t.rows) : t.rows;
  const w = rows[0]!.length;
  const h = rows.length;
  const wall = t.wall && flip ? (t.wall === "left" ? "right" : "left") : t.wall;
  const ox = wall === "left" ? 0 : wall === "right" ? BOARD_COLS - w : randInt(rng, 0, BOARD_COLS - w);
  const fill = pick(rng, t.fills);
  const gRows = randInt(rng, 0, maxGarbageRows);
  const grid: Grid = Array.from({ length: HEIGHT }, () => Array<boolean>(BOARD_COLS).fill(false));

  const hole = randInt(rng, 0, BOARD_COLS - 1);
  for (let y = 0; y < gRows; y++) for (let x = 0; x < BOARD_COLS; x++) grid[y]![x] = x !== hole;

  for (let r = 0; r < h; r++) {
    const row = rows[h - 1 - r]!;
    for (let c = 0; c < w; c++) grid[gRows + r]![ox + c] = row[c] === "X";
  }

  // Outside columns: `fill` high plus a gentle random walk of bumps.
  let bump = randInt(rng, 0, 1);
  for (let x = 0; x < BOARD_COLS; x++) {
    if (x >= ox && x < ox + w) continue;
    bump = Math.max(0, Math.min(3, bump + randInt(rng, -1, 1)));
    for (let y = 0; y < fill + bump; y++) grid[gRows + y]![x] = true;
  }

  return grid.some((row) => row.every(Boolean)) ? null : { grid, garbageRows: gRows };
}

/** Every filled cell connects to the floor through filled cells. */
export function isGrounded(g: Grid): boolean {
  const seen = new Set<number>();
  const stack: [number, number][] = [];
  for (let x = 0; x < BOARD_COLS; x++) if (g[0]![x]) stack.push([x, 0]);
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const k = y * BOARD_COLS + x;
    if (seen.has(k) || !g[y]?.[x]) continue;
    seen.add(k);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  let filled = 0;
  for (const row of g) for (const c of row) if (c) filled++;
  return filled === seen.size;
}

const SHAPES: { piece: PieceId; rel: readonly (readonly [number, number])[] }[] = ALL_PIECES.flatMap((piece) => {
  const seen = new Set<string>();
  return ORIENTATIONS.flatMap((orientation) => {
    const rel = sbpCells({ piece, orientation, x: 0, y: 0 });
    const minX = Math.min(...rel.map(([x]) => x));
    const minY = Math.min(...rel.map(([, y]) => y));
    const norm = rel.map(([x, y]) => [x - minX, y - minY] as const);
    const k = cellsKey(norm);
    if (seen.has(k)) return [];
    seen.add(k);
    return [{ piece, rel: norm }];
  });
});

interface Group {
  piece: PieceId;
  cells: [number, number][];
}

/** Tetromino-shaped groups of filled cells above the garbage rows. */
function filledGroups(g: Grid, garbageRows: number): Group[] {
  let top = g.length - 1;
  while (top >= 0 && !g[top]!.some(Boolean)) top--;
  const out: Group[] = [];
  for (const { piece, rel } of SHAPES) {
    for (let y = garbageRows; y <= top; y++) {
      for (let x = 0; x < BOARD_COLS; x++) {
        const cells = rel.map(([dx, dy]) => [x + dx, y + dy] as [number, number]);
        if (cells.every(([cx, cy]) => cx < BOARD_COLS && g[cy]?.[cx])) out.push({ piece, cells });
      }
    }
  }
  return out;
}

const without = (g: Grid, cells: readonly (readonly [number, number])[]): Grid => {
  const c = g.map((r) => r.slice());
  for (const [x, y] of cells) c[y]![x] = false;
  return c;
};

/**
 * Cheap reachability pre-check: in at least one of the group's columns nothing
 * is filled above the group, so the piece has a way down (tucks and spins
 * still get the real BFS check).
 */
function hasSky(g: Grid, cells: readonly (readonly [number, number])[]): boolean {
  const cols = new Map<number, number>();
  for (const [x, y] of cells) cols.set(x, Math.max(cols.get(x) ?? -1, y));
  for (const [x, top] of cols) {
    let open = true;
    for (let y = top + 1; y < g.length && open; y++) if (g[y]![x]) open = false;
    if (open) return true;
  }
  return false;
}

const distance = (a: readonly (readonly [number, number])[], b: readonly (readonly [number, number])[]) =>
  Math.min(...a.flatMap(([ax, ay]) => b.map(([bx, by]) => Math.abs(ax - bx) + Math.abs(ay - by))));

/** Reachability checks per removal step (each is a BFS). */
const MAX_PROBES_PER_STEP = 24;
const VALID_PER_STEP = 3;

/**
 * Take one piece back off the board. Returns the smaller board and the piece,
 * or null if nothing can be taken back.
 */
function takeBack(e: Engine, g: Grid, garbageRows: number, slot: SpinFinish, rng: Rng, target: DrillPiece, later: readonly string[]): { grid: Grid; group: Group } | null {
  // The line must stay a 7-bag window (no three of a piece in a row, etc.).
  const legal = new Map(ALL_PIECES.map((p) => [p, isBagWindow([p, ...later])]));
  const groups = filledGroups(g, garbageRows)
    .filter((gr) => legal.get(gr.piece))
    .map((gr) => ({ gr, rank: distance(gr.cells, slot.final.cells) + rng() * 2 }))
    .sort((a, b) => a.rank - b.rank);

  const valid: { grid: Grid; group: Group }[] = [];
  let probes = 0;
  for (const { gr } of groups) {
    if (valid.length >= VALID_PER_STEP || probes >= MAX_PROBES_PER_STEP) break;
    if (!hasSky(g, gr.cells)) continue;
    const smaller = without(g, gr.cells);
    if (!isGrounded(smaller)) continue;
    probes++;
    setPosition(e, smaller, gr.piece);
    const want = cellsKey(gr.cells);
    if (enumerateFinals(e).some((f) => f.cellsKey === want)) valid.push({ grid: smaller, group: gr });
  }
  if (!valid.length) return null;

  // Prefer a piece the spin depends on: without it the intended spin is gone.
  // Checked in random order, stopping at the first one (each check is a BFS).
  const order = valid.map((v) => ({ v, r: rng() })).sort((a, b) => a.r - b.r).map((x) => x.v);
  const slotKey = slot.final.cellsKey;
  for (const cand of order) {
    setPosition(e, cand.grid, target);
    const stillThere = spinFinishes(e).some((s) => s.final.cellsKey === slotKey && s.info.lines === slot.info.lines && s.info.spin === slot.info.spin);
    if (!stillThere) return cand;
  }
  return order[0]!;
}

// ------------------------------------------------------------------ queue

const toMino = (p: string) => p.toLowerCase() as Mino;

/**
 * Pieces forced onto the queue after the current piece: the 5 previews plus
 * the ones revealed while a drill is played (up to 7 locks), so everything
 * the user sees during a drill is one 7-bag stream.
 */
export const FORCED_QUEUE = 12;

/** Bag alignments (0–6) under which `seq` splits into bags with no repeated piece. */
export function bagOffsets(seq: readonly string[]): number[] {
  const out: number[] = [];
  for (let o = 0; o < 7; o++) {
    const bags = new Map<number, Set<string>>();
    let ok = true;
    for (let i = 0; i < seq.length && ok; i++) {
      const b = Math.floor((i + o) / 7);
      const bag = bags.get(b) ?? new Set<string>();
      const p = seq[i]!.toUpperCase();
      if (bag.has(p)) ok = false;
      bag.add(p);
      bags.set(b, bag);
    }
    if (ok) out.push(o);
  }
  return out;
}

/** `seq` could be a stretch of a 7-bag stream. */
export const isBagWindow = (seq: readonly string[]) => bagOffsets(seq).length > 0;

/** Extend a bag window to `length` pieces with ones a 7-bag could deal next. */
export function extendBag(seq: readonly string[], length: number, rng: Rng): string[] {
  const offsets = bagOffsets(seq);
  if (!offsets.length) throw new Error(`not a 7-bag window: ${seq.join("")}`);
  const o = pick(rng, offsets);
  const out = seq.map((p) => p.toUpperCase());
  while (out.length < length) {
    const b = Math.floor((out.length + o) / 7);
    const dealt = new Set(out.filter((_, i) => Math.floor((i + o) / 7) === b));
    out.push(pick(rng, ALL_PIECES.filter((p) => !dealt.has(p))));
  }
  return out;
}

/**
 * Current, hold and queue for a needed piece order (itself a 7-bag window).
 * Up to depth 6 the pieces come in order with hold empty; at depth 7 one of
 * them starts in hold (counted as the piece dealt just before the current
 * one). The rest of the queue is filled so the whole stream stays 7-bag legal.
 */
export function layoutQueue(needed: readonly string[], rng: Rng): { current: Mino; hold: Mino | null; queue: Mino[] } {
  if (needed.length < MAX_DEPTH) {
    const seq = extendBag(needed, 1 + FORCED_QUEUE, rng).map(toMino);
    return { current: seq[0]!, hold: null, queue: seq.slice(1) };
  }
  // Any held piece that keeps the window legal; holding the first piece always does.
  const order = needed.map((_, i) => ({ i, r: rng() })).sort((a, b) => a.r - b.r).map((x) => x.i);
  for (const j of [...order, 0]) {
    const window = [needed[j]!, ...needed.filter((_, i) => i !== j)];
    if (!isBagWindow(window)) continue;
    const seq = extendBag(window, 2 + FORCED_QUEUE, rng).map(toMino);
    return { hold: seq[0]!, current: seq[1]!, queue: seq.slice(2) };
  }
  throw new Error("needed pieces are not a 7-bag window");
}

// ------------------------------------------------------------------ generator

function attempt(e: Engine, piece: DrillPiece, depth: number, rng: Rng, maxGarbageRows: number, seed: number): Scenario | null {
  const { templates, flip } = templatesFor(piece);
  const t = pick(rng, templates);
  const flipped = flip === "always" || (flip === "random" && rng() < 0.5);
  const dressed = dressTemplate(t, flipped, rng, maxGarbageRows);
  if (!dressed) return null;

  setPosition(e, dressed.grid, piece);
  const finish = spinFinishes(e)[0];
  if (!finish) return null;

  let grid = dressed.grid;
  const setup: Group[] = [];
  for (let k = 1; k < depth; k++) {
    const back = takeBack(e, grid, dressed.garbageRows, finish, rng, piece, [...setup.map((s) => s.piece), piece]);
    if (!back) return null;
    grid = back.grid;
    setup.unshift(back.group);
  }

  const lineUp: { piece: string; cells: [number, number][] }[] = [...setup, { piece, cells: finish.final.cells }];
  const layout = layoutQueue(
    lineUp.map((s) => s.piece),
    rng
  );
  const start = { rows: rowsFromGrid(grid), ...layout };

  // Forward replay from the real start position: Triangle has the last word.
  const solution = replay(start, lineUp, finish.info.spin, seed);
  if (!solution) return null;
  const intended = solution.at(-1)!.info;
  if (intended.piece !== piece || intended.spin === "none" || intended.lines === 0) return null;

  const name = lockLabels(intended).main ?? `${piece}-spin`;
  return { piece, depth, ...start, solution, intended, name, template: `${t.name}${flipped ? " (flipped)" : ""}`, seed };
}

/** Replay a line step by step; null unless every step verifies and only the last clears lines. */
export function replay(
  start: Pick<Scenario, "rows" | "current" | "hold" | "queue">,
  line: readonly { piece: string; cells: readonly (readonly [number, number])[] }[],
  finalSpin: Placement["spin"],
  seed = 1
): HintStep[] | null {
  let engine = probeEngine(seed);
  applyScenario(engine, start);
  const steps: HintStep[] = [];
  for (let i = 0; i < line.length; i++) {
    const s = line[i]!;
    const last = i === line.length - 1;
    const location = locationFromCells(s.piece.toUpperCase() as PieceId, s.cells);
    if (!location) return null;
    const v = verifyPlacement(engine, { location, spin: last ? finalSpin : "none" });
    if (!v.ok) return null;
    if (!last && v.info.lines > 0) return null;
    steps.push(toStep(v.placement, v.info, v.inputs, v.usedHold));
    engine = v.after;
  }
  return steps;
}

/** Generate a drill, or null if no board worked within the attempt budget. */
export function generateDrill(opts: GenerateOptions): Scenario | null {
  const depth = Math.max(1, Math.min(MAX_DEPTH, Math.round(opts.depth)));
  const rng = rngFrom(opts.seed);
  const piece: DrillPiece = opts.piece === "mixed" ? pick(rng, DRILL_PIECES) : opts.piece;
  const e = probeEngine(opts.seed);
  const tries = opts.maxAttempts ?? 200;
  for (let i = 0; i < tries; i++) {
    const s = attempt(e, piece, depth, rng, opts.maxGarbageRows ?? 2, opts.seed);
    if (s) return s;
  }
  return null;
}
