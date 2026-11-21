/**
 * M0 smoke test: build check for Frostetra + SBP handshake + one suggestion
 * on an empty board. Exits non-zero on failure.
 */
import { emptySbpBoard, TRAINER_RULES, type SuggestionMsg } from "../../app/src/adapter/sbp-types.ts";
import { BotProcess } from "./bot.ts";

const quiet = process.argv.includes("--quiet");
const log = (...a: unknown[]) => quiet || console.log(...a);

const bot = new BotProcess();
bot.on("stderr", (l) => log("[bot stderr]", l));

try {
  const reg = await bot.start(TRAINER_RULES);
  log(`register: ${reg.name} ${reg.version ?? ""}`);
  log("capabilities:", JSON.stringify(reg.capabilities));
  log("rules accepted (ready)");

  bot.send({
    type: "start",
    board: emptySbpBoard(),
    active: "T",
    queue: ["I", "O", "L", "J", "S"],
    hold: null,
    combo: 0,
    back_to_back: 0
  });
  const t0 = performance.now();
  bot.send({ type: "suggest" });
  const sug = (await bot.waitFor("suggestion", 10_000)) as SuggestionMsg;
  const ms = (performance.now() - t0).toFixed(0);
  if (!sug.moves.length) throw new Error("empty suggestion");
  log(`suggestion in ${ms} ms:`, JSON.stringify(sug.moves[0]));
  console.log("bridge smoke: OK");
} catch (e) {
  console.error("bridge smoke: FAILED —", (e as Error).message);
  process.exitCode = 1;
} finally {
  await bot.stop();
}
