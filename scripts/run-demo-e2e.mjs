import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const name of ["OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE"]) {
  if (!process.env[name]) throw new Error(`${name} is required for the OKX Demo end-to-end test`);
}
if (process.env.OKX_ENVIRONMENT !== "demo") throw new Error("OKX_ENVIRONMENT must be exactly 'demo'");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(root, "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(process.execPath, [executable, "run", "tests/integration/demo-trading.test.ts"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, RUN_OKX_DEMO_E2E: "1" }
});
process.exit(result.status ?? 1);
