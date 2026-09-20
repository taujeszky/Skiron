/**
 * Getting a case, from a page that must not freeze.
 *
 * Generation is a synchronous burn — 12 ms for an Easy case, up to a second
 * for the worst Expert one measured (ARCHITECTURE.md section 9) — so on the
 * main thread the longest ones would drop a second of frames and swallow the
 * spinner meant to cover them. The worker exists for that, and the reason
 * this module exists on top of it is that the worker cannot run in Node:
 * `genClient.ts` imports `./genWorker?worker`, which is a Vite instruction
 * and not a module specifier. So the import is dynamic and only ever reached
 * in a browser, and every test gets the inline path.
 *
 * **Everything goes through the worker in the browser, even the 12 ms ones.**
 * A worker costs single-digit milliseconds to start, and one code path that
 * always shows a spinner and always supports cancel is worth more than the
 * few frames a special case for Easy would save.
 */

import type { CaseId } from "$lib/engine/caseId";
import { generate } from "$lib/engine/generator/generate";
import type { GeneratedCase } from "$lib/engine/generator/generate";

export interface Loading {
  /** Resolves with the case, or rejects — including on cancel. */
  case: Promise<GeneratedCase>;
  cancel(): void;
}

export const CANCELLED = "cancelled";

/** How a case is obtained. Swapped in tests, and by the headless harness. */
export type CaseLoader = (id: CaseId) => Loading;

function inline(id: CaseId): Loading {
  let live = true;
  const promise = new Promise<GeneratedCase>((resolve, reject) => {
    // A microtask, so that `loadCase` returns its handle before the work
    // starts and a caller can wire `cancel` up. It buys no paint — a
    // microtask runs before rendering, and generation blocks the thread
    // either way, which is exactly why the browser does not take this path.
    queueMicrotask(() => {
      if (!live) {
        reject(new Error(CANCELLED));
        return;
      }
      try {
        const out = generate(id);
        if (!out.case) {
          reject(
            new Error(
              `no case for ${id.preset}:${id.seed} after ${out.rejections.length} attempts`,
            ),
          );
          return;
        }
        resolve(out.case);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
  return {
    case: promise,
    cancel: () => {
      live = false;
    },
  };
}

function inWorker(id: CaseId): Loading {
  let stop: (() => void) | null = null;
  // A cancel can arrive before the dynamic import lands, and there is no
  // worker to terminate yet. The flag is what makes that window safe: the
  // import completes and then declines to start one.
  let cancelled = false;
  const promise = (async () => {
    const { generateInWorker } = await import("$lib/worker/genClient");
    if (cancelled) throw new Error(CANCELLED);
    const run = generateInWorker(id);
    stop = run.cancel;
    return run.case;
  })();
  return {
    case: promise,
    cancel: () => {
      cancelled = true;
      stop?.();
    },
  };
}

let loader: CaseLoader | null = null;

/** Override how cases are obtained. The headless play-through uses this. */
export function useLoader(next: CaseLoader | null): void {
  loader = next;
}

export function loadCase(id: CaseId): Loading {
  if (loader) return loader(id);
  return typeof Worker === "undefined" ? inline(id) : inWorker(id);
}

/** Straight through, for tests and tools that do not mind blocking. */
export function loadCaseInline(id: CaseId): Loading {
  return inline(id);
}
