import { createRequire } from "node:module";

const manifest = createRequire(import.meta.url)("../../package.json") as { version?: unknown };
if (typeof manifest.version !== "string" || manifest.version.length === 0) {
  throw new Error("Package version is missing");
}

export const PACKAGE_VERSION = manifest.version;
