import { describe, expect, it } from "vitest";
import { displayProxy, normalizeProxyUrl, resolveProxy } from "../../src/network/proxy.js";

describe("proxy resolution", () => {
  it("prefers an explicit configuration and redacts credentials", () => {
    const proxy = resolveProxy("http://user:secret@127.0.0.1:7890", {
      env: { HTTPS_PROXY: "http://environment:8080" },
      platform: "linux"
    });
    expect(proxy).toEqual({ url: "http://user:secret@127.0.0.1:7890", source: "config" });
    expect(displayProxy(proxy)).not.toContain("user");
    expect(displayProxy(proxy)).not.toContain("secret");
  });

  it("uses standard proxy environment variables and honors NO_PROXY", () => {
    expect(resolveProxy(undefined, {
      env: { HTTPS_PROXY: "http://127.0.0.1:7890" },
      platform: "linux"
    })).toEqual({ url: "http://127.0.0.1:7890", source: "environment" });
    expect(resolveProxy(undefined, {
      env: { HTTPS_PROXY: "http://127.0.0.1:7890", NO_PROXY: ".okx.com" },
      platform: "linux"
    })).toEqual({ source: "none" });
  });

  it("reads the enabled Windows HTTPS system proxy", () => {
    const proxy = resolveProxy(undefined, {
      env: {},
      platform: "win32",
      runCommand: () => ({
        status: 0,
        stdout: [
          "    ProxyEnable    REG_DWORD    0x1",
          "    ProxyServer    REG_SZ    http=127.0.0.1:7890;https=127.0.0.1:7891"
        ].join("\r\n")
      })
    });
    expect(proxy).toEqual({ url: "http://127.0.0.1:7891", source: "system" });
  });

  it("reads the enabled macOS HTTPS system proxy", () => {
    const proxy = resolveProxy(undefined, {
      env: {},
      platform: "darwin",
      runCommand: () => ({
        status: 0,
        stdout: "HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 6152\n"
      })
    });
    expect(proxy).toEqual({ url: "http://127.0.0.1:6152", source: "system" });
  });

  it("accepts host-only proxies and rejects unsupported protocols", () => {
    expect(normalizeProxyUrl("proxy.example.com")).toBe("http://proxy.example.com");
    expect(() => normalizeProxyUrl("socks5://127.0.0.1:1080")).toThrow("http:// or https://");
    expect(() => normalizeProxyUrl("http/127.0.0.1:7890")).toThrow("must look like");
  });
});
