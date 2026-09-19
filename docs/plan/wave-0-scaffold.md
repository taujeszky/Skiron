# Wave 0 — Scaffold

**Goal.** A SvelteKit + TypeScript + Vitest project that installs, tests, type-checks,
runs and builds on this machine, with nothing of the game in it yet.

**Prerequisites.** None. The folder already holds `README.md`, `CLAUDE.md`, `.gitignore`,
`docs/plan/` and an initialised git repository on `main` with no commits.

**Size.** Small — an hour or two, most of it the Windows-on-ARM install dance.

## Tasks

1. **Project files.** Model them on `../newsignpost`, minus everything Tauri:
   `package.json`, `svelte.config.js` (adapter-static with an SPA fallback),
   `vite.config.js`, `tsconfig.json`, a standalone `vitest.config.ts` that aliases `$lib`
   by hand and does not load the SvelteKit plugin, `src/app.html`, `src/app.css` with
   light and dark `:root` blocks, `src/routes/+layout.ts` with SSR off and prerender on,
   and a placeholder `+page.svelte`. Scaffolding into a temporary folder and moving files
   across is fine; do not overwrite the existing README, CLAUDE.md or .gitignore.
2. **Scripts:** `dev`, `build`, `preview`, `check`, `test`, `test:watch`, `sim` (stub until
   wave 3), `deploy` (`npm run build && wrangler pages deploy build
   --project-name=skiron`), and `postinstall` running `scripts/patch-workerd.cjs`.
3. **Install with `npm install --ignore-scripts`.** wrangler's `workerd` has no
   win32-arm64 binary and its install script aborts the whole install. Copy
   `scripts/patch-workerd.cjs` from `../newsignpost/scripts/` and run it. Never use
   `wrangler dev` here.
4. **Dev port.** Strict port **1430**, so it never collides with Signpost's 1420.
5. **A TypeScript runner for Node tools.** `tools/sim.mjs` and the authoring CLI will
   import engine TypeScript. Pick `tsx` or `vite-node`, confirm it runs on win32-arm64
   after an `--ignore-scripts` install, and record the choice in CLAUDE.md.
   *Chosen: `vite-node --config vitest.config.ts`, so the tools resolve `$lib` through
   the same standalone config the tests use. Verified on win32-arm64.*
6. **PWA shell.** `static/manifest.webmanifest`, placeholder icons, and no service worker
   yet (wave 4 does offline properly — see Signpost's ARCHITECTURE.md §7 for the
   worker-chunk trap before you get there).
7. **One real test.** `src/lib/engine/rng.ts` with seeded xoshiro128** and a test that the
   same seed gives the same sequence. It proves the Vitest pipeline and is needed by wave 1
   anyway.
8. **Update CLAUDE.md:** replace the "planned commands" with the commands as they really
   are, and note anything the install taught you.

## Exit criteria

- `npm test` green, `npm run check` at 0 errors 0 warnings, `npm run build` writes
  `build/`, `npm run dev` serves the placeholder on :1430.
- No deploy yet.

## What the install actually taught us (2026-09-19)

- `--ignore-scripts` alone is no longer enough: npm 11.4.2 crashes with
  `Cannot read properties of null (reading 'edgesOut')` resolving the vitest peer set
  (vitest → optional peer `@vitejs/devtools-vitest` → `vitest@*` → vitest 5 → optional
  peer `@vitest/browser-playwright`). `--legacy-peer-deps` sidesteps it; pinning exact
  versions does not. Both flags are now in CLAUDE.md.
- Versions are pinned exactly to the set Signpost has proven here, rather than carets.
- The adapter's SPA fallback is `404.html`, not `index.html`: with the layout
  prerendering, an `index.html` fallback overwrites the real home page with an empty
  shell.
