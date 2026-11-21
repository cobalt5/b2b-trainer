# TETR.IO B2B Trainer — Design Doc

Nov 19, 2026 · @nate · Status: draft, for handoff to an implementing agent

## 1. Summary

A local practice app for training back-to-back (B2B) play under TETR.IO rules. The user plays normally on a **left board**. A **right board** mirrors the left board's state. When the user presses a **hint key**, the right board draws outlines of the recommended placements, from the current piece up to and including the piece that makes the **next B2B-keeping clear** (quad, T-spin, all-spin mini, or perfect clear).

The app is built from two open-source parts:

- **Game engine:** Triangle.js engine (`@haelp/teto/engine`), a TypeScript copy of TETR.IO's engine with SRS+ kicks and all-mini+ spin detection.
- **Analyzer:** Frostetra, a Rust bot descended from Cold Clear 2 that supports SRS+, 180 rotation, all-mini+ spins and allspin B2B sources. It talks over the Stacker Bot Protocol (SBP), JSON lines on stdin/stdout.

Non-goals: playing on live TETR.IO, connecting to TETR.IO servers, online play, or any assist that runs inside the real game.

## 2. Research findings

### 2.1 Engine: Triangle.js engine (chosen)

| Item | Finding (checked in source, Nov 2026) |
| --- | --- |
| Repo / package | github.com/halp1/triangle · npm `@haelp/teto` v4.2.8 · import `@haelp/teto/engine` |
| License | MIT. README says the Engine and Channel parts are open to use by anyone |
| Language | TypeScript (works in browser or Node/Bun) |
| Kick tables | `SRS`, `SRS+`, `SRS-X`, `TETRA-X`, `NRS`, `ARS`, `ASC`, `none` (src/engine/utils/kicks/data.ts) |
| Spin rules | `none`, `T-spins`, `T-spins+`, `all`, `all+`, `all-mini`, `all-mini+`, `mini-only`, `stupid` |
| B2B | `b2b.chaining` and `b2b.charging` (Surge) options, plus `b2bcharge_at`, `b2bcharge_base`, all-clear B2B options |
| API | `new Engine(params)`, `press(key)` (`moveLeft`, `rotateCW`, `rotate180`, `hold`, `hardDrop`, `dasLeft`…), `hardDrop()` returns a `LockRes`, `snapshot()` / `fromSnapshot()`, `clone()`, `undo()`/`redo()`, `receiveGarbage()`, `board.state` (row 0 = bottom), `falling`, `queue`, `held` |
| Freshness | Last commit 3 Nov 2026. README says last known to work with TETR.IO Beta 1.7.8 |

Why this one: it is the only maintained open-source engine found that copies TETR.IO's own rules (SRS+, all-mini+, Surge) rather than a generic guideline clone. Generic SRS clones found in the search lacked SRS+ and allspin.

Do not use the Triangle `Client` (it logs into TETR.IO and needs an approved bot account). Use only `@haelp/teto/engine`.

### 2.2 Analyzer: Frostetra (chosen)

| Item | Finding |
| --- | --- |
| Repo | github.com/ruelalarcon/frostetra (Rust, lib + bin) |
| License | MIT (Mark Carlson 2021, Ruel Alarcon 2026) |
| Search | Cold Clear 2 style: column-major bitboards, transposition-aware DAG, MCTS-like expansion, multithreaded |
| Rules supported | kicksets `srs`, `srs_plus`; `rot180`; spin\_detection `none`, `t-spins`, `t-spins+`, `all`, `all+`, `all-mini`, `all-mini+`, `mini-only`; back\_to\_back\_sources `quad`, `t-spin`, `t-spin-mini`, `allspin`, `allspin-mini`, `perfect-clear`; board up to 127×64 |
| Protocol | SBP/1: `rules` → `ready` → `start` → `suggest` → `suggestion` → `advance`/`play` → `new_piece` |
| Eval config | JSON overrides; freestyle weights include `has_back_to_back`, `back_to_back_depth`, `back_to_back_clear` |
| Determinism | `iterations_per_suggest` / `nodes_per_suggest` budgets with seeded RNG |
| Gap | `suggest` returns only the single best child (`children.first()` in src/search/dag/known.rs), and there is no principal-variation (PV) or multi-move output. Section 6 covers the fork. |
| Freshness | Last commit 3 Nov 2026 |

Companion: **Minorail** (github.com/ruelalarcon/minorail, MIT, Python) is an SBP runner with a web visualizer, a websocket suggestion API, path output, a `tetrio_s2` attack calculator and a ready `tetrio.settings.toml`. Use it as a reference and a test harness. The app does not need it at runtime.

### 2.3 Rejected options

- **Cold Clear 2** (MinusKelvin): T-spin detection only, no 180 kicks, last commit 2022. Wrong rules for TETR.IO.
- **Cold Clear 1:** older, MPL-2.0, guideline T-spins only.
- **Zetris** (MisaMino-based): a C#/Windows bot that plays PPT/TETR.IO through the screen and input. Not a library you can embed.

No Tetris bot is provably optimal the way a solved game is. All of these use heuristic search, so "optimal" in this doc means the analyzer's best-evaluated line.

## 3. Requirements

### 3.1 Functional

1. **Left board (play):** full TETR.IO-style play using the Triangle engine: 10×20 visible (40 total), 7-bag, hold, 5 previews, 180 rotation, configurable DAS / ARR / SDF and keybinds, ghost piece, lock delay and gravity matching the engine's defaults.
2. **Right board (mirror):** a read-only copy of the left board's locked state, hold and queue, updated on every lock. Showing the falling piece live is optional.
3. **Hint key** (default `Tab`, rebindable): takes a snapshot of the current state, asks the analyzer, and draws the plan on the mirror:
   - one outline per placement, numbered 1…k and colored in order;
   - the final B2B clear is highlighted and labeled with its type (e.g. "T-spin double", "S-spin mini", "Quad");
   - a hold step is marked where the plan uses hold.
4. **Hint lifetime:** the plan stays until the next lock. Then the app either clears it, or refreshes it automatically if the user followed step 1 (setting: `off` / `clear` / `auto-refresh`).
5. **No plan found:** if no B2B clear is reachable with the known pieces, show "No B2B clear in visible queue" and the analyzer's single best move as a fallback.
6. **Practice options:** seedable RNG, restart, undo (engine `undo()`), optional garbage injection (clean or cheese, configurable), optional pause while a hint is shown.
7. **Stats panel:** current B2B streak, Surge charge, hints used, and the percentage of hint step 1 the user matched.

### 3.2 Non-functional

- Hint latency under 300 ms on a laptop for a 5-piece preview (search budget configurable).
- Every placement shown must be legal and reachable in the Triangle engine, and must classify (spin type, lines, B2B) exactly as Triangle does. Triangle is the source of truth.
- Runs locally offline. No network calls to TETR.IO.

## 4. What "next B2B" means

Given the state S (board, current piece, hold, known queue, B2B counter), a **B2B plan** is a sequence of placements P1…Pk over the known pieces (hold allowed) such that:

- Pk is a line clear in a B2B source class: quad, T-spin (full or mini), all-spin mini, or perfect clear;
- none of P1…Pk-1 is a line clear outside those classes, because that would break B2B (non-clearing placements are fine);
- k ≤ the number of known pieces (current + hold + previews).

Ranking: score each plan by the analyzer's evaluation of the state after Pk, minus a small cost per placement (shorter is better), plus an optional bonus for spin clears over quads. Show the best plan, and keep the top 3 so the user can cycle with a key (`[` / `]`).

Two ways to compute it:

- **A. PV walk (MVP):** run Frostetra with B2B-heavy weights. Repeat: `suggest` → take the best move → check it in Triangle → `advance` a separate analysis session. Stop at the first B2B clear, at a B2B-breaking clear (discard the plan), or when the queue runs out. Needs no Rust changes beyond top-N, but it only finds the bot's own line.
- **B. B2B planner (target):** a bounded search inside the Frostetra fork. Enumerate placement sequences over the known queue with hold using Frostetra's movegen. Prune any branch that makes a B2B-breaking clear. Stop a branch at its first B2B clear and score that leaf with the freestyle evaluator. Use a beam (width about 200–1000) to keep it fast. Return the top N plans through an SBP extension (section 6).

Build A first to get the whole pipeline working end to end, then replace it with B.

## 5. Architecture

Stack: **Vite + TypeScript + Canvas 2D** frontend, plus a small **Bun (or Node) bridge** that spawns the Frostetra binary and relays SBP over a localhost WebSocket. Packaging as a Tauri desktop app with Frostetra as a sidecar is an optional later step.

Modules:

- `game-core/` (TS): wraps the Triangle `Engine`. Owns the input handler (DAS/ARR/SDF timing calling `press()`), emits `lock` events with a `snapshot()`, and exposes `cloneForAnalysis()`.
- `render/` (TS): draws both boards, queue, hold and stats. Has a separate overlay layer for plan outlines.
- `adapter/` (TS): converts between Triangle state and SBP:
  - board: Triangle `board.state` (row 0 = bottom) → SBP board rows;
  - piece and orientation: Triangle rotation 0/1/2/3 ↔ SBP `north`/`east`/`south`/`west`;
  - position: Triangle piece origin ↔ SBP piece-location `x`,`y`. Derive the conversion from both codebases' piece cell tables, and pin it with unit tests for all 7 pieces × 4 orientations.
- `verify/` (TS): for each suggested placement, run a BFS over `press()` on a cloned Triangle engine (moves, rotations including 180, soft drop, hard drop) to find an input path that ends in exactly that cell set. Read the spin type, lines and B2B from `LockRes`. Reject any placement that is unreachable or classifies differently from what Frostetra reported, and log it as a mismatch.
- `planner/` (TS): runs strategy A or calls strategy B, then checks the whole plan step by step in a cloned engine.
- `bridge/` (Bun): spawns the bot process, handles the SBP handshake, holds a request queue, and restarts the bot on crash.

Hint data flow:

1. User presses the hint key → `game-core` takes a snapshot.
2. `adapter` builds SBP `start` (board, current piece, hold, queue, B2B state) → `bridge` → Frostetra.
3. Planner requests a plan (strategy A loop, or B with one `suggest` carrying the `b2b_plan` extension).
4. `verify` replays every step in a cloned Triangle engine and keeps the plans that pass.
5. `render` draws the outlines on the mirror board.

## 6. Frostetra fork: changes

1. **Top-N suggestions:** in `src/search/dag/known.rs::suggest`, return the first N children (they are already sorted) instead of `children.first()`. N comes from `suggest.extensions.top_n` (default 1).
2. **PV output:** add `extensions.pv: true` → follow the best child down the DAG through the known pieces and return that move sequence in the suggestion's extensions.
3. **B2B planner (strategy B):** new module `bot/behavior/b2b_plan/`, a beam search over `tetris::movegen` with hold. Request: `extensions.b2b_plan = {max_depth, beam_width, top_n, length_penalty, spin_bonus}`. Response: `extensions.b2b_plans = [{moves:[placement…], final_clear:{lines, spin, b2b_class}, score}]`.
4. **Weights preset:** add a `b2b` config preset that raises `has_back_to_back`, `back_to_back_clear` and `back_to_back_depth` and penalizes non-B2B clears. Load it with `--config`.
5. Keep the MIT notices. Put changes behind extensions so the binary still speaks plain SBP/1.

## 7. Rule configuration

Triangle `EngineInitializeParams` (TETRA LEAGUE-like). The agent should confirm field names against Triangle's typedoc and `test/engine` fixtures:

- `kickTable: "SRS+"`, `spinBonuses: "all-mini+"`, 180 enabled
- `b2b: { chaining: false, charging: true }` (Surge)
- board 10 wide, 20 visible + buffer, 5 previews, 7-bag, hold on
- garbage off by default; garbage practice uses `receiveGarbage()`

SBP `rules` sent to Frostetra (matches Minorail's `tetrio.settings.toml`):

```json
{"type":"rules","randomizer":"seven_bag","kickset":"srs_plus","rot180":true,
 "sonic_drop":"only","spin_detection":"all-mini+",
 "back_to_back_sources":["quad","t-spin","t-spin-mini","allspin","allspin-mini","perfect-clear"],
 "spawn_position":{"x":4,"y":21},"board_size":{"width":10,"height":40}}
```

Check the exact SBP field shapes against `spec/sbp-1.md` in github.com/ruelalarcon/stacker\_bot\_protocol.

## 8. UI

- Layout: left board (play) | center column (hold, queue, stats) | right board (mirror + overlay). Same cell size on both boards.
- Outlines: 2 px stroke in the piece color, with a step number in the top-left mino. The final step gets a thicker stroke and a glow, plus a label under the board.
- Hold steps: a small "H" badge on the outline and a highlight on the hold box.
- Settings modal: keybinds, DAS/ARR/SDF, hint key, hint lifetime, search budget, top-N cycling, garbage options.

## 9. Milestones

1. **M0 Setup:** monorepo (`app/`, `bridge/`, `frostetra/` as a fork or submodule). Build Frostetra release. Install `@haelp/teto`.
2. **M1 Playable board:** Triangle engine with input handling and rendering. Test: plays like TETR.IO, SRS+ kicks and 180s work, spin labels appear.
3. **M2 Mirror:** right board copies state on lock.
4. **M3 Bridge + single hint:** SBP handshake, show the bot's single best move on the mirror.
5. **M4 Adapter + verify:** coordinate tests for 28 piece/orientation pairs; BFS reachability; spin classification cross-check on a set of known TETR.IO spin setups.
6. **M5 Plan (strategy A):** top-N + PV in the fork; numbered outlines up to the next B2B clear.
7. **M6 Plan (strategy B):** `b2b_plan` extension in Rust; cycle through top 3.
8. **M7 Polish:** stats, settings, garbage practice, auto-refresh hints, optional Tauri packaging.

## 10. Testing and acceptance

- Unit: adapter round-trips; kick results for the SRS+ I-piece and 180 kicks compared with Triangle's tables; B2B-plan constraint checker.
- Golden boards: about 30 hand-made positions with a known B2B finish (TSD, TST, S/Z/L/J/I-spin minis, quad). The planner must find a valid plan in each, and every plan must pass `verify`.
- Fuzz: 10,000 random states from seeded games. Zero plans that fail `verify`; record the mismatch rate between Frostetra's and Triangle's spin classification (target 0).
- Performance: p95 hint latency under 300 ms at the default budget.
- Acceptance: following hint plans for 200 pieces keeps the B2B streak unbroken in at least 95% of states where a plan was shown.

## 11. Risks and open questions

- **Engine drift:** Triangle is a reverse-engineered copy, last noted as matching Beta 1.7.8. A TETR.IO update can change kicks or spin rules. Pin the version and re-run the golden tests after updates.
- **Classification mismatch** between Frostetra and Triangle in edge cases (immobile checks, I-spins, 180 kicks): `verify` treats Triangle as the truth, so log mismatches and fix them in the fork.
- **Not truly optimal:** plans are heuristic and depend on weights. Expose the weights and the budget.
- **Queue horizon:** only known pieces can be planned. A plan that needs unseen pieces is out of scope for v1 (possible v2: bag-aware speculation).
- **Terms of service:** never attach this to the live game. Use the Triangle engine only, not its client.
- **Open:** default keybinds and handling? Show the full plan or only step 1 by default? Should Surge release (breaking B2B on purpose) ever be suggested? Default: no.

## 12. References

- Triangle.js: https://github.com/halp1/triangle (engine docs in `documents/Engine.md`)
- Frostetra: https://github.com/ruelalarcon/frostetra
- Stacker Bot Protocol: https://github.com/ruelalarcon/stacker\_bot\_protocol
- Minorail: https://github.com/ruelalarcon/minorail
- Cold Clear 2 (reference only): https://github.com/MinusKelvin/cold-clear-2
- TETR.IO mechanics: https://tetris.wiki/TETR.IO
