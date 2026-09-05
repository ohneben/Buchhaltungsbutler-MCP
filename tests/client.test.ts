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

  it("lets an individual call override api_key", async () => {
    const fetchMock = stubFetch();
    await new BBClient(cfg).call("/receipts/get", { api_key: "other-customer" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.api_key).toBe("other-customer");
  });

  it("returns status, ok and parsed body", async () => {
    stubFetch();
    const res = await new BBClient(cfg).call("/accounts/get", {});
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.body).toEqual({ success: true, rows: [] });
  });
});
