/** Narrow corrections for postings and receipt assignments in the vendor's v1 spec.
 * See docs/write-postings.md for observed responses and scope.
 */
import type { JsonSchema } from "./spec.js";

function writeBatchKey(path: string): "receipts" | "transactions" | "transactions_to_receipts" | undefined {
  if (path === "/postings/add-batch/receipts") return "receipts";
  if (path === "/postings/add-batch/transactions") return "transactions";
  if (path === "/transactions/assign-batch/receipt") return "transactions_to_receipts";
  return undefined;
}

export function correctPostingInput(path: string, schema: JsonSchema): void {
  const key = writeBatchKey(path);
  if (key === "transactions_to_receipts") return;
  const item = key ? schema.properties?.[key]?.items : undefined;
  const props = item?.properties;
  if (!item || !props) return;

  if (key === "receipts") {
    // The batch definition has a typo; live calls and the single endpoint
    // both use postingtexts. Do not invent or rewrite posting text values.
    if (props.postingstexts) {
      props.postingtexts ??= props.postingstexts;
      delete props.postingstexts;
    }
    item.required = [...new Set([
      ...(item.required ?? []).filter(k => !["creditor", "debtor", "postingstexts"].includes(k)),
      "postingtexts",
    ])];
    // Creditor/debtor requirements depend on the receipt direction and the
    // customer's settings. The API still checks them when needed.
  } else {
    item.required = (item.required ?? []).filter(k => k !== "oi_receipts_ids_by_customer");
    const ids = props.oi_receipts_ids_by_customer?.items;
    if (ids?.type) {
      ids.type = [...new Set([...(Array.isArray(ids.type) ? ids.type : [ids.type]), "null"])];
    }
  }
}

export function correctWriteOutput(path: string, schema: JsonSchema): void {
  const key = writeBatchKey(path);
  if (!key) return;
  if (key === "transactions_to_receipts") {
    const props = schema.properties?.[key]?.items?.properties;
    // Successful live assignments return numeric IDs. Preserve strings too,
    // without coercing the actual response or accepting fractional IDs.
    for (const name of ["transaction_id_by_customer", "receipt_id_by_customer"]) {
      const field = props?.[name];
      if (field?.type === "string") field.type = ["string", "integer"];
    }
  }
  const data = schema.properties?.errors?.items?.properties?.request_data;
  // Observed failures contain the submitted item as an object. Keep the
  // documented array form as well, without relaxing the rest of the schema.
  // For assignments this is defensive compatibility, not a live failure sample.
  if (data?.type === "array") data.type = ["array", "object"];
}

export function hasWriteBatchErrors(path: string, body: unknown): body is Record<string, unknown> {
  const key = writeBatchKey(path);
  if (!key || !body || typeof body !== "object" || Array.isArray(body)) return false;
  const result = body as Record<string, unknown>;
  if (Array.isArray(result.errors) && result.errors.length > 0) return true;
  const items = result[key];
  return Array.isArray(items) && items.some(item =>
    item && typeof item === "object" && item.success === false
  );
}
