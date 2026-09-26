import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { BBClient } from "../src/client.js";
import { createServer } from "../src/server.js";
import { buildToolDefs } from "../src/spec.js";

// Synthetic values only. Keep the observed response shape, not customer data.
const receipt = {
  receipt_id_by_customer: 123,
  creditor: 70000,
  postingaccounts: [4980],
  postingtexts: ["Example receipt"],
  amounts: [11.9],
  vats: ["19_pre"],
};
const transaction = {
  transaction_id_by_customer: 456,
  postingaccounts: [4980],
  postingtexts: ["Example payment"],
  amounts: [11.9],
  vats: ["19_pre"],
};
const assignment = { transaction_id_by_customer: 456, receipt_id_by_customer: 123 };
const cases = [
  { name: "postings_create_for_receipt", path: "/postings/add-batch/receipts", key: "receipts", item: receipt },
  { name: "postings_create_for_transaction", path: "/postings/add-batch/transactions", key: "transactions", item: transaction },
  // Assignment error variants are defensive tests; numeric success IDs were observed live.
  { name: "transactions_assign_receipts", path: "/transactions/assign-batch/receipt", key: "transactions_to_receipts", item: assignment },
];
const defs = buildToolDefs();
const validators = new AjvJsonSchemaValidator();
function inputValid(name: string, args: unknown): boolean {
  return validators.getValidator(defs.find(t => t.name === name)!.inputSchema)(args).valid;
}

describe("posting inputs accepted by the advertised schema", () => {
  it("accepts an incoming receipt with postingtexts and only a creditor", () => {
    expect(inputValid(cases[0].name, { receipts: [receipt] })).toBe(true);
  });
  it("accepts an outgoing receipt with only a debtor", () => {
    const { creditor: _creditor, ...rest } = receipt;
    expect(inputValid(cases[0].name, { receipts: [{ ...rest, debtor: 10000 }] })).toBe(true);
  });
  it("allows the API to decide whether a personal account is needed", () => {
    const { creditor: _creditor, ...rest } = receipt;
    expect(inputValid(cases[0].name, { receipts: [rest] })).toBe(true);
  });
  it("requires postingtexts rather than accepting the spec typo alone", () => {
    const { postingtexts, ...rest } = receipt;
    expect(inputValid(cases[0].name, {
      receipts: [{ ...rest, debtor: 10000, postingstexts: postingtexts }],
    })).toBe(false);
  });
  it("does not require OI references for every payment", () => {
    expect(inputValid(cases[1].name, { transactions: [transaction] })).toBe(true);
  });
  it("allows an explicit unassigned split without inventing a receipt ID", () => {
    expect(inputValid(cases[1].name, {
      transactions: [{ ...transaction, oi_receipts_ids_by_customer: [null] }],
    })).toBe(true);
  });
  it("still requires the receipt ID and rejects non-numeric OI references", () => {
    const { receipt_id_by_customer: _id, ...rest } = receipt;
    expect(inputValid(cases[0].name, { receipts: [rest] })).toBe(false);
    expect(inputValid(cases[1].name, {
      transactions: [{ ...transaction, oi_receipts_ids_by_customer: ["not-an-id"] }],
    })).toBe(false);
  });
});

describe.each(cases)("$name responses", ({ name, key, item }) => {
  const schema = defs.find(t => t.name === name)!.outputSchema;
  const valid = validators.getValidator(schema);
  it("accepts an object-form request_data in an error", () => {
    expect(valid({ success: true, [key]: [], errors: [{
      success: false, error_code: 23, message: "No postingtexts are set", request_data: item,
    }] }).valid).toBe(true);
  });
  it("also accepts the array form declared by the vendor spec", () => {
    expect(valid({ success: true, [key]: [], errors: [{
      success: false, error_code: 23, message: "Rejected", request_data: [item],
    }] }).valid).toBe(true);
  });
  it("does not disable validation for unrelated response fields", () => {
    expect(valid({ success: "yes", [key]: [], errors: [] }).valid).toBe(false);
    expect(valid({ success: true, [key]: [], errors: [{ request_data: "wrong shape" }] }).valid).toBe(false);
  });
});

let client: Client;
let server: ReturnType<typeof createServer>;
let body: unknown;
let seen: { path: string; body: Record<string, unknown> }[];
beforeEach(async () => {
  seen = [];
  body = { success: true, message: "" };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen.push({ path: new URL(url).pathname, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  server = createServer(new BBClient({
    apiClient: "test", apiSecret: "test", apiKey: "test",
    baseUrl: "https://example.invalid/api/v1", rateLimit: 90,
  }));
  client = new Client({ name: "write-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  // Register output schemas, so SDK validation is actually exercised.
  await client.listTools();
});
afterEach(async () => {
  await client.close();
  await server.close();
  vi.unstubAllGlobals();
});

describe.each(cases)("$name batch outcomes", ({ name, key, path, item }) => {
  it("keeps a fully successful response and the outgoing fields unchanged", async () => {
    body = { success: true, [key]: [{ success: true, message: "" }], errors: [] };
    const result = await client.callTool({ name, arguments: { [key]: [item] } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(body);
    expect(seen).toEqual([{ path: `/api/v1${path}`, body: { api_key: "test", [key]: [item] } }]);
  });
  it("reports a rejected batch as an error and retains the original details", async () => {
    body = { success: true, [key]: [], errors: [{
      success: false, error_code: 23, message: "No postingtexts are set", request_data: item,
    }] };
    const result = await client.callTool({ name, arguments: { [key]: [item] } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(body);
    expect(seen).toHaveLength(1);
  });
  it("preserves successful items on partial failure and never retries the batch", async () => {
    const other = key === "transactions_to_receipts"
      ? { ...item, receipt_id_by_customer: 124 }
      : { ...item, amounts: [23.8] };
    body = { success: true, [key]: [{ success: true, message: "" }], errors: [{
      success: false, error_code: 23, message: "Rejected", request_data: other,
    }] };
    const result = await client.callTool({ name, arguments: { [key]: [item, other] } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(body);
    expect(seen).toHaveLength(1);
  });
  it("also catches an explicit failure in the item results", async () => {
    body = { success: true, [key]: [{ success: false, message: "Rejected" }], errors: [] };
    const result = await client.callTool({ name, arguments: { [key]: [item] } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(body);
  });
});

it("does not reinterpret negative correction lines as positive amounts", async () => {
  const split = { ...transaction, amounts: [119, -5.95], postingaccounts: [3400, 3736],
    postingtexts: ["Example purchase", "Example discount"], vats: ["19_pre", "19_pre"] };
  body = { success: true, transactions: [{ success: true, message: "" }], errors: [] };
  await client.callTool({ name: cases[1].name, arguments: { transactions: [split] } });
  expect(seen[0].body.transactions).toEqual([split]);
});

it("keeps the existing single-record fallback usable", async () => {
  const result = await client.callTool({ name: cases[0].name, arguments: receipt });
  expect(result.isError).toBeFalsy();
  expect(seen[0].path).toBe("/api/v1/postings/add/receipt");
  expect(seen[0].body).toEqual({ api_key: "test", ...receipt });
});

it("keeps outer API failures marked as errors", async () => {
  body = { success: false, error_code: 1, message: "Rejected" };
  const result = await client.callTool({ name: cases[0].name, arguments: { receipts: [receipt] } });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result.content)).toContain("Rejected");
  expect(seen).toHaveLength(1);
});

it("applies the same batch error handling through the existing legacy alias", async () => {
  body = { success: true, receipts: [], errors: [{
    success: false, error_code: 23, message: "Rejected", request_data: receipt,
  }] };
  const result = await client.callTool({
    name: "postings_add_batch_receipts", arguments: { receipts: [receipt] },
  });
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toEqual(body);
  expect(seen[0].path).toBe("/api/v1/postings/add-batch/receipts");
});

it("does not apply posting-specific error rules to a read tool", async () => {
  body = { success: true, rows: 0, data: [], errors: [{ message: "Unrelated field" }] };
  const result = await client.callTool({ name: "accounts_list", arguments: {} });
  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toEqual(body);
});

describe("receipt assignment response IDs", () => {
  const valid = validators.getValidator(defs.find(t => t.name === "transactions_assign_receipts")!.outputSchema);
  it.each([
    [456, 123], ["456", "123"], [456, "123"], ["456", 123],
  ])("preserves transaction ID %s and receipt ID %s through a strict client", async (transactionId, receiptId) => {
    body = { success: true, transactions_to_receipts: [{
      success: true, message: "", transaction_id_by_customer: transactionId, receipt_id_by_customer: receiptId,
    }], errors: [] };
    expect(valid(body).valid).toBe(true);
    const result = await client.callTool({ name: "transactions_assign_receipts", arguments: {
      transactions_to_receipts: [assignment],
    } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(body);
    expect(seen).toEqual([{ path: "/api/v1/transactions/assign-batch/receipt", body: {
      api_key: "test", transactions_to_receipts: [assignment],
    } }]);
  });
  it.each([null, false, 1.5, {}, []])("rejects invalid ID %j without relaxing the other ID field", id => {
    for (const field of ["transaction_id_by_customer", "receipt_id_by_customer"]) {
      expect(valid({ success: true, transactions_to_receipts: [{
        success: true, message: "", ...assignment, [field]: id,
      }], errors: [] }).valid).toBe(false);
    }
  });
  it("preserves the single-assignment fallback", async () => {
    const result = await client.callTool({ name: "transactions_assign_receipts", arguments: assignment });
    expect(result.isError).toBeFalsy();
    expect(seen).toEqual([{ path: "/api/v1/transactions/assign/receipt", body: { api_key: "test", ...assignment } }]);
  });
  it("reports assignment batch failures through the legacy alias", async () => {
    body = { success: true, transactions_to_receipts: [], errors: [{
      success: false, error_code: 1, message: "Rejected", request_data: assignment,
    }] };
    const result = await client.callTool({ name: "transactions_assign_batch_receipt", arguments: {
      transactions_to_receipts: [assignment],
    } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(body);
    expect(seen).toHaveLength(1);
  });
});
