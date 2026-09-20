/**
 * What a player who does not know the answer actually spends.
 *
 * `npm run sim` measures the generator. This measures the *game*: it drives
 * `game/player.ts#blindPlay` — a scripted player that never sees `essential`,
 * `investigation.actions` or the truth — over a batch of cases, and prints
 * the spread of actions it took. That number is what `investigation.ts#parFor`
 * is anchored on, and re-taking it is how par gets re-fitted when the game
 * changes or when real players give a better target to aim at.
 *
 *   npm run par                     40 cases a preset
 *   npm run par -- --cases 10       quicker
 *   npm run par -- --preset expert  one preset
 *   npm run par -- --weights 0,3    compare lead-following weights; see
 *                                   `player.ts#DEFAULT_LEAD_WEIGHT` for why
 *                                   the answer so far is zero
 *
 * It is slow — a full solve per action per case — so a hundred Expert cases
 * is a coffee, not a keystroke.
 */
import { generate } from "$lib/engine/generator/generate";
import { newCaseId } from "$lib/engine/caseId";
import { actionMenuSize } from "$lib/engine/generator/investigation";
import { PRESET_NAMES } from "$lib/engine/solver/difficulty";
import { blindPlay } from "$lib/game/player";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const CASES = Number(flag("cases", 40));
const ONLY = flag("preset", null);
const WEIGHTS = flag("weights", "").split(",").filter(Boolean).map(Number);
const names = ONLY ? [ONLY] : PRESET_NAMES;

const pct = (xs, q) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const mean = (xs) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const pad = (s, n) => String(s).padStart(n);

/** base36 so that consecutive seeds do not share a prefix. */
const seedOf = (i) => ((i * 2654435761) >>> 0).toString(36);

/** Pearson r: does a longer proof mean a longer search? (It barely does.) */
function corr(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

console.log(`skiron par — ${CASES} cases per preset, an undirected player\n`);

const built = new Map();
for (const name of names) {
  const made = [];
  for (let i = 0; i < CASES; i++) {
    const out = generate(newCaseId(name, seedOf(i)));
    if (out.case) made.push(out.case);
  }
  built.set(name, made);
}

const run = (name, weight) => {
  const made = built.get(name);
  const essential = [];
  const pars = [];
  const spent = [];
  let stuck = 0;
  for (const c of made) {
    essential.push(c.investigation.actions.length);
    pars.push(c.investigation.par);
    const rec = blindPlay(c, weight === null ? {} : { leadWeight: weight });
    if (!rec.solved) stuck++;
    spent.push(rec.actions.length);
  }
  const menu = made.length > 0 ? actionMenuSize(made[0].frame) : 0;
  console.log(
    [
      pad(name, 8),
      pad(made.length, 7),
      pad(menu, 6),
      pad(mean(essential).toFixed(1), 11),
      pad(mean(pars).toFixed(1), 6),
      pad(pct(spent, 0.5), 8) + "/" + pad(pct(spent, 0.9), 4) + "/" + pad(mean(spent).toFixed(1), 7),
      pad(corr(essential, spent).toFixed(2), 8),
      pad(stuck, 7),
    ].join(""),
  );
};

const header =
  "  preset  cases  menu  essential   par  spent p50/ p90/   mean  r(ess)  stuck";

if (WEIGHTS.length === 0) {
  console.log(header);
  for (const name of names) run(name, null);
  console.log(
    "\npar is `essential * 1.5 + menu * 0.2` — see investigation.ts for the argument.",
  );
} else {
  for (const w of WEIGHTS) {
    console.log(`lead weight ${w}`);
    console.log(header);
    for (const name of names) run(name, w);
    console.log("");
  }
}

console.log("stuck must be 0: a case an undirected player cannot finish is a bad case.");
