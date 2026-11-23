# Step 0 — Confirmed API facts

Checked against source on 2026-11-19. Pinned upstream commits:

| Repo | Commit | Date |
| --- | --- | --- |
| halp1/triangle (`@haelp/teto` 4.2.8, npm latest) | `aa0698ab8b42` | 2026-11-03 |
| ruelalarcon/frostetra | `b92dc7606414` | 2026-11-03 |
| ruelalarcon/stacker_bot_protocol (SBP/1) | `ff643c20b183` | 2026-10-31 |
| ruelalarcon/minorail | `05e9154d4aaf` | 2026-10-31 |

Where these differ from `Design_Doc.md`, the facts below win.

## 1. Triangle engine (`@haelp/teto/engine`)

### EngineInitializeParams (src/engine/index.ts:94)

```ts
{
  queue:   { seed: number, type: "7-bag", minLength: number },
  board:   { width: 10, height: 20, buffer: 20 },   // fullHeight = 40
  kickTable: "SRS+",
  options: { spinBonuses: "all-mini+", comboTable: "multiplier",
             garbageTargetBonus: "none", clutch: true,
             garbageBlocking: "combo blocking", stock: 0 },
  gravity: { value: 0.02, increase: 0, marginTime: 0 },
  garbage: { cap:{value:8,marginTime:0,increase:0,absolute:0,max:40},
             messiness:{change:1,within:0,nosame:false,timeout:0,center:false},
             garbage:{speed:20,holeSize:1},
             multiplier:{value:1,increase:0.008,marginTime:10800},
             bombs:false, seed, boardWidth:10, rounding:"down",
             openerPhase:0, specialBonus:false },
  handling: { arr, das, dcd, sdf, safelock, cancel, may20g, irs, ihs },
  pc:  { garbage: number, b2b: number } | false,
  b2b: { chaining: boolean, charging: false | { at: number, base: number } },
  misc: { movement:{infinite:false,lockResets:15,lockTime:30,may20G:true},
          allowed:{spin180:true,hardDrop:true,hold:true,undo:true,retry:true},
          infiniteHold:false, stride:false },
  multiplayer?: …                                    // omit for solo
}
```

- The doc's `b2b: { chaining:false, charging:true }` is wrong. `charging` takes `{ at, base }`: TETR.IO's defaults are `{ at: 4, base: 3 }`, the same values as `b2bcharge_at` / `b2bcharge_base`.
- There is no separate "180 enabled" flag on the kick table. It's `misc.allowed.spin180`.
- The defaults above come from the replay converter in `test/engine/replay.ts` (TETR.IO's values). Note that the converter swaps board width and height by mistake; don't copy that.

### Input and timing

- `engine.tick(frames)` advances exactly 1 game frame (60 fps). `frames` holds `{type:"keydown"|"keyup", frame, data:{key, subframe, hoisted?}}` events. Using keydown/keyup frames makes the engine apply DAS/ARR/SDF/DCD itself from `engine.handling`, exactly as TETR.IO does. **This is how the play board takes input** (M1), so the user's handling settings map straight onto `engine.handling`.
- `Game.Handling` units are frames: `das`, `arr`, `dcd` in frames (TETR.IO default das 10, arr 2, dcd 1), and `sdf` is a multiplier (41 = instant). `engine.handling` can be changed between ticks.
- `Game.Key` = `moveLeft | moveRight | rotateCW | rotateCCW | rotate180 | softDrop | hardDrop | hold | undo | redo | retry`.
- `engine.press(key)` also accepts `dasLeft` / `dasRight`. It returns a `LockRes` for `hardDrop`, otherwise a boolean (moved/rotated). Use it for analysis and BFS (M4), not for live play.

### State

- `engine.board.state`: `Tile[][]`, rows bottom-up (row 0 = bottom), `Tile = {mino, connections} | null`. Also `board.width`, `board.height`, `board.fullHeight`.
- `engine.falling`: a `Tetromino` with `symbol: Mino`, `location: [x, yFloat]`, `x`, `y` (floored), `rotation: 0|1|2|3` (1 = CW = east), `absoluteBlocks`.
- `engine.queue` (array of `Mino`), `engine.held`, `engine.holdLocked`, `engine.stats.b2b` (−1 = no B2B, 0 = first B2B-eligible clear made, n = chain).
- `Mino` enum values are lowercase strings: `"i" "j" "l" "o" "s" "t" "z" "gb" "bomb"`.
- Undo quirk: the undo snapshot is taken when the next piece spawns, which is *before* `#lock` increments `stats.pieces` / `stats.lines` (index.ts:1590 vs 1629). After `undo()`, the board, queue, hold and b2b are correct, but `pieces` and `lines` are one lock behind. Don't rely on those two counters across undo.
- `snapshot()` / `fromSnapshot()`. To clone: `new Engine(e.initializer)` then `.fromSnapshot(e.snapshot())`, or `e.clone()`. Also `undo()` / `redo()` / `retry()`.
- Events: `engine.events.on("falling.lock", (res: LockRes) => …)`, plus `falling.new` and `queue.add`.

### LockRes (src/engine/types.ts)

`{ mino, lines, spin: "none"|"mini"|"normal", garbageCleared, rawGarbage[], garbage[], surge, stats:{b2b, combo, …}, garbageAdded, topout, pieceTime, keysPresses }`

- There is **no explicit "B2B class" or perfect-clear flag**. Derive it as follows: B2B-source clear = `lines>0 && (lines===4 || spin!=="none")`. A perfect clear is an empty board after the lock. Cross-check with the change in `stats.b2b`.
- Triangle's spin is `"normal"` where SBP says `"full"`.

### Piece geometry

Each rotation is a list of matrix cells `[bx, by]` with `by` pointing down. The absolute cell is `(x + bx, y − by)`, where `(x, y)` is the top-left of the matrix box. A piece spawns at `x = floor(10/2 − w/2)`, `y = height + 2.04` (floored to 22 on a 20-row board).

### Browser note

The engine imports `chalk` (only used for `text` / console output). Check that it bundles under Vite (M0).

## 2. SBP/1 (spec/sbp-1.md)

- Handshake: **the bot sends `register` first** (name, capabilities). Then the client sends `rules` and the bot replies `ready`, or `error{reason:"unsupported_rules"}`.
- Session: `start` → `suggest` → `suggestion` → **`advance`** (there is no `play` message) → `new_piece`… → `stop`. `quit` ends the process. `board` replaces the board mid-session if the bot advertises `capabilities.board`.
- `start`: `{board, active, queue, hold, combo, back_to_back, piece_stream?, incoming_garbage?, extensions?}`. The board is `board_size.height` rows, bottom-up; a cell is `null` or any string (`"G"` for garbage).
- `suggest`: `{incoming_garbage?, extensions?}`. `suggestion`: `{moves:[{location:{piece,orientation,x,y}, spin:"none"|"mini"|"full"}]}`. The moves are in **descending preference**, so top-N fits the spec without a new field.
- `advance`: `{move: placement}`.
- `info`: `{topic, data}`. The topics are status, search, warning and debug.
- Extensions are namespaced keys under `extensions`. Use `"b2btrainer.top_n"`, `"b2btrainer.pv"` and `"b2btrainer.b2b_plan"` rather than the bare names in the doc.
- Default spawn is `(4, 20)`. We send `(4, 21)` as Minorail does, which matches Triangle's spawn (see §4).

Rules message to send (the same as Minorail's `tetrio.settings.toml`):

```json
{"type":"rules","randomizer":"seven_bag","kickset":"srs_plus","rot180":true,"sonic_drop":"only","spin_detection":"all-mini+","back_to_back_sources":["quad","t-spin","t-spin-mini","allspin","allspin-mini","perfect-clear"],"spawn_position":{"x":4,"y":21},"board_size":{"width":10,"height":40}}
```

## 3. Frostetra

- CLI: `frostetra [--config path.json]` (`-c`). The config is merged over the embedded `src/config/default.json`, which has three sections: `behavior`, `search` and `behaviors.freestyle`.
- `main.rs` calls `unwrap()` on every stdin JSON parse, so **a malformed line crashes the bot**. The bridge must only send valid JSON lines and restart the bot on exit.
- Search budget: `search.budget = {mode:"background", node_limit}` | `{mode:"iterations_per_suggest", iterations}` | `{mode:"nodes_per_suggest", nodes}`. RNG: `search.rng = {mode:"entropy"} | {mode:"seeded", seed}`. Hints use `iterations_per_suggest` with a seeded RNG so they're deterministic.
- Freestyle weight names (src/bot/behavior/freestyle/weights.rs): `has_back_to_back` (default 0.52), `back_to_back_depth` (0.06), `back_to_back_clear` (1.35), `normal_clears[5]`, `t_spin_clears[4]`, `t_spin_mini_clears[4]`, `allspin_clears[4]`, `perfect_clear`, `wasted_t`, `tslot[4]`, …
- `suggest` returns `children.first()` only (src/search/dag/known.rs:45). This is the fork point for top-N.
- Piece cells (src/tetris/model/piece.rs) match the SBP north table exactly.

## 4. Triangle → SBP anchor mapping

SBP orientation: Triangle rotation 0 = `north`, 1 = `east`, 2 = `south`, 3 = `west`.
SBP anchor = `(tri.x + ox, tri.y + oy)`, where `tri.x` and `tri.y` are `falling.x` and the floored `falling.y`:

| Piece | rot 0 | rot 1 | rot 2 | rot 3 |
| --- | --- | --- | --- | --- |
| I | (1,−1) | (2,−1) | (2,−2) | (1,−2) |
| O | (0,−1) | (0,0) | (1,0) | (1,−1) |
| J L S T Z | (1,−1) | (1,−1) | (1,−1) | (1,−1) |

I derived this by matching cell sets. M4 pins it with unit tests. Check: T spawns at tri (3, 22), which gives SBP (4, 21). That matches `spawn_position`.

O caveat: all four SBP O orientations have the same shape, but each one's anchor sits in a different place. Cell sets, not anchors, decide whether two placements are equal (`verify/` compares cells).

## 5. Verification (M4)

- Spin is decided when the piece rotates (`#__internal_rotate` → `lastSpin`). Any successful move, soft drop or one-row fall clears it (index.ts:707, 1123–1147), including the hard drop's own fall. A spin only counts if the last input is a rotation and the piece is already resting.
- So the reachability search state is `(x, y, rotation, lastSpin)`. `verify/search.ts` runs BFS over `press()` on one engine and saves/restores only the falling piece and `lastSpin`, so it never clones the engine per node. It runs in about 2–10 ms per piece.
- Press-mode BFS has no gravity and no lock delay. It ignores the 15-move lock-reset limit and the kick restriction after more than 30 rotations. Shortest paths are short, so this hasn't mattered.
- `verifyPlacement` replays the chosen path on a real clone for Triangle's own `LockRes`. A spin-label disagreement on a lock that clears no lines is accepted as a "soft" mismatch and logged (it can't affect B2B). On a clearing lock it's rejected.
- Cross-check: the real Frostetra on all 21 golden positions plus 150 seeded self-play pieces (27 spin clears) gave 0 rejects and 0 spin mismatches.

## 6. Frostetra fork (M5): local branch `b2b-trainer` in `frostetra/`

The commits are local only (aa718f3, 88d106c). Every change sits behind namespaced `suggest.extensions`, so plain SBP/1 output is byte-identical (tested in `tests/b2b_trainer_ext.rs`).

| Request key | Effect | Response key |
| --- | --- | --- |
| `b2btrainer.top_n: n` | first n root children (already sorted best-first) | `moves` |
| `b2btrainer.pv: true \| depth` | best-child walk through the known-piece layers | `extensions["b2btrainer.pv"]` |
| `b2btrainer.pv_all: true` | one line per top-N move, from the same tree | `extensions["b2btrainer.pvs"]` |
| `b2btrainer.iterations: n` | per-request iterations budget (clamped 100–1e6) | (none) |

- The first planner made 3 requests per hint, each a fresh search: p95 ≈ 1.9 s at 10k iterations. `pv_all` makes it 1 request. Search time grows roughly linearly with iterations on mid-game boards (1k: 28 ms, 3k: 100 ms, 10k: 450 ms).
- Default hint budget is 4000 iterations. Over 40 positions from a seeded game: median 92 ms, p95 278 ms, 39/40 positions with a B2B plan. Adjustable via `settings.hint.searchIterations`.
- `bot-config/b2b.json` holds the B2B weights preset. It raises has_back_to_back, back_to_back_clear and back_to_back_depth, penalizes plain 1–3 line clears, and makes minis positive. The override replaces the whole freestyle block, so every weight is listed. These are starting values, not tuned.

## 7. Strategy B: B2B beam planner (M6)

Module `frostetra/src/bot/behavior/b2b_plan/`. It runs in `Bot::suggest`, because that's where the known queue lives, and only when a request asks for it.

| Request key | Effect | Response key |
| --- | --- | --- |
| `b2btrainer.b2b_plan: true \| {max_depth, beam_width, top_n, length_penalty, spin_bonus}` | beam search to the next B2B clear (defaults 64→known pieces, 300, 3, 0.6, 0.5). `false` or anything else = off | `extensions["b2btrainer.b2b_plans"] = [{moves, final_clear:{lines, spin, b2b_class, perfect_clear}, score}]`, best first |

- Search: each layer expands the next piece and the reserve (hold) piece with `find_moves`. A clear outside the B2B sources prunes the branch. A B2B-source clear ends it as a plan. Non-clearing children are deduped by `GameState` and the best `beam_width` (reward + eval) are kept.
- Score = accumulated freestyle rewards + leaf eval + `spin_bonus` (any spin finish) − `length_penalty`·(k−1).
- Known pieces = the bot queue + the piece left in reserve, which can still be placed as a final step. With an empty hold Frostetra models the active piece as the reserve, so that's active + 5 previews (6). With a hold piece it's 7. The app sends `max_depth` to match.
- Plans returned have distinct finishing placements, so `[` / `]` cycling shows different finishes rather than reorderings of the same setup.
- The response still carries `moves` from the regular search. The app uses `moves[0]` as the no-plan fallback and runs that search at only `BEAM_FALLBACK_ITERATIONS` = 500. At 4000 iterations its p95 is about 400 ms. The beam at width 300 is steady at about 50 ms median and 65 ms p95.
- Measured over 40 positions of seed 77 (`crosscheck.test.ts`): beam finds a plan in 40/40 positions, all 40 have ≥2 plans to cycle, 0 rejects, end-to-end median 138 ms, p95 202 ms. pv-walk on the same run: 40/40, p95 ≈ 500 ms. Verify (TS BFS) is about 70 ms median and 140 ms p95 of either total.
- Beam finds a verified plan on all 19 golden positions that have a B2B finish (T, S, Z, L, J, I spins, quads, PC).

### Movegen fix (the one change to plain SBP/1 output)

`find_moves` in sonic-drop-only mode skipped every intermediate position above the stack, because a plain drop reaches it anyway. That also threw away the *rotated-in* version, which carries a spin. So Frostetra listed a T-spin mini against the wall (golden "T-spin mini single (wall)") only as a plain single. Triangle and TETR.IO score the rotation as a mini. Fix (`finder.rs::update_position`): only skip above-stack positions with `spin == None`. Movegen benchmarks move −7%…+10% (noise level, about 1 µs per call), and search timing is unchanged. Self-play still has 0 rejects and 0 spin mismatches (29 spin clears in 150 pieces, was 27). Regression test: `b2b_plan::tests::finds_a_wall_t_spin_mini_whose_cells_a_plain_drop_also_reaches`.

### App

- `settings.hint.strategy` defaults to `"beam"`, and `settings.hint.beamWidth` is 300 (clamped 10–5000). Profiles saved before M6 have no `beamWidth`. Their `"pv-walk"` was only the old default, since there was no UI for it, so they move to `"beam"`. Both have controls in the Hints tab since M7.
- Every beam plan is replayed through `walkLine`. A plan that doesn't verify as a B2B finish is dropped, counted in `rejected` and logged (`plan-outcome` or the verify reason).

## 8. Polish (M7)

### Settings

The dialog has four tabs: Handling, Controls, **Hints** (after-lock behavior, full plan or step 1, pause while shown, planner, beam width or search iterations, plans to cycle) and **Practice** (seed, garbage mode, lines per event, interval). Deep links: `#settings-hints`, `#settings-practice`. The seed applies on the next restart; everything else applies live.

### Hint lifetime and stats

- Triangle's `LockRes` has no cells, so `GameSession` wraps its engine's `board.add` (called once per lock, before lines clear) and puts the placed cells on every `LockEvent` as `cells`.
- A lock counts toward "Step 1" only if a hint for that exact mirror version is on screen. It matches when its cells equal the shown plan's step 1 (the plan picked with `[` / `]`, or the fallback move). `planner/hint-stats.ts`.
- `auto-refresh`: after a matched step 1, the app requests a new hint for the new position (not counted in "Hints"). Otherwise the hint is cleared.
- `pauseWhileShown`: pressing the hint key pauses the session from "Thinking…" onward. The first game keydown resumes and is still delivered, so the move counts. The pause key also resumes. Restart, undo and redo clear it.

### Garbage practice

- `GameSession.setGarbage({mode, amount, interval})` sends `amount` lines with `engine.receiveGarbage()` every `interval` seconds of engine frames, so paused time doesn't count. The garbage behaves as an opponent's attack does in Triangle: 20-frame travel time, cancelled by the player's attack, rises at the next non-clearing lock, at most 8 lines per lock (`cap.value`).
- Holes come from the queue's `messiness` (`rules.ts::garbageMessiness`): clean = `within 0, change 1` (one column per event), cheese = `within 1, nosame` (a new column every line). The session writes it onto `engine.garbageQueue.options` so mode changes apply live.
- Planning ignores incoming garbage. The bot isn't sent `incoming_garbage`, and `mirrorFromSnapshot` empties the snapshot's garbage queue, because otherwise verify would tank it on step 1 and shift every later step. The mirror keeps the count (`incomingGarbage`) and the hint note says the plan ignores it.

### Not done

Tauri packaging (optional in Design_Doc §9) is not started. The app still needs `npm run dev` (bridge + Vite).
