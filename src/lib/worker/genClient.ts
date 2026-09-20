/**
 * Generating a case from the page, without freezing it.
 *
 * One worker per request, terminated when the request settles. That sounds
 * wasteful and is not: a worker costs a few milliseconds to start against a
 * generation that costs hundreds, and it makes **cancel** mean something.
 * Generation is one synchronous burn with nothing to await, so a cooperative
 * cancel flag could never be read; terminating the thread is the only way to
 * stop it, and a thread that is going to be terminated may as well be a fresh
 * one.
 *
 * This module is the only place in `lib/` that needs a browser. It is kept
 * apart from `engine/` and from `protocol.ts` so that everything with a
 * decision in it stays testable in Node.
 */

import GenWorker from "./genWorker?worker";
import type { GenRequest, GenResponse } from "./protocol";
import type { CaseId } from "../engine/caseId";
import type { GeneratedCase } from "../engine/generator/generate";

export interface Generation {
  /** Resolves with the case, or rejects — including when cancelled. */
  case: Promise<GeneratedCase>;
  /** Stop the work now. The promise rejects with `CANCELLED`. */
  cancel(): void;
}

export const CANCELLED = "cancelled";

let nextToken = 1;

export function generateInWorker(
  id: CaseId,
  opts: { maxAttempts?: number } = {},
): Generation {
  const worker = new GenWorker();
  const token = nextToken++;
  let settle: (() => void) | null = null;

  const promise = new Promise<GeneratedCase>((resolve, reject) => {
    settle = () => {
      worker.terminate();
      reject(new Error(CANCELLED));
    };
    worker.addEventListener("message", (event: MessageEvent<GenResponse>) => {
      const reply = event.data;
      // A stale reply cannot happen with one worker per request, but the
      // token costs nothing and makes the invariant checkable rather than
      // assumed.
      if (reply.token !== token) return;
      worker.terminate();
      settle = null;
      if (reply.ok) resolve(reply.case);
      else reject(new Error(reply.error));
    });
    worker.addEventListener("error", (event: ErrorEvent) => {
      worker.terminate();
      settle = null;
      reject(new Error(event.message));
    });
  });

  const request: GenRequest = { token, id, maxAttempts: opts.maxAttempts };
  worker.postMessage(request);

  return {
    case: promise,
    cancel: () => settle?.(),
  };
}
