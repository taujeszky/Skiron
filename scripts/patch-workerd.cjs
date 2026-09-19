// workerd (wrangler's local runtime) ships no win32-arm64 binary and throws
// at import time, which breaks even `wrangler pages deploy` — the only
// wrangler feature Skiron uses, and one that never runs the runtime.
// Replace its entry point with a harmless stub on affected machines.
const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "win32" || process.arch !== "arm64") process.exit(0);

const main = path.join(__dirname, "..", "node_modules", "workerd", "lib", "main.js");
if (!fs.existsSync(main)) process.exit(0);

const stub = `// Patched by scripts/patch-workerd.cjs: no win32-arm64 workerd binary
// exists; static Pages deploys never invoke the local runtime.
module.exports = { default: null };
if (require.main === module) {
  console.error("workerd is not available on win32-arm64 (stub).");
  process.exit(1);
}
`;
if (fs.readFileSync(main, "utf8") !== stub) {
  fs.writeFileSync(main, stub);
  console.log("patched workerd for win32-arm64");
}
