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
  it.each([
    ["creditors_list", {}, { email: null, uid_ch: null }],
    ["debtors_list", {}, { email: null, uid_ch: null }],
    ["postingaccounts_list", {}, { parent_name: null, subtype: null }],
    ["postings_list", { date_from: "2023-01-01", date_to: "2023-01-31" }, { date_delivery: null, booking_number: 1, transaction_amount: null, transaction_id_by_customer: null }],
    ["receipts_list", { list_direction: "inbound" }, { due_date: null, link_to_receipt_id_by_customer: null }],
    ["transactions_list", {}, { id_by_customer: 123, purpose: null }],
    ["postings_list", { date_from: "2023-01-01", date_to: "2023-01-31" }, { receipt_id_by_customer: null }],
    ["receipts_list", { list_direction: "inbound" }, { payment_date: null, account: null, invoicenumber: null, amount: null }],
    ["receipts_list_assigned_transactions", { receipt_id_by_customer: 1 }, { id_by_customer: 123 }],
    ["transactions_list_assigned_receipts", { transaction_id_by_customer: 1 }, { id_by_customer: 123 }],
  ])("preserves observed API response types for %s", async (name, args, row) => {
    const payload = { success: true, data: [row] };
    stubFetch(payload);
    await client.listTools();
    const res = await client.callTool({ name: name as string, arguments: args as Record<string, unknown> });
    expect(res.structuredContent).toEqual(payload);
  });

  it.each([
    ["receipts_get_by_id", "/receipts/get/123", { id_by_customer: "123", amount_original: null, currency_original: null, exchangerate: null, e_invoice_type: 0, payment_reference: null, date_delivery: null, date_payment_due: null, link_to_receipt_id_by_customer: null }],
    ["transactions_get_by_id", "/transactions/get/123", { id_by_customer: 123, bank_name: null, type: null, booking_text: null }],
  ])("routes %s using the numeric ID and validates the unchanged result", async (name, path, data) => {
    const payload = { success: true, data };
    const seen = stubFetch(payload);
    const { tools } = await client.listTools();
    expect(tools.find(t => t.name === name)!.inputSchema.required).toContain("id_by_customer");
    const res = await client.callTool({ name: name as string, arguments: { id_by_customer: 123 } });
    expect(seen[0].path).toBe(path);
    expect(seen[0].body).not.toHaveProperty("id_by_customer");
    expect(res.structuredContent).toEqual(payload);
  });

  it.each([undefined, 0, -1, 1.5, "../add", Number.MAX_SAFE_INTEGER + 1])("rejects an unsafe single-record ID before network access: %s", async (id) => {
    const seen = stubFetch();
    for (const name of ["receipts_get_by_id", "transactions_get_by_id"]) {
      const res = await client.callTool({ name, arguments: { id_by_customer: id } });
      expect(res.isError).toBe(true);
    }
    expect(seen).toHaveLength(0);
  });

  it("accepts unassigned ledger numbers without altering the account response", async () => {
    const payload = { success: true, rows: 2, data: [
      { name: "Assigned", postingaccount_number: "1200" },
      { name: "Unassigned", postingaccount_number: null },
    ] };
    stubFetch(payload);
    await client.listTools();
    const res = await client.callTool({ name: "accounts_list", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual(payload);
  });

  it("still rejects unrelated invalid ledger-number types", async () => {
    stubFetch({ success: true, data: [{ postingaccount_number: false }] });
    await client.listTools();
    await expect(client.callTool({ name: "accounts_list", arguments: {} }))
      .rejects.toThrow(/output schema/);
  });

  it("preserves null detail fields without replacing unknown tax or payment values", async () => {
    const payload = { success: true, data: { id_by_customer: "123", amount: null, vat: null, payment_date: null, account: null, invoicenumber: null } };
    stubFetch(payload);
    await client.listTools();
    const res = await client.callTool({ name: "receipts_get_by_id", arguments: { id_by_customer: 123 } });
    expect(res.structuredContent).toEqual(payload);
  });

  it("still rejects malformed receipt amounts", async () => {
    stubFetch({ success: true, data: [{ amount: false }] });
    await client.listTools();
    await expect(client.callTool({ name: "receipts_list", arguments: { list_direction: "inbound" } }))
      .rejects.toThrow(/output schema/);
  });

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

describe("transaction pagination remains a transparent single-page call", () => {
  it("forwards exclusive cursor and fixed filters without adding an offset", async () => {
    const payload = { success: true, rows: 1, data: [{ id_by_customer: 124, amount: "-12.30" }] };
    const seen = stubFetch(payload);
    await client.listTools();
    const args = { account: 1200, date_from: "2025-01-01", date_to: "2025-12-31", id_by_customer_from: 123, id_by_customer_to: 200, limit: 2 };
    const res = await client.callTool({ name: "transactions_list", arguments: args });
    expect(seen).toEqual([{ path: "/transactions/get", body: { api_key: "k", ...args } }]);
    expect(res.structuredContent).toEqual(payload);
  });

  it("preserves overlapping page responses so the caller can detect them", async () => {
    const payload = { success: true, rows: 1, data: [{ id_by_customer: 123, amount: "-12.30" }] };
    const seen = stubFetch(payload);
    await client.listTools();
    for (const offset of [0, 1]) {
      const res = await client.callTool({ name: "transactions_list", arguments: { limit: 1, offset } });
      expect(res.structuredContent).toEqual(payload);
    }
    expect(seen.map((x) => x.body.offset)).toEqual([0, 1]);
    expect(seen).toHaveLength(2);
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
