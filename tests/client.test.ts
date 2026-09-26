import { describe, it, expect, vi, afterEach } from "vitest";
import { loadConfig, BBClient } from "../src/client.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("BBClient credential loading", () => {
  it("does not touch the config until a call is made", () => {
    // Scanners and MCP clients must be able to connect and list tools before
    // any credentials exist, so constructing must never throw.
    const load = vi.fn(() => {
      throw new Error("Missing required configuration: BB_API_CLIENT");
    });
    expect(() => new BBClient(load)).not.toThrow();
    expect(load).not.toHaveBeenCalled();
  });

  it("surfaces a missing credential on the call instead of at startup", async () => {
    const client = new BBClient(() => {
      throw new Error("Missing required configuration: BB_API_CLIENT");
    });
    await expect(client.call("/accounts/get", {})).rejects.toThrow(
      /Missing required configuration/
    );
  });

  it("loads the config once and reuses it across calls", async () => {
    const cfg = {
      apiClient: "c",
      apiSecret: "s",
      apiKey: "k",
      baseUrl: "https://bb.test/api/v1",
      rateLimit: 90,
    };
    const load = vi.fn(() => cfg);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new BBClient(load);
    await client.call("/accounts/get", {});
    await client.call("/accounts/get", {});
    expect(load).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("loadConfig", () => {
  it("throws when required credentials are missing", () => {
    vi.stubEnv("BB_API_CLIENT", "");
    vi.stubEnv("BB_API_SECRET", "");
    vi.stubEnv("BB_API_KEY", "");
    expect(() => loadConfig()).toThrow(/Missing required configuration/);
  });

  it("names every missing credential", () => {
    vi.stubEnv("BB_API_CLIENT", "");
    vi.stubEnv("BB_API_SECRET", "");
    vi.stubEnv("BB_API_KEY", "");
    expect(() => loadConfig()).toThrow(/BB_API_CLIENT.*BB_API_SECRET.*BB_API_KEY/);
  });

  it("loads credentials and applies defaults", () => {
    vi.stubEnv("BB_API_CLIENT", "test-client");
    vi.stubEnv("BB_API_SECRET", "test-secret");
    vi.stubEnv("BB_API_KEY", "test-key");
    vi.stubEnv("BB_RATE_LIMIT", "");
    vi.stubEnv("BB_BASE_URL", "");
    const cfg = loadConfig();
    expect(cfg.apiClient).toBe("test-client");
    expect(cfg.apiSecret).toBe("test-secret");
    expect(cfg.apiKey).toBe("test-key");
    expect(cfg.rateLimit).toBe(90);
    expect(cfg.baseUrl).toMatch(/\/api\/v1$/);
  });

  it("honors the BB_RATE_LIMIT override", () => {
    vi.stubEnv("BB_API_CLIENT", "c");
    vi.stubEnv("BB_API_SECRET", "s");
    vi.stubEnv("BB_API_KEY", "k");
    vi.stubEnv("BB_RATE_LIMIT", "42");
    expect(loadConfig().rateLimit).toBe(42);
  });
});

describe("BBClient.call", () => {
  const cfg = {
    apiClient: "cli",
    apiSecret: "sec",
    apiKey: "default-key",
    baseUrl: "https://example.test/api/v1",
    rateLimit: 90,
  };

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ success: true, rows: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends HTTP Basic auth built from client:secret to the right URL", async () => {
    const fetchMock = stubFetch();
    await new BBClient(cfg).call("/accounts/get", {});
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/api/v1/accounts/get");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(
      "Basic " + Buffer.from("cli:sec").toString("base64")
    );
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("defaults api_key from config and forwards other args", async () => {
    const fetchMock = stubFetch();
    await new BBClient(cfg).call("/receipts/get", { list_direction: "inbound" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.api_key).toBe("default-key");
    expect(body.list_direction).toBe("inbound");
  });

  it("ignores a per-call api_key override by default", async () => {
    const fetchMock = stubFetch();
    await new BBClient(cfg).call("/receipts/get", { api_key: "other-customer" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.api_key).toBe("default-key");
  });

  it("honours a per-call api_key override when explicitly enabled", async () => {
    const prev = process.env.BB_ALLOW_API_KEY_OVERRIDE;
    process.env.BB_ALLOW_API_KEY_OVERRIDE = "1";
    try {
      const fetchMock = stubFetch();
      await new BBClient(cfg).call("/receipts/get", {
        api_key: "other-customer",
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.api_key).toBe("other-customer");
    } finally {
      if (prev === undefined) delete process.env.BB_ALLOW_API_KEY_OVERRIDE;
      else process.env.BB_ALLOW_API_KEY_OVERRIDE = prev;
    }
  });

  it("returns status, ok and parsed body", async () => {
    stubFetch();
    const res = await new BBClient(cfg).call("/accounts/get", {});
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.body).toEqual({ success: true, rows: [] });
  });
});

describe("read timeout and retry", () => {
  const base = {
    apiClient: "c",
    apiSecret: "s",
    apiKey: "k",
    baseUrl: "https://bb.test/api/v1",
    rateLimit: 90,
    readTimeoutMs: 10_000,
    readRetries: 2,
  };
  const ok = () => new Response('{"success":true}', { status: 200 });

  /** A fetch that never answers on its own and only ends when aborted. */
  const hang = (_url: string, init: RequestInit) =>
    new Promise<Response>((_, reject) =>
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason))
    );

  afterEach(() => vi.useRealTimers());

  it("retries a read that hit a gateway error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);

    const pending = new BBClient(base).call("/accounts/get", {}, { retry: true });
    await vi.runAllTimersAsync();
    expect((await pending).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a read after a network error, then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);

    const pending = new BBClient(base).call("/accounts/get", {}, { retry: true });
    await vi.runAllTimersAsync();
    expect((await pending).body).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps all attempts inside one time budget", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(hang);
    vi.stubGlobal("fetch", fetchMock);

    const pending = new BBClient(base).call("/accounts/get", {}, { retry: true });
    const settled = expect(pending).rejects.toThrow(
      /did not answer within 10s \(1 attempt\)/
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
    // The first attempt used the whole budget, so no second one started.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a persistent gateway error instead of retrying forever", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = new BBClient(base).call("/accounts/get", {}, { retry: true });
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops the running attempt when the client cancels, and starts no other", async () => {
    const fetchMock = vi.fn(hang);
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = new AbortController();

    const pending = new BBClient(base).call(
      "/accounts/get",
      {},
      { retry: true, signal: ctrl.signal }
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    ctrl.abort();
    await expect(pending).rejects.toThrow(/cancelled by the client/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry after the client cancelled during the backoff", async () => {
    const ctrl = new AbortController();
    const fetchMock = vi.fn(async () => {
      setTimeout(() => ctrl.abort(), 50);
      return new Response("unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new BBClient(base).call("/accounts/get", {}, { retry: true, signal: ctrl.signal })
    ).rejects.toThrow(/cancelled by the client/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries or times out a call that did not opt in", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeUndefined();
      return new Response("unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await new BBClient(base).call("/receipts/add", {});
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads timeout and retry settings from the environment", () => {
    vi.stubEnv("BB_API_CLIENT", "c");
    vi.stubEnv("BB_API_SECRET", "s");
    vi.stubEnv("BB_API_KEY", "k");
    expect(loadConfig()).toMatchObject({ readTimeoutMs: 55_000, readRetries: 2 });

    vi.stubEnv("BB_READ_TIMEOUT_MS", "90000");
    vi.stubEnv("BB_READ_RETRIES", "0");
    expect(loadConfig()).toMatchObject({ readTimeoutMs: 90_000, readRetries: 0 });

    vi.stubEnv("BB_READ_TIMEOUT_MS", "abc");
    vi.stubEnv("BB_READ_RETRIES", "-1");
    expect(loadConfig()).toMatchObject({ readTimeoutMs: 55_000, readRetries: 2 });
  });
});
