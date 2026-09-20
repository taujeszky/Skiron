import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Standalone on purpose: it does NOT load the SvelteKit plugin, so engine
// tests run in plain Node with no DOM and no kit magic. $lib is aliased by
// hand because that alias normally comes from the plugin.
export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  test: {
    include: ["src/lib/**/*.test.ts"],
    // `*.live.test.ts` spends money. It ends in `.test.ts`, so the include
    // above matches it, and `npm test` made three real API calls the first
    // time this config and that file existed together. The owner's standing
    // instruction is that no paid call happens without an estimate first, so
    // this exclusion is a safety rule, not tidiness: the live tests are run
    // only by `npm run test:live`, deliberately.
    exclude: ["**/node_modules/**", "src/lib/**/*.live.test.ts"],
    environment: "node",
    testTimeout: 30000,
  },
});
