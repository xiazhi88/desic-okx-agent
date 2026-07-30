import { describe, expect, it } from "vitest";
import { checkOkxConnectivity } from "../../src/network/connectivity.js";

describe("OKX connectivity checks", () => {
  it("requires both REST and WebSocket to succeed", async () => {
    const result = await checkOkxConnectivity(undefined, 100, {
      rest: async () => {},
      websocket: async () => {}
    });
    expect(result.ok).toBe(true);
    expect(result.rest.ok).toBe(true);
    expect(result.websocket.ok).toBe(true);
  });

  it("returns sanitized failures without throwing", async () => {
    const result = await checkOkxConnectivity(undefined, 100, {
      rest: async () => { throw new Error("fetch failed for http://user:secret@proxy.test"); },
      websocket: async () => { throw new Error("connection timed out"); }
    });
    expect(result.ok).toBe(false);
    expect(result.rest.error).not.toContain("user:secret");
    expect(result.websocket.error).toBe("connection timed out");
  });
});
