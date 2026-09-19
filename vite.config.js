import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [sveltekit()],

  server: {
    // 1430, not vite's default: Signpost owns 1420 on this machine and two
    // dev servers on one port silently serve each other's modules.
    port: 1430,
    strictPort: true,
  },
});
