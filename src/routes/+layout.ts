// A static SPA: no SSR (the engine and the stores are browser/worker code),
// but the shell itself is prerendered so a cold load has something to paint.
export const ssr = false;
export const prerender = true;
