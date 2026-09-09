import { describe, expect, it } from "vitest";
import {
  bearerFrom,
  hostAllowlist,
  isLoopbackHost,
  loadHttpConfig,
  startupRefusal,
  tokenMatches,
} from "../src/http.js";

const base = (over: NodeJS.ProcessEnv = {}) =>
  loadHttpConfig({ ...over } as NodeJS.ProcessEnv);

describe("isLoopbackHost", () => {
  it("recognises the loopback spellings", () => {
    for (const h of ["127.0.0.1", "::1", "[::1]", "localhost", "LOCALHOST"]) {
      expect(isLoopbackHost(h)).toBe(true);
    }
  });
  it("treats a wildcard or routable bind as non-loopback", () => {
    for (const h of ["0.0.0.0", "::", "192.168.0.10"]) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });
});

describe("startupRefusal", () => {
  it("refuses a non-loopback bind without a token", () => {
    const msg = startupRefusal(base({ HOST: "0.0.0.0" }));
    expect(msg).toBeDefined();
    expect(msg).toContain("MCP_AUTH_TOKEN");
  });

  it("defaults to 0.0.0.0, so a bare `http` start with no token refuses", () => {
    expect(startupRefusal(base())).toBeDefined();
  });

  it("allows a non-loopback bind once a token is set", () => {
    expect(
      startupRefusal(base({ HOST: "0.0.0.0", MCP_AUTH_TOKEN: "s3cret" }))
    ).toBeUndefined();
  });

  it("allows a loopback bind without a token", () => {
    expect(startupRefusal(base({ HOST: "127.0.0.1" }))).toBeUndefined();
  });

  it("honours the explicit MCP_ALLOW_INSECURE override", () => {
    expect(
      startupRefusal(base({ HOST: "0.0.0.0", MCP_ALLOW_INSECURE: "1" }))
    ).toBeUndefined();
  });
});

describe("hostAllowlist", () => {
  it("uses MCP_ALLOWED_HOSTS verbatim when set", () => {
    expect(
      hostAllowlist(
        base({ MCP_ALLOWED_HOSTS: "mcp.example.com, localhost", MCP_AUTH_TOKEN: "t" })
      )
    ).toEqual(["mcp.example.com", "localhost"]);
  });

  it("skips the check when a token is set (the token defeats rebinding)", () => {
    expect(
      hostAllowlist(base({ HOST: "0.0.0.0", MCP_AUTH_TOKEN: "t" }))
    ).toBeUndefined();
  });

  it("restricts a token-less loopback server to localhost names", () => {
    expect(hostAllowlist(base({ HOST: "127.0.0.1" }))).toEqual([
      "localhost",
      "127.0.0.1",
      "[::1]",
    ]);
  });
});

describe("tokenMatches", () => {
  it("accepts the exact token", () => {
    expect(tokenMatches("abc123", "abc123")).toBe(true);
  });
  it("rejects a wrong token", () => {
    expect(tokenMatches("abc124", "abc123")).toBe(false);
  });
  it("rejects a differing length without throwing", () => {
    expect(tokenMatches("", "abc123")).toBe(false);
    expect(tokenMatches("abc123456789", "abc123")).toBe(false);
  });
});

describe("bearerFrom", () => {
  it("strips the scheme case-insensitively", () => {
    expect(bearerFrom("Bearer tok")).toBe("tok");
    expect(bearerFrom("bearer tok")).toBe("tok");
    expect(bearerFrom(undefined)).toBe("");
  });
});

describe("loadHttpConfig", () => {
  it("keeps the documented defaults", () => {
    const cfg = base();
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.port).toBe(3000);
    expect(cfg.path).toBe("/mcp");
    expect(cfg.sessionTtlMs).toBe(1_800_000);
    expect(cfg.maxSessions).toBe(256);
    expect(cfg.bodyLimit).toBe("25mb");
  });
});
