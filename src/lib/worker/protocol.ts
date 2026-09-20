/**
 * What passes between the page and the generation worker.
 *
 * The protocol is a pure module on purpose. `genWorker.ts` is six lines of
 * plumbing around `runRequest`, and `genClient.ts` is the promise wrapper, so
 * everything with a decision in it can be tested in Node with no DOM — which
 * is the same split the engine uses everywhere else.
 *
 * **Why a case travels as an id and a result, and not as JSON.** Structured
 * clone carries `Map` and `Set` across a worker boundary, so a `GeneratedCase`
 * goes over whole. It does not survive `JSON.stringify`, which matters for
 * the shipped case packs of a later wave — but a pack does not need to store
 * a case, because a case *is* its id (invariant 4). Store the id and the
 * skin, rebuild the rest.
 */

import type { CaseId } from "../engine/caseId";
import { generate } from "../engine/generator/generate";
import type { GeneratedCase, Rejection } from "../engine/generator/generate";

export interface GenRequest {
  /** Echoed back, so a client can match a reply to a call. */
  token: number;
  id: CaseId;
  maxAttempts?: number;
}

export type GenResponse =
  | {
      token: number;
      ok: true;
      case: GeneratedCase;
      rejections: Rejection[];
      ms: number;
    }
  | {
      token: number;
      ok: false;
      /** Why no case was made: the attempt cap ran out, or a throw. */
      error: string;
      rejections: Rejection[];
    };

/**
 * Do the work. Synchronous: generation is CPU-bound and has nothing to await,
 * which is the whole reason it is put in a worker rather than made async.
 *
 * `performance.now` is used here and nowhere in `engine/` — the purity test
 * reads the engine directory only, and this is a worker measuring itself
 * rather than a generator reaching for the clock.
 */
export function runRequest(req: GenRequest): GenResponse {
  const started = performance.now();
  try {
    const out = generate(req.id, { maxAttempts: req.maxAttempts });
    if (!out.case) {
      return {
        token: req.token,
        ok: false,
        error: `no case for ${req.id.preset}:${req.id.seed} in ${out.rejections.length} attempts`,
        rejections: out.rejections,
      };
    }
    return {
      token: req.token,
      ok: true,
      case: out.case,
      rejections: out.rejections,
      ms: performance.now() - started,
    };
  } catch (err) {
    return {
      token: req.token,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      rejections: [],
    };
  }
}
