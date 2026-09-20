/**
 * What the service worker installs, and what it leaves for later.
 *
 * A separate module for one reason: `src/service-worker.ts` imports
 * `$service-worker`, which exists only inside a SvelteKit build, so nothing
 * in it can be reached from a test. The decision that matters — which assets
 * go into the install payload — therefore lives here, where it can be.
 *
 * That matters more than it sounds. The default behaviour is to precache
 * everything under `static/`, and a twelve-case pack's portraits would join
 * the first load unasked, before the visitor has opened a single case. The
 * filter below is the whole of wave 7's task 8, and without a test the only
 * thing standing between it and a silent regression would be somebody
 * remembering to read the generated worker.
 */

/** Anything a browser would decode as a picture. */
export function isImage(path: string): boolean {
  return /\.(webp|png|jpe?g|avif|gif)$/i.test(path);
}

/**
 * The pictures that are part of the shell rather than part of a case.
 *
 * The manifest points at these, so a home-screen install that skipped them
 * would show a blank icon with no way to recover offline. Four files.
 */
export const SHELL_IMAGES = [
  "favicon.png",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
];

/**
 * Matched on the end of the path, not the whole of it.
 *
 * `$service-worker` prefixes every entry with the deployment's base path, so
 * an exact comparison is right only for a site served from the root. It is
 * today and probably always will be, which is exactly why an exact
 * comparison would have sat here unnoticed: the first sub-path deploy would
 * silently stop precaching the icons, and nothing would fail — it would just
 * look wrong offline.
 */
export function isShellImage(path: string): boolean {
  return SHELL_IMAGES.some((name) => path.endsWith(`/${name}`) || path === name);
}

/**
 * The install payload: everything built, plus everything static that is not
 * a case's picture.
 *
 * Pictures are left to the fetch handler, which caches what it fetches. The
 * cost is that the first view of a case needs the network for its faces; the
 * case itself does not, because its JSON is still precached, so it is
 * playable offline from a cold start either way. That is the trade, and it
 * is the right way round: the game is built to be complete without pictures.
 */
export function precacheList(build: readonly string[], files: readonly string[]): string[] {
  return [...build, ...files.filter((path) => !isImage(path) || isShellImage(path))];
}
