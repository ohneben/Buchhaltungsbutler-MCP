import { describe, expect, it } from "vitest";
import {
  bearerFrom,
  healthHostAllowlist,
  hostAllowlist,
  isLoopbackHost,
  loadHttpConfig,
  MIN_TOKEN_LENGTH,
  positiveNumber,
  startupRefusal,
  tokenMatches,
  weakTokenWarning,
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

  it("leaves a token-protected non-loopback bind unchecked, so a reverse proxy needs no config", () => {
    expect(
      hostAllowlist(base({ HOST: "0.0.0.0", MCP_AUTH_TOKEN: "t" }))
    ).toBeUndefined();
    expect(hostAllowlist(base({ HOST: "::", MCP_AUTH_TOKEN: "t" }))).toBeUndefined();
  });

  it("falls back to loopback names when there is no token at all", () => {
    // Only reachable via MCP_ALLOW_INSECURE. Waiving the token removes the
    // first layer; dropping the Host check too would hand any page the
    // operator visits a working rebinding target against the destructive
    // tools. An explicit MCP_ALLOWED_HOSTS is the way to widen it.
    for (const host of ["0.0.0.0", "::", "192.168.0.10"]) {
      expect(hostAllowlist(base({ HOST: host }))).toEqual([
        "localhost",
        "127.0.0.1",
        "[::1]",
      ]);
    }
  });

  it("restricts a token-less loopback server to localhost names", () => {
    expect(hostAllowlist(base({ HOST: "127.0.0.1" }))).toEqual([
      "localhost",
      "127.0.0.1",
      "[::1]",
    ]);
  });

  it("restricts a loopback server WITH a token too — the token is not a substitute", () => {
    // Rebinding stays same-origin, so the attacking page can send any header,
    // Authorization included. The token only helps because the browser does
    // not attach it by itself; the Host check is the layer that does not
    // depend on the attacker's ignorance.
    for (const host of ["127.0.0.1", "localhost", "::1", "[::1]"]) {
      expect(hostAllowlist(base({ HOST: host, MCP_AUTH_TOKEN: "s3cret" }))).toEqual([
        "localhost",
        "127.0.0.1",
        "[::1]",
      ]);
    }
  });

  it("still lets an explicit allowlist win on loopback", () => {
    expect(
      hostAllowlist(
        base({ HOST: "127.0.0.1", MCP_AUTH_TOKEN: "t", MCP_ALLOWED_HOSTS: "mcp.example.com" })
      )
    ).toEqual(["mcp.example.com"]);
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

describe("positiveNumber", () => {
  it("falls back rather than silently disabling a limit", () => {
    // Number("abc") is NaN and Number("") is 0 — both would turn the idle
    // sweep or the session cap into a no-op.
    expect(positiveNumber("abc", 256)).toBe(256);
    expect(positiveNumber("", 256)).toBe(256);
    expect(positiveNumber("0", 256)).toBe(256);
    expect(positiveNumber("-5", 256)).toBe(256);
    expect(positiveNumber(undefined, 256)).toBe(256);
  });
  it("takes a valid positive value", () => {
    expect(positiveNumber("10", 256)).toBe(10);
  });
});

describe("loadHttpConfig hardening against bad numbers", () => {
  it("keeps the safety limits when the env vars are garbage", () => {
    const cfg = loadHttpConfig({
      MCP_SESSION_TTL: "abc",
      MCP_MAX_SESSIONS: "0",
      PORT: "",
    } as NodeJS.ProcessEnv);
    expect(cfg.sessionTtlMs).toBe(1_800_000);
    expect(cfg.maxSessions).toBe(256);
    expect(cfg.port).toBe(3000);
  });
});

describe("weakTokenWarning", () => {
  it("stays quiet when no token is set (startupRefusal owns that case)", () => {
    expect(weakTokenWarning(base({ HOST: "127.0.0.1" }))).toBeUndefined();
  });

  it("warns about a token that is trivially guessable", () => {
    const msg = weakTokenWarning(base({ MCP_AUTH_TOKEN: "a" }));
    expect(msg).toBeDefined();
    expect(msg).toContain("openssl rand -hex 32");
  });

  it("stays quiet at the minimum length and above", () => {
    const ok = "x".repeat(MIN_TOKEN_LENGTH);
    expect(weakTokenWarning(base({ MCP_AUTH_TOKEN: ok }))).toBeUndefined();
    expect(weakTokenWarning(base({ MCP_AUTH_TOKEN: ok + "x" }))).toBeUndefined();
  });

  it("warns one character below the minimum", () => {
    const short = "x".repeat(MIN_TOKEN_LENGTH - 1);
    expect(weakTokenWarning(base({ MCP_AUTH_TOKEN: short }))).toBeDefined();
  });
});

describe("healthHostAllowlist", () => {
  it("adds the loopback names to a configured allowlist", () => {
    // Regression guard: this repo's own Dockerfile HEALTHCHECK calls
    // http://127.0.0.1:3000/health, so pinning MCP_ALLOWED_HOSTS to a public
    // hostname used to make the container mark itself unhealthy.
    expect(
      healthHostAllowlist(
        base({ HOST: "0.0.0.0", MCP_AUTH_TOKEN: "t", MCP_ALLOWED_HOSTS: "mcp.example.com" })
      )
    ).toEqual(["mcp.example.com", "localhost", "127.0.0.1", "[::1]"]);
  });

  it("does not duplicate a loopback name that is already allowed", () => {
    expect(
      healthHostAllowlist(base({ HOST: "127.0.0.1", MCP_ALLOWED_HOSTS: "localhost" }))
    ).toEqual(["localhost", "127.0.0.1", "[::1]"]);
  });

  it("stays off wherever the MCP path is unchecked", () => {
    expect(healthHostAllowlist(base({ HOST: "0.0.0.0", MCP_AUTH_TOKEN: "t" }))).toBeUndefined();
  });

  it("matches the MCP allowlist on a token-less loopback bind", () => {
    expect(healthHostAllowlist(base({ HOST: "127.0.0.1" }))).toEqual([
      "localhost",
      "127.0.0.1",
      "[::1]",
    ]);
  });
});
