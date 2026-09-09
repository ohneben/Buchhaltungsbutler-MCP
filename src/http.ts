/**
 * Configuration and guards for the HTTP transport, kept separate from the
 * wiring in index.ts so each rule is testable on its own.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/** Hostnames that mean "this machine only". */
const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "::1",
  "[::1]",
  "0:0:0:0:0:0:0:1",
  "localhost",
]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

/**
 * `[::1]` is the spelling used everywhere else in this file and in the docs,
 * but node cannot bind it: listen() fails with ENOTFOUND. Unbracket it rather
 * than letting the server print "ready" and exit.
 */
export function normalizeBindHost(host: string): string {
  const h = host.trim();
  const m = /^\[(.+)\]$/.exec(h);
  return m ? m[1] : h;
}

function isTruthy(value: string | undefined): boolean {
  return /^(1|true|yes)$/i.test((value ?? "").trim());
}

/**
 * A misspelled number must not silently switch a safety limit off: Number("")
 * is 0 and Number("abc") is NaN, and both would make the sweep or the session
 * cap a no-op. Anything that is not a positive number falls back.
 */
export function positiveNumber(
  value: string | undefined,
  fallback: number
): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * A port must be a whole number in range. `positiveNumber` alone let "0x0DB9"
 * and "3501.5" through: the first bound a port nobody configured, the second
 * killed the process inside node's listen(). Railway injects PORT at runtime
 * and probes that same value, so a silent fallback is the dangerous outcome.
 */
export function portNumber(
  value: string | undefined,
  fallback: number
): { port: number; fellBack: boolean } {
  const raw = (value ?? "").trim();
  if (!raw) return { port: fallback, fellBack: false };
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= 65535) {
    return { port: n, fellBack: false };
  }
  return { port: fallback, fellBack: true };
}

/**
 * Entries are compared against `new URL("http://" + host).hostname`, which is
 * always lowercase and carries no port. An entry with either would therefore
 * never match, while the startup banner still reported it as configured.
 */
export function normalizeAllowedHosts(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => (/^\[.*\]$/.test(s) ? s : s.replace(/:\d+$/, "")));
}

export interface HttpConfig {
  host: string;
  port: number;
  /** True when PORT was unusable and the fallback was taken. */
  portFellBack: boolean;
  path: string;
  authToken: string;
  allowedHosts: string[];
  allowInsecure: boolean;
  sessionTtlMs: number;
  maxSessions: number;
  bodyLimit: string;
}

export function loadHttpConfig(
  env: NodeJS.ProcessEnv = process.env
): HttpConfig {
  return {
    host: normalizeBindHost(env.HOST || "0.0.0.0"),
    ...(() => {
      const p = portNumber(env.PORT, 3000);
      return { port: p.port, portFellBack: p.fellBack };
    })(),
    path: env.MCP_HTTP_PATH || "/mcp",
    authToken: env.MCP_AUTH_TOKEN || "",
    allowedHosts: normalizeAllowedHosts(env.MCP_ALLOWED_HOSTS),
    allowInsecure: isTruthy(env.MCP_ALLOW_INSECURE),
    sessionTtlMs: positiveNumber(env.MCP_SESSION_TTL, 1800) * 1000,
    maxSessions: positiveNumber(env.MCP_MAX_SESSIONS, 256),
    bodyLimit: env.MCP_BODY_LIMIT || "25mb",
  };
}

/**
 * A server reachable from outside this machine must require a token. The check
 * looks at the bind address: a loopback bind is unreachable from elsewhere, so
 * it needs no token, and anything else does. Binding 0.0.0.0 is normal and
 * necessary inside a container, which is why MCP_ALLOW_INSECURE exists for the
 * case where the port genuinely is not published.
 *
 * Returns an error message when the server must refuse to start.
 */
export function startupRefusal(cfg: HttpConfig): string | undefined {
  if (cfg.authToken) return undefined;
  if (isLoopbackHost(cfg.host)) return undefined;
  if (cfg.allowInsecure) return undefined;

  return (
    `Refusing to start: MCP_TRANSPORT=http is bound to ${cfg.host} (reachable ` +
    `beyond this machine) with no MCP_AUTH_TOKEN set. This endpoint can read, ` +
    `write and delete real accounting data, so it must not be exposed without ` +
    `authentication.\n\n` +
    `Pick one:\n` +
    `  1. Set MCP_AUTH_TOKEN to a long random string (recommended):\n` +
    `       MCP_AUTH_TOKEN=$(openssl rand -hex 32)\n` +
    `     Clients then send: Authorization: Bearer <token>\n` +
    `  2. Outside a container: bind loopback with HOST=127.0.0.1.\n` +
    `     Inside one this does NOT work - docker forwards a published port to\n` +
    `     the container's eth0, never to its loopback, so the container would\n` +
    `     look healthy and be unreachable. In a container use option 1 or 3.\n` +
    `  3. If this endpoint genuinely is not reachable by anyone else (an\n` +
    `     isolated private network), set MCP_ALLOW_INSECURE=1 to override.`
  );
}

/** Shortest token we do not warn about. Below this, a token is guessable. */
export const MIN_TOKEN_LENGTH = 16;

/**
 * A set token is not automatically a good token. `startupRefusal` only checks
 * that the string is non-empty, so `MCP_AUTH_TOKEN=a` starts and reports
 * "bearer auth enabled" while being trivially brute-forceable. The advice to
 * use `openssl rand -hex 32` only ever appears in the refusal text, which this
 * operator never sees.
 */
export function weakTokenWarning(cfg: HttpConfig): string | undefined {
  if (!cfg.authToken) return undefined;
  if (cfg.authToken.length >= MIN_TOKEN_LENGTH) return undefined;
  return (
    `WARNING - MCP_AUTH_TOKEN is only ${cfg.authToken.length} ` +
    `character${cfg.authToken.length === 1 ? "" : "s"} long. ` +
    `This endpoint can read, write and delete accounting data and is the only ` +
    `thing protecting it. Generate a real one with: openssl rand -hex 32`
  );
}

/**
 * Which hostnames the Host header may carry, or undefined when no check
 * applies. The decision is derived from the bind address, never from whether
 * a token is set — the same rule the official SDK applies in
 * `createMcpExpressApp`, which reads `host` and no credential at all.
 *
 * A token does NOT replace this check. DNS rebinding keeps the origin
 * constant and only swaps the IP, so the request is same-origin from the
 * browser's point of view: no preflight runs, and the page may set any header
 * it likes, `Authorization` included (it is not a forbidden request header —
 * `Host` and `Origin` are). What actually stops the attack is that the
 * browser attaches no ambient credentials, so the attacker must already know
 * the token. That is one layer, and this check is the second one.
 *
 * A non-loopback bind stays unchecked unless an allowlist is configured: the
 * hostname is not guessable there, and rebinding onto a public host is not
 * the threat model — so nobody behind a reverse proxy is forced to configure
 * anything.
 */
/** The loopback names a Host header can carry for this machine. */
export const LOOPBACK_ALLOWLIST = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Which hostnames /health accepts: whatever the MCP path accepts, plus the
 * loopback names, always.
 *
 * A liveness probe is not a browser and does not send the public hostname. The
 * HEALTHCHECK in this repo's own Dockerfile calls `http://127.0.0.1:3000/health`,
 * so configuring MCP_ALLOWED_HOSTS for a reverse proxy would otherwise make the
 * container's own health check fail with 403 and mark it unhealthy. Widening
 * this costs nothing: a loopback Host header can only come from the same host,
 * and /health returns no data beyond a fixed server name.
 *
 * A probe that connects by container IP or service name still needs that name
 * in MCP_ALLOWED_HOSTS; there is no way to know it up front.
 */
export function healthHostAllowlist(cfg: HttpConfig): string[] | undefined {
  const base = hostAllowlist(cfg);
  if (!base) return undefined;
  return [...new Set([...base, ...LOOPBACK_ALLOWLIST])];
}

export function hostAllowlist(cfg: HttpConfig): string[] | undefined {
  if (cfg.allowedHosts.length) return cfg.allowedHosts;
  if (isLoopbackHost(cfg.host)) return [...LOOPBACK_ALLOWLIST];
  // MCP_ALLOW_INSECURE waives the token, so there is no first layer left.
  // Dropping the Host check as well would hand any web page the operator
  // visits a working DNS-rebinding target against every tool, including the
  // destructive ones. Fall back to loopback names; MCP_ALLOWED_HOSTS is the
  // way to widen it deliberately.
  if (!cfg.authToken) return [...LOOPBACK_ALLOWLIST];
  return undefined;
}

/**
 * Constant-time bearer comparison. Both sides are hashed first so the digests
 * always have the same length and timingSafeEqual never throws on a
 * length mismatch (which would itself leak the token length).
 */
export function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function bearerFrom(header: string | undefined): string {
  return (header ?? "").replace(/^Bearer\s+/i, "");
}
