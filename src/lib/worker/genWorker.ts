/**
 * The generation worker. Everything it knows is in `protocol.ts`; this file
 * is only the wire.
 *
 * It is deliberately this thin. Generation is a synchronous burn of a few
 * hundred milliseconds (see ARCHITECTURE.md §9 for the measured spread), so
 * there is nothing to await and nothing to schedule — the worker exists so
 * the main thread keeps painting, and so a player who changes their mind can
 * have the work stopped dead by terminating it.
 */

import { runRequest } from "./protocol";
import type { GenRequest } from "./protocol";

self.addEventListener("message", (event: MessageEvent<GenRequest>) => {
  self.postMessage(runRequest(event.data));
});
