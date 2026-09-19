/**
 * Scratch inspector: look at a floor plan and, once wave 1's simulation
 * lands, at a whole evening. Nothing depends on this file — it exists so that
 * "is the map sane?" and "does that world look right?" can be answered by
 * eye instead of by staring at a failing assertion.
 *
 *   npx vite-node --config vitest.config.ts tools/inspect.mjs -- \
 *     --rooms 7 --slots 6 --suspects 4 --seed abc [--lying] [--svg out.svg]
 *
 * vite-node is what makes the `$lib` alias and the TypeScript imports work.
 */
import { writeFileSync } from "node:fs";

const USAGE = [
  "usage: inspect.mjs -- [--rooms N] [--slots T] [--suspects K]",
  "                     [--seed S] [--lying] [--svg PATH]",
].join("\n");

const NUMERIC = { rooms: [2, 16], slots: [2, 8], suspects: [1, 7] };

function parseArgs(argv) {
  // Depending on how the runner treats it, the "--" separator may or may not
  // still be in argv, and the script path may lead the list.
  const sep = argv.lastIndexOf("--");
  const rest = (sep >= 0 ? argv.slice(sep + 1) : argv).filter(
    (a) => !a.endsWith("inspect.mjs"),
  );
  const out = {
    rooms: 7,
    slots: 6,
    suspects: 4,
    seed: "inspect",
    lying: false,
    svg: null,
    help: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--help" || flag === "-h") {
      out.help = true;
      continue;
    }
    if (flag === "--lying") {
      out.lying = true;
      continue;
    }
    if (!flag.startsWith("--")) return { error: `stray argument "${flag}"` };
    const name = flag.slice(2);
    const value = rest[++i];
    if (value === undefined) return { error: `${flag} wants a value` };
    if (name === "seed") out.seed = value;
    else if (name === "svg") out.svg = value;
    else if (name in NUMERIC) {
      const n = Number(value);
      const [lo, hi] = NUMERIC[name];
      if (!Number.isInteger(n) || n < lo || n > hi) {
        return { error: `${flag} wants an integer ${lo}..${hi}` };
      }
      out[name] = n;
    } else return { error: `unknown flag ${flag}` };
  }
  return out;
}

/**
 * A note rather than a crash, so a module another wave is still writing can
 * be missing. The reason is kept: "not written yet" and "written but broken"
 * look identical from here otherwise.
 */
async function tryImport(specifier) {
  try {
    return { mod: await import(specifier) };
  } catch (err) {
    return { mod: null, why: String(err.message).split(/\r?\n/)[0] };
  }
}

function pad(text, width) {
  const s = String(text);
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

/**
 * Rows are people, columns are slots, cells are room ids. The murder slot's
 * column header and the culprit's and victim's rows carry the flags; the
 * body's room is not blanked out, because "where the body lies" is exactly
 * what `loc` says from the murder on.
 */
function worldTable(frame, world) {
  const label = (p) => (p === frame.victim ? "V" : `p${p}`);
  const header = ["   "];
  for (let t = 0; t < frame.slots; t++) {
    header.push(pad(`t${t}${t === world.murderSlot ? "*" : ""}`, 5));
  }
  const lines = [header.join("")];
  for (let p = 0; p < frame.people; p++) {
    const cells = [pad(label(p), 3)];
    for (let t = 0; t < frame.slots; t++) cells.push(pad(world.loc[p][t], 5));
    const notes = [];
    if (p === world.culprit) notes.push("culprit");
    if (p === frame.victim) notes.push(`victim, found in r${frame.murderRoom}`);
    const flag = notes.length > 0 ? `   <- ${notes.join(", ")}` : "";
    lines.push(cells.join("") + flag);
  }
  lines.push("");
  lines.push(`* murder slot t${world.murderSlot} in room r${frame.murderRoom}`);
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.log(`${args.error}\n${USAGE}`);
    return;
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const { RNG } = await import("$lib/engine/rng");
  const { noRules } = await import("$lib/engine/types");

  const map = await tryImport("$lib/engine/map");
  if (!map.mod) {
    console.log(`note: $lib/engine/map did not load — ${map.why}`);
    return;
  }
  if (typeof map.mod.buildFloorPlan !== "function") {
    console.log("note: $lib/engine/map has no buildFloorPlan yet.");
    return;
  }

  let plan;
  try {
    plan = map.mod.buildFloorPlan(new RNG(args.seed), { rooms: args.rooms });
  } catch (err) {
    console.log(`note: buildFloorPlan(rng, { rooms }) failed: ${err.message}`);
    console.log("note: adjust tools/inspect.mjs to its real signature.");
    return;
  }

  if (args.svg) {
    if (typeof map.mod.planToSvg !== "function") {
      console.log("note: $lib/engine/map has no planToSvg yet.");
    } else {
      writeFileSync(args.svg, map.mod.planToSvg(plan), "utf8");
      console.log(args.svg);
    }
  } else if (typeof map.mod.planToAscii !== "function") {
    console.log("note: $lib/engine/map has no planToAscii yet.");
  } else {
    console.log(map.mod.planToAscii(plan));
  }

  // Wave 1 writes this module in parallel with the tool; until it exists the
  // plan alone is still worth looking at.
  const world = await tryImport("$lib/engine/world/simulate");
  if (!world.mod) {
    console.log("");
    console.log(`note: world/simulate did not load — ${world.why}`);
    return;
  }
  if (typeof world.mod.simulateTruth !== "function") {
    console.log("");
    console.log("note: $lib/engine/world/simulate has no simulateTruth yet.");
    return;
  }

  const truth = world.mod.simulateTruth(new RNG(`${args.seed}:world`), {
    plan,
    rules: noRules(),
    suspects: args.suspects,
    slots: args.slots,
    lying: args.lying,
  });
  console.log("");
  if (!truth) {
    console.log("note: simulateTruth gave up on this seed.");
    return;
  }
  console.log(worldTable(truth.frame, truth.world));
  console.log(`retries ${truth.retries}`);
}

await main();
