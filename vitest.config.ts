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
    environment: "node",
    testTimeout: 30000,
  },
});
