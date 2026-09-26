/**
 * Thin client for the BuchhaltungsButler API.
 *
 * Auth model (per the BB docs):
 *   - HTTP Basic auth:  Authorization: Basic base64("<API_CLIENT>:<API_SECRET>")
 *   - Body field `api_key`: identifies which BB customer account to act on.
 *
 * All endpoints are POST and accept a JSON body. File uploads are passed as
 * base64 strings inside that JSON body, so a single content type covers
 * everything.
 */

import { apiKeyOverrideAllowed, specInfo } from "./spec.js";
import { positiveNumber } from "./http.js";

export interface BBConfig {
  apiClient: string;
  apiSecret: string;
  apiKey: string;
  baseUrl: string;
  /** Max requests per minute (BB enforces 100/customer/min). */
  rateLimit: number;
  /** Total time budget for a read call across all attempts, in milliseconds. */
  readTimeoutMs?: number;
  /** Extra attempts a read call gets after a timeout or transient failure. */
  readRetries?: number;
}

/**
 * Options for a single call. Only read-only tools opt in: a write that timed
 * out on our side may still have gone through at BB, so repeating it could
 * book something twice.
 */
export interface CallOptions {
  retry?: boolean;
  /**
   * Aborted when the MCP client cancels the call or the session closes. A
   * running attempt stops and no further attempt starts: nobody is waiting
   * for the answer any more.
   */
  signal?: AbortSignal;
}

/** HTTP statuses worth a second attempt: rate limit and gateway trouble. */
const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);

export function loadConfig(): BBConfig {
  const apiClient = process.env.BB_API_CLIENT ?? "";
  const apiSecret = process.env.BB_API_SECRET ?? "";
  const apiKey = process.env.BB_API_KEY ?? "";
  const baseUrl = process.env.BB_BASE_URL || specInfo().baseUrl;
  // Not a bare Number(): BB_RATE_LIMIT=0 made RateLimiter.take() compute a NaN
  // delay and recurse forever, hanging every tool call and holding its session
  // open; "abc" disabled the limiter entirely and blew past BB's 100/min cap.
  const rateLimit = positiveNumber(process.env.BB_RATE_LIMIT, 90);
  // One budget for all attempts together. The MCP SDK client gives up after
  // 60 seconds by default, so retrying beyond that only produces answers
  // nobody receives. Live reads normally take under two seconds; the slowest
  // observed (500 receipts, a full-year ledger) take 25 to 45 seconds and
  // still fit in a single attempt.
  const readTimeoutMs = positiveNumber(process.env.BB_READ_TIMEOUT_MS, 55_000);
  // 0 is a valid choice here (no retries), so positiveNumber does not fit.
  const retries = Number(process.env.BB_READ_RETRIES?.trim() || NaN);
  const readRetries = Number.isInteger(retries) && retries >= 0 ? Math.min(retries, 5) : 2;

  const missing = [
    !apiClient && "BB_API_CLIENT",
    !apiSecret && "BB_API_SECRET",
    !apiKey && "BB_API_KEY",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Missing required configuration: ${missing.join(", ")}. ` +
        `Set these environment variables (see .env.example).`
    );
  }
  return {
    apiClient,
    apiSecret,
    apiKey,
    baseUrl,
    rateLimit,
    readTimeoutMs,
    readRetries,
  };
}

/** Simple sliding-window limiter to stay under BB's 100 req/min cap. */
class RateLimiter {
  private hits: number[] = [];
  constructor(private readonly perMinute: number) {}
  async take(): Promise<void> {
    const now = Date.now();
    this.hits = this.hits.filter((t) => now - t < 60_000);
    if (this.hits.length >= this.perMinute) {
      const wait = 60_000 - (now - this.hits[0]) + 50;
      await new Promise((r) => setTimeout(r, wait));
      return this.take();
    }
    this.hits.push(Date.now());
  }
}

interface Resolved {
  cfg: BBConfig;
  auth: string;
  limiter: RateLimiter;
}

export class BBClient {
  private resolved?: Resolved;

  /**
   * Takes a ready config, or a loader that runs on first use. Resolving
   * lazily is deliberate: an MCP client must be able to connect and list
   * tools before any credentials exist, so a missing variable has to surface
   * as an error on the tool call that needs it, not kill the process at
   * startup.
   */
  constructor(
    private readonly source: BBConfig | (() => BBConfig) = loadConfig
  ) {}

  private ready(): Resolved {
    if (!this.resolved) {
      const cfg =
        typeof this.source === "function" ? this.source() : this.source;
      this.resolved = {
        cfg,
        auth:
          "Basic " +
          Buffer.from(`${cfg.apiClient}:${cfg.apiSecret}`).toString("base64"),
        limiter: new RateLimiter(cfg.rateLimit),
      };
    }
    return this.resolved;
  }

  /**
   * Call an endpoint. `args` are the tool arguments; `api_key` comes from
   * configuration. A per-call override is only honoured when
   * BB_ALLOW_API_KEY_OVERRIDE is set, because the value would otherwise be
   * chosen by the model — a hallucinated or prompt-injected key can point at
   * a different customer's books on accounts whose API client covers several.
   */
  async call(
    path: string,
    args: Record<string, unknown>,
    opts: CallOptions = {}
  ): Promise<{ status: number; ok: boolean; body: unknown }> {
    const { cfg, auth, limiter } = this.ready();

    const { api_key, ...rest } = args;
    const override = apiKeyOverrideAllowed() ? (api_key as string) : "";
    const body = JSON.stringify({
      api_key: override || cfg.apiKey,
      ...rest,
    });
    const url = `${cfg.baseUrl}${path}`;
    const init: RequestInit = {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
    };

    // Writes keep the original behaviour: one attempt, no client timeout.
    if (!opts.retry) {
      await limiter.take();
      return parseResponse(await fetch(url, init));
    }

    const attempts = 1 + (cfg.readRetries ?? 2);
    const budgetMs = cfg.readTimeoutMs ?? 55_000;
    const deadline = Date.now() + budgetMs;
    const clientGone = () => opts.signal?.aborted === true;
    for (let attempt = 1; ; attempt++) {
      await limiter.take();
      const attemptSignal = linkedSignal(deadline - Date.now(), opts.signal);
      try {
        const res = await fetch(url, { ...init, signal: attemptSignal.signal });
        if (
          TRANSIENT_STATUS.has(res.status) &&
          attempt < attempts &&
          !clientGone() &&
          deadline - Date.now() > backoffMs(attempt)
        ) {
          await res.body?.cancel();
          await sleep(backoffMs(attempt), opts.signal);
          if (clientGone()) throw cancelled();
          continue;
        }
        return await parseResponse(res);
      } catch (err) {
        if (clientGone()) throw cancelled();
        const outOfTime = deadline - Date.now() <= backoffMs(attempt);
        if (attempt >= attempts || outOfTime) {
          if (isTimeout(err)) {
            throw new Error(
              `BuchhaltungsButler did not answer within ${Math.round(
                budgetMs / 1000
              )}s (${attempt} attempt${attempt === 1 ? "" : "s"})`
            );
          }
          throw err;
        }
        await sleep(backoffMs(attempt), opts.signal);
        if (clientGone()) throw cancelled();
      } finally {
        attemptSignal.dispose();
      }
    }
  }
}

async function parseResponse(
  res: Response
): Promise<{ status: number; ok: boolean; body: unknown }> {
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text if the response isn't JSON */
  }
  return { status: res.status, ok: res.ok, body: parsed };
}

function isTimeout(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  );
}

/** 1s, then 2s, then 4s. */
function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 4000);
}

function cancelled(): Error {
  const err = new Error("Request cancelled by the client; no further attempt");
  err.name = "AbortError";
  return err;
}

/** Resolves after `ms`, or early when `signal` aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}

/**
 * A signal that aborts after `ms` or when `parent` aborts, whichever comes
 * first. Hand-rolled because AbortSignal.any needs Node 20.3 and the package
 * still supports Node 18.
 */
function linkedSignal(
  ms: number,
  parent?: AbortSignal
): { signal: AbortSignal; dispose: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new DOMException("timed out", "TimeoutError")),
    Math.max(ms, 0)
  );
  const onParent = () => ctrl.abort(parent?.reason);
  if (parent?.aborted) onParent();
  else parent?.addEventListener("abort", onParent, { once: true });
  return {
    signal: ctrl.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
    },
  };
}
