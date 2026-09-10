/**
 * End-to-end routing over a real MCP session: which endpoint a tool call
 * reaches, and what the caller gets back.
 *
 * These cover the promise the rename makes. Old names stay callable and reach
 * the same endpoint they always did, and a merged create tool serves both the
 * array form and the single-record form.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BBClient } from "../src/client.js";
import { createServer } from "../src/server.js";

const CONFIG = {
  apiClient: "c",
  apiSecret: "s",
  apiKey: "k",
  baseUrl: "https://example.invalid/api/v1",
  rateLimit: 90,
};

/** Records the path of every call and answers with a BB success envelope. */
function stubFetch(body: unknown = { success: true, message: "" }) {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      seen.push({
        path: new URL(url).pathname.replace("/api/v1", ""),
        body: JSON.parse(init.body),
      });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
  return seen;
}

async function connect() {
  const server = createServer(new BBClient(() => CONFIG));
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  return client;
}

let client: Client;
beforeEach(async () => {
  client = await connect();
});
afterEach(async () => {
  await client.close();
  vi.unstubAllGlobals();
});

describe("tools/list", () => {
  it("advertises 46 tools, each with an output schema", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(46);
    for (const t of tools) {
      expect(t.outputSchema?.type).toBe("object");
      expect(t.annotations?.title).toBeTruthy();
    }
  });

  it("does not advertise the legacy names", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("receipts_list");
    expect(names).not.toContain("receipts_get");
    expect(names).not.toContain("receipts_addBatch");
    expect(names).not.toContain("settings_get_creditors");
  });
});

describe("legacy names stay callable", () => {
  it("routes an old read name to the endpoint it always reached", async () => {
    const seen = stubFetch();
    await client.callTool({ name: "settings_get_creditors", arguments: {} });
    expect(seen[0].path).toBe("/settings/get/creditors");
  });

  it("routes the old single-record create to the single-record endpoint", async () => {
    const seen = stubFetch();
    await client.callTool({
      name: "receipts_add",
      arguments: {
        type: "invoice inbound",
        counterparty: "Peter Maier",
        invoice_number: "1231XU23",
        date: "2026-01-31",
        amount: 11.9,
        currency: "EUR",
      },
    });
    expect(seen[0].path).toBe("/receipts/add");
    expect(seen[0].body.counterparty).toBe("Peter Maier");
  });

  it("routes the old batch name to the batch endpoint", async () => {
    const seen = stubFetch();
    await client.callTool({
      name: "receipts_addBatch",
      arguments: { receipts: [{ counterparty: "Peter Maier" }] },
    });
    expect(seen[0].path).toBe("/receipts/addBatch");
  });

  it("reports an unknown name as an error, not a silent no-op", async () => {
    stubFetch();
    const res = await client.callTool({ name: "receipts_nope", arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("Unknown tool");
  });
});

describe("merged create tools", () => {
  it("sends the array form to the batch endpoint", async () => {
    const seen = stubFetch();
    await client.callTool({
      name: "receipts_create",
      arguments: { receipts: [{ counterparty: "A" }, { counterparty: "B" }] },
    });
    expect(seen[0].path).toBe("/receipts/addBatch");
    expect((seen[0].body.receipts as unknown[]).length).toBe(2);
  });

  it("falls back to the single-record endpoint when the array is absent", async () => {
    const seen = stubFetch();
    await client.callTool({
      name: "transactions_create",
      arguments: { account: 1, to_from: "X", amount: 5, booking_date: "2026-01-31" },
    });
    expect(seen[0].path).toBe("/transactions/add");
  });

  it("keeps the assignment pair working under its new plural name", async () => {
    const seen = stubFetch();
    await client.callTool({
      name: "transactions_assign_receipts",
      arguments: {
        transactions_to_receipts: [
          { transaction_id_by_customer: 1, receipt_id_by_customer: 2 },
        ],
      },
    });
    expect(seen[0].path).toBe("/transactions/assign-batch/receipt");
  });
});

describe("results", () => {
  it("returns the parsed envelope as structured content", async () => {
    stubFetch({ success: true, rows: 1, data: [{ name: "Kasse" }] });
    const res = await client.callTool({ name: "accounts_list", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { rows: number }).rows).toBe(1);
  });

  it("surfaces a success:false envelope as an error", async () => {
    stubFetch({ success: false, message: "nope" });
    const res = await client.callTool({ name: "accounts_list", arguments: {} });
    expect(res.isError).toBe(true);
  });
});

describe("tool policy still binds through aliases", () => {
  it("an old name cannot reach a tool the allowlist excludes", async () => {
    vi.stubEnv("BB_TOOL_ALLOWLIST", "accounts_list");
    const restricted = await connect();
    try {
      stubFetch();
      const res = await restricted.callTool({
        name: "settings_get_creditors",
        arguments: {},
      });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain("disabled by server policy");
    } finally {
      await restricted.close();
      vi.unstubAllEnvs();
    }
  });
});
