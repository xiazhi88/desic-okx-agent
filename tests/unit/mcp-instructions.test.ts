import { describe, expect, it } from "vitest";
import { MCP_INSTRUCTIONS } from "../../src/mcp/server.js";

describe("MCP server instructions", () => {
  it("tells clients that trading is limited to perpetual swaps", () => {
    expect(MCP_INSTRUCTIONS).toContain("perpetual swap");
    expect(MCP_INSTRUCTIONS).toContain("-SWAP");
    expect(MCP_INSTRUCTIONS).toContain("spot");
  });
});
