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

import { specInfo } from "./spec.js";

export interface BBConfig {
  apiClient: string;
  apiSecret: string;
  apiKey: string;
  baseUrl: string;
  /** Max requests per minute (BB enforces 100/customer/min). */
  rateLimit: number;
}

export function loadConfig(): BBConfig {
  const apiClient = process.env.BB_API_CLIENT ?? "";
  const apiSecret = process.env.BB_API_SECRET ?? "";
  const apiKey = process.env.BB_API_KEY ?? "";
  const baseUrl = process.env.BB_BASE_URL || specInfo().baseUrl;
  const rateLimit = Number(process.env.BB_RATE_LIMIT || "90");

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
  return { apiClient, apiSecret, apiKey, baseUrl, rateLimit };
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
   * Call an endpoint. `args` are the tool arguments; `api_key` is taken from
   * args if the caller supplied an override, otherwise from configuration.
   */
  async call(
    path: string,
    args: Record<string, unknown>
  ): Promise<{ status: number; ok: boolean; body: unknown }> {
    const { cfg, auth, limiter } = this.ready();
    await limiter.take();

    const { api_key, ...rest } = args;
    const body = {
      api_key: (api_key as string) || cfg.apiKey,
      ...rest,
    };

    const url = `${cfg.baseUrl}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep raw text if the response isn't JSON */
    }

    return { status: res.status, ok: res.ok, body: parsed };
  }
}
