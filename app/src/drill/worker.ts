/** Generates spin drills off the main thread (a deep drill takes a few hundred ms). */

import { generateDrill, type GenerateOptions } from "./generate";

const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<{ id: number; opts: GenerateOptions }>) => {
  const { id, opts } = e.data;
  let scenario = null;
  try {
    scenario = generateDrill(opts);
  } catch (err) {
    console.error("drill generation failed", err);
  }
  ctx.postMessage({ id, scenario });
};
