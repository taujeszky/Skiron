/**
 * Generation simulator. Wave 3 fills this in: generate N cases per preset and
 * print the table (success rate per attempt, time p50/p95, actual-tier spread,
 * essential clue count, clue-type mix, bank size, par, simulation retries,
 * final-assertion failures) that the presets are tuned from.
 *
 * Run with `npm run sim`, which drives it through vite-node so it can import
 * engine TypeScript with the $lib alias.
 */
import { RNG } from "$lib/engine/rng";

console.log("sim: nothing to measure yet — the generator lands in wave 3.");
console.log(`(the TS runner works: RNG("check").int(1000) = ${new RNG("check").int(1000)})`);
