/**
 * Reading a shipped pack off the site.
 *
 * Packs live under `static/cases/<name>/`: one `manifest.json` listing the
 * cases, and one file per case. The service worker precaches everything in
 * `static/`, so a pack works offline from the first visit — which is the
 * point of shipping one at all. A player with no key and no network still has
 * cases somebody wrote.
 *
 * **What is not done here: re-proving the case.** `verifyPack` runs the
 * exhaustive oracle, which is a second or so on an Expert case, and doing it
 * on every load would be a visible pause to repeat a proof that has already
 * been made twice — once by `tools/author-case.mjs`, which refuses to write a
 * pack that does not verify, and once by `shipped.test.ts`, which verifies
 * every file in the repository on every `npm test`. A corrupt file fails to
 * decode, and that is the failure this layer is for.
 */

import { decodePack, parseManifest, type CasePack, type PackManifest } from "./pack";

export const DEFAULT_PACK = "starter";

/** Injected by tests; nothing else should touch it. */
let fetcher: typeof fetch | null = null;

export function useFetch(next: typeof fetch | null): void {
  fetcher = next;
}

function get(): typeof fetch | null {
  if (fetcher) return fetcher;
  return typeof fetch === "function" ? fetch : null;
}

async function json(path: string): Promise<unknown | null> {
  const call = get();
  if (!call) return null;
  try {
    const response = await call(path);
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    // No pack shipped, no network on a cold start, a proxy returning HTML:
    // all the same answer, which is that there is nothing to browse.
    return null;
  }
}

/**
 * The list of shipped cases, or null when no pack is shipped.
 *
 * Null rather than an empty list on purpose: the home screen shows nothing at
 * all in that case, rather than an empty shelf with a heading over it.
 */
export async function loadManifest(pack: string = DEFAULT_PACK): Promise<PackManifest | null> {
  const value = await json(`/cases/${pack}/manifest.json`);
  if (value === null) return null;
  const manifest = parseManifest(value);
  return manifest && manifest.cases.length > 0 ? manifest : null;
}

export async function loadPackCase(
  id: string,
  pack: string = DEFAULT_PACK,
): Promise<CasePack | null> {
  // The id comes from the manifest, and `parseManifest` has already refused
  // anything that is not a case number — so it cannot carry a path out of the
  // directory.
  const value = await json(`/cases/${pack}/${id}.json`);
  return value === null ? null : decodePack(value);
}
