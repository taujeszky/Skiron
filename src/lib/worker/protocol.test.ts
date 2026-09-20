import { describe, expect, it } from "vitest";
import { newCaseId } from "../engine/caseId";
import { answerKey, answers } from "../engine/solver/exhaustive";
import { runRequest } from "./protocol";

/**
 * The worker's own decisions, tested without a worker.
 *
 * `genWorker.ts` is a `postMessage` around this function and `genClient.ts` is
 * a promise around that, so there is nothing in either of them to test in
 * Node that would not just be testing the browser. What matters is that a
 * request produces a real case, that a failure comes back as a message rather
 * than a thrown worker, and that the token is echoed so a reply can be
 * matched to its call.
 */
describe("the generation worker's protocol", () => {
  it("answers a request with a case that is still fair", () => {
    const reply = runRequest({ token: 7, id: newCaseId("normal", "worker1") });
    expect(reply.token).toBe(7);
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.ms).toBeGreaterThanOrEqual(0);
    // The case survived structured-clone-shaped handling with its Maps and
    // Sets intact, and is the same case the engine would have made.
    const c = reply.case;
    expect(c.bank.cards.size).toBeGreaterThan(0);
    const found = answers(c.frame, c.clues);
    expect(found.map(answerKey)).toEqual([answerKey(c.answer)]);
  });

  it("reports a case it could not make instead of throwing", () => {
    // One attempt is not enough for every seed, and a worker that threw would
    // take the whole thread down rather than let the page say so.
    const reply = runRequest({
      token: 1,
      id: newCaseId("expert", "worker2"),
      maxAttempts: 0,
    });
    expect(reply.ok).toBe(false);
    if (reply.ok) return;
    expect(reply.error).toContain("expert");
  });

  it("is as deterministic through the wire as it is in Node", () => {
    // The plan asks for a determinism smoke test "in the worker". A real
    // Worker needs a browser, and there is nothing in `genWorker.ts` but a
    // postMessage — so what is worth smoking is that the same request really
    // does produce the same case on the worker's side of the boundary.
    const id = newCaseId("hard", "twice");
    const a = runRequest({ token: 1, id });
    const b = runRequest({ token: 2, id });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.case.world.loc).toEqual(b.case.world.loc);
    expect(a.case.essential.map((k) => k.id)).toEqual(
      b.case.essential.map((k) => k.id),
    );
    expect(a.case.tier).toBe(b.case.tier);
  });

  it("echoes the token it was given", () => {
    for (const token of [0, 1, 99]) {
      expect(runRequest({ token, id: newCaseId("easy", "tok") }).token).toBe(
        token,
      );
    }
  });
});
