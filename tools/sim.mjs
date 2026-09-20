/**
 * Generation simulator: generate N cases per preset and print the table the
 * presets are tuned from. CLAUDE.md's rule is that generator numbers are
 * chosen by measuring, never by feel, and this is the measurement.
 *
 * Run with `npm run sim`, which drives it through vite-node so it can import
 * engine TypeScript with the $lib alias.
 *
 *   npm run sim                  300 cases per preset
 *   npm run sim -- --cases 50    fewer, for a quick look
 *   npm run sim -- --preset hard one preset only
 *   npm run sim -- --strict      throw on a failed certificate
 */
import { generate, BUG_REJECTIONS } from "$lib/engine/generator/generate";
import { allCards } from "$lib/engine/generator/bank";
import { newCaseId } from "$lib/engine/caseId";
import { PRESET_NAMES, PRESETS } from "$lib/engine/solver/difficulty";
import { solve } from "$lib/engine/solver/solve";

/* ------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
const CASES = Number(flag("cases", 300));
const ONLY = flag("preset", null);
const STRICT = argv.includes("--strict");
const names = ONLY ? [ONLY] : PRESET_NAMES;

/* --------------------------------------------------------------- helpers */

const pct = (xs, q) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length === 0 ? 0 : sum(xs) / xs.length);
const pad = (s, n) => String(s).padStart(n);

/** base36 so that consecutive seeds do not share a prefix. */
const seedOf = (i) => (i * 2654435761 >>> 0).toString(36);

/* ------------------------------------------------------------ the run */

console.log(`skiron sim — ${CASES} cases per preset\n`);

const table = [];
for (const name of names) {
  const preset = PRESETS[name];
  const rows = {
    ms: [],
    attempts: [],
    essential: [],
    opening: [],
    bank: [],
    par: [],
    simRetries: [],
    trialNodes: [],
    tier: new Map(),
    playTier: new Map(),
    kinds: new Map(),
    rejections: new Map(),
    lying: 0,
    framed: 0,
    culpritCards: [],
    failed: 0,
    bugs: 0,
  };

  for (let i = 0; i < CASES; i++) {
    const id = newCaseId(name, seedOf(i));
    const t0 = process.hrtime.bigint();
    const out = generate(id, {
      onAssertionFailure: (reason, detail) => {
        rows.bugs++;
        if (STRICT) throw new Error(`${reason}: ${detail}`);
        console.error(`  !! ${reason}: ${detail}`);
      },
    });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    for (const r of out.rejections) {
      rows.rejections.set(r, (rows.rejections.get(r) ?? 0) + 1);
    }
    rows.simRetries.push(out.simRetries);
    if (!out.case) {
      rows.failed++;
      continue;
    }
    const c = out.case;
    rows.ms.push(ms);
    rows.attempts.push(c.attempt + 1);
    rows.essential.push(c.essential.length);
    rows.opening.push(c.opening.length);
    rows.bank.push(allCards(c.bank).length);
    rows.par.push(c.investigation.par);
    rows.tier.set(c.tier, (rows.tier.get(c.tier) ?? 0) + 1);
    rows.playTier.set(c.playTier, (rows.playTier.get(c.playTier) ?? 0) + 1);
    for (const clue of c.essential) {
      rows.kinds.set(clue.body.kind, (rows.kinds.get(clue.body.kind) ?? 0) + 1);
    }
    if (c.alibi) {
      rows.lying++;
      if (c.alibi.framed !== null) rows.framed++;
    }
    rows.culpritCards.push(
      c.essential.filter(
        (k) => k.source.kind === "testimony" && k.source.speaker === c.world.culprit,
      ).length,
    );
    rows.trialNodes.push(solve(c.frame, c.clues, { record: false }).trialNodes);
  }
  table.push({ name, preset, rows });
}

/* ---------------------------------------------------------- the printing */

const spread = (m, lo, hi) => {
  const out = [];
  for (let t = lo; t <= hi; t++) {
    const n = m.get(t) ?? 0;
    if (n > 0) out.push(`${t}:${n}`);
  }
  return out.join(" ") || "-";
};

console.log(
  "preset  made   att  ms p50/p95/max   essential  bank  par  proof tier    play tier",
);
for (const { name, rows } of table) {
  const made = rows.ms.length;
  console.log(
    `${name.padEnd(7)} ${pad(made, 4)}/${CASES}  ` +
      `${mean(rows.attempts).toFixed(2)}  ` +
      `${pad(pct(rows.ms, 0.5).toFixed(0), 4)}/${pad(pct(rows.ms, 0.95).toFixed(0), 5)}/` +
      `${pad(Math.max(0, ...rows.ms).toFixed(0), 5)}  ` +
      `${pad(pct(rows.essential, 0.5), 5)} (${pad(Math.min(...rows.essential), 2)}-${pad(Math.max(...rows.essential), 2)})  ` +
      `${pad(pct(rows.bank, 0.5), 4)}  ${pad(pct(rows.par, 0.5), 3)}  ` +
      `${spread(rows.tier, -1, 4).padEnd(13)} ${spread(rows.playTier, -1, 4)}`,
  );
}

console.log("\nrejections per made case (why an attempt was thrown back)");
const reasons = new Set();
for (const { rows } of table) for (const r of rows.rejections.keys()) reasons.add(r);
const ordered = [...reasons].sort();
console.log(`preset  ${ordered.map((r) => r.padStart(14)).join("")}`);
for (const { name, rows } of table) {
  const made = Math.max(1, rows.ms.length);
  console.log(
    `${name.padEnd(7)} ` +
      ordered
        .map((r) => ((rows.rejections.get(r) ?? 0) / made).toFixed(2).padStart(14))
        .join(""),
  );
}

console.log("\nclue-type mix in the proof set (share of essential cards)");
for (const { name, rows } of table) {
  const total = Math.max(1, sum([...rows.kinds.values()]));
  const mix = [...rows.kinds.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${((100 * n) / total).toFixed(0)}%`)
    .join("  ");
  console.log(`${name.padEnd(7)} ${mix || "-"}`);
}

console.log("\nthe rest");
for (const { name, preset, rows } of table) {
  const made = Math.max(1, rows.ms.length);
  console.log(
    `${name.padEnd(7)} ` +
      `sim-retries/case ${mean(rows.simRetries).toFixed(2)}  ` +
      `trialNodes p50 ${pct(rows.trialNodes, 0.5)} p95 ${pct(rows.trialNodes, 0.95)}  ` +
      `opening ${pct(rows.opening, 0.5)} cards  ` +
      (preset.lying
        ? `alibi ${((100 * rows.lying) / made).toFixed(0)}% ` +
          `(framed ${((100 * rows.framed) / made).toFixed(0)}%) ` +
          `culprit cards p50 ${pct(rows.culpritCards, 0.5)}  `
        : "") +
      `unmade ${rows.failed}  ` +
      `CERTIFICATE FAILURES ${rows.bugs}`,
  );
}

const bugs = sum(table.map(({ rows }) => rows.bugs));
const unmade = sum(table.map(({ rows }) => rows.failed));
console.log("");
if (bugs > 0) {
  console.log(`FAIL: ${bugs} certificate failure(s) — ${BUG_REJECTIONS.join(" or ")}.`);
  process.exitCode = 1;
} else if (unmade > 0) {
  console.log(`${unmade} case(s) could not be made inside the attempt cap.`);
} else {
  console.log("every case made, every certificate passed.");
}
