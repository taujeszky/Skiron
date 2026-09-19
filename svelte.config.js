// Static SPA: adapter-static with an index.html fallback, so the whole app is
// one prerendered shell served from Cloudflare Pages. No Tauri yet, but the
// same shape a Tauri shell would want later.
// See: https://svelte.dev/docs/kit/single-page-apps
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      // 404.html, not index.html: the layout prerenders, so index.html is the
      // real home page and this is only the SPA catch-all for a stray deep
      // link. With fallback "index.html" the adapter overwrites the
      // prerendered home with an empty shell.
      fallback: "404.html",
    }),
    serviceWorker: {
      // registered by hand from the app shell (wave 4), never during SSR
      register: false,
    },
  },
};

export default config;
