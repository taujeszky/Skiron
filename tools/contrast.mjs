/**
 * WCAG contrast for both themes, measured rather than eyeballed.
 *
 * Run with `npm run contrast`. Exits non-zero if anything is below its
 * threshold, so it can be run the way `npm run check` is.
 *
 * The rule this follows is CLAUDE.md's: a number that matters is measured and
 * written down. Wave 8's task 3 asks for "contrast in both themes", and the
 * only honest way to answer that is to compute it — looking at the two themes
 * and deciding they seem fine is exactly how the seven failures below went
 * unnoticed for four waves.
 *
 *   npm run contrast          only the failures
 *   npm run contrast -- --all every pair
 *   npm run contrast -- --suggest  a fix for each failure, hue preserved
 *
 * **What the thresholds mean.** 4.5 is AA for normal text and 3.0 is AA for
 * large text and for non-text that carries information — a control's border, a
 * door on the floor plan, a person's coin. Two things are deliberately *not*
 * listed. A panel's own edge is decoration: the panel is identified by its
 * fill and its contents, and 1.4.11 asks about boundaries that are needed to
 * identify a component. And a disabled control is exempt by the specification.
 *
 * **What this cannot do.** It reads the variables out of `app.css` and pairs
 * them up by hand, so a pair nobody listed is a pair nobody checked, and a
 * colour applied with an `opacity` beside it is measured without the opacity.
 * That second one is not hypothetical: a crossed-out room code was listed here
 * and passing at 2.26 while rendering at 0.55 opacity, which is why
 * `Grid.svelte` no longer has the opacity.
 */

import { readFileSync } from "node:fs";

const css = readFileSync("src/app.css", "utf8");

function block(re, what) {
  const m = re.exec(css);
  if (!m) throw new Error(`no ${what} block in src/app.css`);
  const vars = {};
  for (const line of m[1].split("\n")) {
    const v = /--([\w-]+):\s*([^;]+);/.exec(line);
    if (v) vars[v[1]] = v[2].trim();
  }
  return vars;
}

const light = block(/:root\s*\{([\s\S]*?)\n\}/, "light");
const dark = block(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/, "dark");

const rgb = (hex) => {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Every foreground-on-background pair the game actually renders. */
const PAIRS = [
  ["text", "bg", 4.5, "body text on the page"],
  ["text", "panel", 4.5, "body text on a panel"],
  ["text-dim", "bg", 4.5, "dimmed text on the page"],
  ["text-dim", "panel", 4.5, "dimmed text on a panel"],
  ["accent", "bg", 4.5, "accent text on the page"],
  ["accent", "panel", 4.5, "accent text on a panel"],
  ["accent-text", "accent", 4.5, "a primary button's label"],
  ["danger", "panel", 4.5, "an error sentence"],
  ["ok", "panel", 4.5, "a success sentence"],
  ["warn", "panel", 4.5, "a warning sentence"],
  // A control's edge, unlike a panel's, is often the only thing that says a
  // control is there: an input is `background: var(--bg)` on a `--bg` page.
  ["control-border", "panel", 3.0, "a button's edge"],
  ["control-border", "bg", 3.0, "a text box's edge"],
  ["room-label", "room-fill", 4.5, "a room's name on the plan"],
  ["wall", "plan-bg", 3.0, "a wall"],
  ["door", "plan-bg", 3.0, "a door"],
  ["door-closed", "plan-bg", 3.0, "a locked door"],
  ["pencil", "cell-bg", 4.5, "a pencil mark in the notebook"],
  ["cell-out", "cell-bg", 4.5, "a crossed-out room code"],
  ["canon", "card-bg", 4.5, "the canonical form under a card"],
  ["card-fact", "card-bg", 3.0, "a fact card's stripe"],
  ["card-testimony", "card-bg", 3.0, "a testimony card's stripe"],
  ["card-rule", "card-bg", 3.0, "a rule card's stripe"],
];

// The eight person colours are small marks, so 3.0 on the two surfaces they
// are drawn on. `look.ts` already refuses to let colour be the only difference
// between two people — the letter is — but a mark still has to be visible.
for (let i = 0; i < 8; i++) {
  PAIRS.push([`p${i}`, "panel", 3.0, `person ${i}'s colour on a panel`]);
  PAIRS.push([`p${i}`, "room-fill", 3.0, `person ${i}'s coin on the plan`]);
}
PAIRS.push(["victim", "room-fill", 3.0, "the victim's coin on the plan"]);

/* ------------------------------------------------- nudging a failing colour */

function toHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0;
  let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function toHex([h, s, l]) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** The nearest colour of the same hue that clears the threshold. */
function nudge(fg, bg, need) {
  const [h, s, l0] = toHsl(rgb(fg));
  const darker = lum(bg) > lum(fg);
  for (let i = 1; i <= 200; i++) {
    const l = darker ? Math.max(0, l0 - i / 400) : Math.min(1, l0 + i / 400);
    const hex = toHex([h, s, l]);
    if (ratio(hex, bg) >= need) return hex;
  }
  return null;
}

/* ------------------------------------------------------------------- run */

const ALL = process.argv.includes("--all");
const SUGGEST = process.argv.includes("--suggest");

let failures = 0;
let checked = 0;
for (const [name, vars] of [
  ["light", light],
  // The dark block only overrides what it changes, so it inherits the rest.
  ["dark", { ...light, ...dark }],
]) {
  console.log(`\n=== ${name} ===`);
  for (const [fg, bg, need, what] of PAIRS) {
    const a = vars[fg];
    const b = vars[bg];
    if (!a || !b || !a.startsWith("#") || !b.startsWith("#")) {
      console.log(`  ?    ${what} — ${fg} on ${bg} is not a plain hex`);
      continue;
    }
    checked++;
    const r = ratio(a, b);
    const ok = r >= need;
    if (!ok) failures++;
    if (!ok || ALL) {
      console.log(
        `  ${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)} / ${need.toFixed(1)}  ` +
          `${what}  [${fg} on ${bg}]`,
      );
      if (!ok && SUGGEST) {
        const fix = nudge(a, b, need);
        console.log(
          `        try --${fg}: ${fix} (${fix ? ratio(fix, b).toFixed(2) : "no value works"})`,
        );
      }
    }
  }
}

console.log(
  `\n${checked} pairs checked, ${failures} below threshold` +
    (failures === 0 ? "" : " — run with --suggest for a fix"),
);
process.exit(failures === 0 ? 0 : 1);
