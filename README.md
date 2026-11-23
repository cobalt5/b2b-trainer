# B2B Trainer

Local practice app for back-to-back play. Design: [Design_Doc.md](Design_Doc.md). Confirmed API facts: [docs/notes.md](docs/notes.md).

## Setup

Requires Node 22+ and a stable Rust toolchain.

```bash
git submodule update --init   # frostetra (pinned to b92dc76)
npm install
npm run build:bot             # cargo build --release in frostetra/
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Bridge (ws://127.0.0.1:8765) + Vite dev server at http://127.0.0.1:5173 |
| `npm test` | App unit tests (vitest) + bridge integration tests and smoke test (need the bot binary) |
| `npm run typecheck` | Typecheck app and bridge |
| `npm run smoke -w bridge` | Verbose SBP handshake + one suggestion against Frostetra |
| `npm run start -w bridge` | Bridge only. Env overrides: `BRIDGE_PORT`, `BOT_PATH`, `BOT_CONFIG` |

Press **Tab** (rebindable) for a hint. The mirror board outlines the placements up to the next B2B-keeping clear, numbered in order. Press **[** / **]** to cycle through the top 3 plans. The header shows the bridge/bot status. Plans come from the bot's B2B beam planner (`settings.hint.strategy: "beam"`). The older principal-variation walk is still available as "Bot line" in Settings → Hints.

Settings (**F1**) also has hint options (clear, keep or auto-refresh after a lock; pause while shown; planner budget) and practice options (fixed seed; clean or cheese garbage every N seconds). The stats panel shows the B2B streak, Surge, hints used and how often your next piece matched hint step 1.

## Layout

```
app/         Vite + TS frontend (game-core, render, adapter, verify, planner, ui)
bridge/      Node: spawns Frostetra, relays SBP
bot-config/  Frostetra --config overrides
frostetra/   bot (git submodule)
docs/        notes
```
