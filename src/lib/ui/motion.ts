/**
 * Does this person want things to stop moving?
 *
 * CSS answers this for itself with `@media (prefers-reduced-motion: reduce)`,
 * and two animations already do — the loading spinner and a card's arrival.
 * What CSS cannot reach is motion driven from JavaScript, and the summary
 * screen's replay is exactly that: a `setInterval` walking the evening
 * forward one slot at a time, which starts on its own the moment the case is
 * solved. It is the one the plan named, and it was the one still missing.
 *
 * Behind a module because it is a browser API and the plan asks for those to
 * sit where a Tauri shell can replace them, and because a test needs to be
 * able to say yes.
 */

/** Overridden by tests; nothing else should touch it. */
let forced: boolean | null = null;

export function useReducedMotion(value: boolean | null): void {
  forced = value;
}

/**
 * True when the platform asks for reduced motion.
 *
 * Read at the moment it is needed rather than kept in a store: it is consulted
 * when a screen mounts, a person who changes the setting mid-case is vanishingly
 * rare, and a live `matchMedia` listener would be more moving parts than the
 * question deserves. Defaults to false where there is no `matchMedia` at all,
 * which is Node — the safe direction, because the tests that care set it.
 */
export function prefersReducedMotion(): boolean {
  if (forced !== null) return forced;
  if (typeof matchMedia !== "function") return false;
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
