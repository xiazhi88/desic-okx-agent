import { describe, expect, it } from "vitest";
import { checkOkxConnectivity } from "../../src/network/connectivity.js";

describe("OKX connectivity checks", () => {
  it("requires both REST and WebSocket to succeed", async () => {
    const result = await checkOkxConnectivity(undefined, 100, {
      rest: async () => {},
      websocket: async () => {},
      retryDelayMs: 0
    });
    expect(result.ok).toBe(true);
    expect(result.rest.ok).toBe(true);
    expect(result.websocket.ok).toBe(true);
    expect(result.rest.attempts).toBe(1);
  });

  it("recovers from a transient TLS failure", async () => {
    let restAttempts = 0;
    const result = await checkOkxConnectivity(undefined, 100, {
      rest: async () => {
        restAttempts += 1;
        if (restAttempts === 1) throw new Error("TLS handshake failed");
      },
      websocket: async () => {},
      retryDelayMs: 0
    });
    expect(result.ok).toBe(true);
    expect(result.rest.attempts).toBe(2);
  });

  it("returns sanitized failures without throwing", async () => {
    const result = await checkOkxConnectivity(undefined, 100, {
      rest: async () => {
        throw new Error("fetch failed for http://user:secret@proxy.test", { cause: new Error("TLS handshake failed") });
      },
      websocket: async () => { throw new Error("connection timed out"); },
      retryDelayMs: 0
    });
    expect(result.ok).toBe(false);
    expect(result.rest.error).not.toContain("user:secret");
    expect(result.rest.error).toContain("TLS handshake failed");
    expect(result.rest.attempts).toBe(3);
    expect(result.websocket.error).toBe("connection timed out");
  });
});
