import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * The tests that cost money.
 *
 * A separate config, and **not** reachable from `npm test`, because these are
 * the only tests in the project that make a real API call. Everything else
 * about wave 5 runs against `llm/stub.ts` with no key and no network, which is
 * the arrangement the owner asked for: build it stubbed, then bring back a
 * call count before spending anything.
 *
 * Run them deliberately:
 *
 *   npm run test:live               needs GEMINI_API_KEY, or the file below
 *
 * Each file skips itself when there is no key, so a run without one is a pass
 * that says "skipped" rather than a wall of failures. The timeout is long
 * because a writer call on a real case is tens of seconds.
 */
export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  test: {
    include: ["src/lib/**/*.live.test.ts"],
    environment: "node",
    testTimeout: 300_000,
    // One at a time: these share a rate limit, and a quota error in a paid
    // test is a wasted call rather than a useful failure.
    fileParallelism: false,
  },
});
