import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../../src/core/version.js";

describe("package version", () => {
  it("uses package.json as the single source of truth", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as { version: string };
    expect(PACKAGE_VERSION).toBe(manifest.version);
  });
});
