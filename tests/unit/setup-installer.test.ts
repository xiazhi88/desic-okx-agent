import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mergeMcpConfig, parseInteractiveSetupTargets, parseSetupTargets, runExternalCommand, setupSucceeded, setupTargets } from "../../src/setup/installer.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desic-setup-"));
  directories.push(directory);
  return directory;
}

describe("setup installer", () => {
  it("expands all and rejects unknown targets", () => {
    expect(parseSetupTargets("all")).toEqual(["codex", "claude-code", "cursor", "vscode", "cline"]);
    expect(() => parseSetupTargets("codex,unknown")).toThrow("Unsupported setup target");
  });

  it("parses interactive numbered selections", () => {
    expect(parseInteractiveSetupTargets("a")).toEqual(["codex", "claude-code", "cursor", "vscode", "cline"]);
    expect(parseInteractiveSetupTargets("1, 3")).toEqual(["codex", "cursor"]);
    expect(parseInteractiveSetupTargets("2 2 5")).toEqual(["claude-code", "cline"]);
    expect(() => parseInteractiveSetupTargets("6")).toThrow("Invalid selection");
    expect(() => parseInteractiveSetupTargets("")).toThrow("Select at least one client");
  });

  it("merges a JSON MCP config without changing other servers", () => {
    const directory = temporaryDirectory();
    const configPath = path.join(directory, "mcp.json");
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { existing: { command: "example" } } }));
    expect(mergeMcpConfig(configPath, [])).toBe("configured");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as { mcpServers: Record<string, { command: string; args?: string[] }> };
    expect(config.mcpServers.existing?.command).toBe("example");
    expect(config.mcpServers["desic-okx"]).toEqual({ command: "desic-okx", args: ["mcp"] });
    expect(mergeMcpConfig(configPath, [])).toBe("existing");
  });

  it("installs all compatible skills and configures JSON clients", () => {
    const home = temporaryDirectory();
    const source = path.resolve(process.cwd(), "skills");
    const results = setupTargets(["codex", "cursor"], {
      homeDir: home,
      skillSourceDir: source,
      runCommand: () => ({ ok: true })
    });
    expect(setupSucceeded(results)).toBe(true);
    expect(fs.existsSync(path.join(home, ".codex", "skills", "okx-trading", "SKILL.md"))).toBe(true);
    const cursor = JSON.parse(fs.readFileSync(path.join(home, ".cursor", "mcp.json"), "utf8")) as { mcpServers: Record<string, unknown> };
    expect(cursor.mcpServers["desic-okx"]).toBeDefined();
    expect(results.find((result) => result.target === "cursor")?.skills).toBe("not-supported");
  });

  const windowsIt = process.platform === "win32" ? it : it.skip;
  windowsIt("returns after invoking a Windows command shim", () => {
    const directory = temporaryDirectory();
    const commandPath = path.join(directory, "fake client.cmd");
    const outputPath = path.join(directory, "command result.txt");
    fs.writeFileSync(commandPath, "@echo off\r\n> \"%~3\" echo %~1^|%~2\r\nexit /b 0\r\n");

    expect(runExternalCommand(commandPath, ["first", "value with spaces", outputPath])).toEqual({ ok: true });
    expect(fs.readFileSync(outputPath, "utf8").trim()).toBe("first|value with spaces");
  });
});
