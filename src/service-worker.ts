/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/**
 * Offline play, and — the part that takes care — offline *generation*.
 *
 * Skiron has no case pack yet and no backend ever, so "works offline" means
 * the generator has to run, and the generator runs in a Web Worker. Vite
 * emits that worker as its own chunk under `_app/immutable/workers/`, and
 * SvelteKit's `$service-worker` manifest **does not list it**. Precaching the
 * manifest alone therefore gives you an app that opens offline, shows the
 * desk, and then hangs forever on "Building a case" — everything working
 * except the one thing the player came for.
 *
 * What saves it is the cache-first branch keying off `/immutable/` as well as
 * the manifest, so the worker chunk is cached the first time it is fetched
 * and available from then on. Signpost hit this exactly (its ARCHITECTURE
 * section 7) and the note there is what kept it from being found the hard way
 * here. **If you narrow that condition to the manifest, offline generation
 * dies quietly** — quietly because every test that does not cut the network
 * still passes.
 *
 * Precaching is `Promise.allSettled` over individual `cache.add` calls rather
 * than `cache.addAll`, which is all-or-nothing: one unreachable asset would
 * otherwise take the whole worker down and leave the app with no cache at
 * all.
 */

import { build, files, version } from "$service-worker";

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `skiron-${version}`;
/** Everything Vite built, plus everything in `static/`. */
const ASSETS = [...build, ...files];
/** The shell itself, so a cold start with no network has something to open. */
const SHELL = "/";

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled([...ASSETS, SHELL].map((asset) => cache.add(asset)));
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      // With skipWaiting above, this makes a new deploy take effect on one
      // reload rather than two.
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      // Content-hashed assets are cache-first, and the second clause is the
      // one that keeps offline generation alive — see the note at the top.
      const immutable =
        ASSETS.includes(url.pathname) || url.pathname.includes("/immutable/");
      if (immutable) {
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) await cache.put(url.pathname, response.clone());
        return response;
      }

      // Navigations and anything else: network first, cache as a fallback.
      try {
        const response = await fetch(event.request);
        if (response.ok) void cache.put(event.request, response.clone());
        return response;
      } catch {
        const cached =
          (await cache.match(event.request)) ?? (await cache.match(SHELL));
        if (cached) return cached;
        throw new Error("offline, and this was never cached");
      }
    })(),
  );
});
