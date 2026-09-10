/**
 * Canonical MCP tool names, batch/singleton merges, and legacy aliases.
 *
 * The BuchhaltungsButler paths are not internally consistent: they mix `add`
 * and `create`, and two batch endpoints are camelCase (`/receipts/addBatch`)
 * while the rest are kebab-case (`/postings/add-batch/free`). Deriving tool
 * names straight from the path carried that inconsistency into the MCP
 * surface, so the names are curated here instead.
 *
 * Scheme: `<resource>_<verb>[_<qualifier>]`, with a fixed verb vocabulary:
 *   list, get, create, update, delete, upload,
 *   assign, unassign, unconfirm, restore, cancel.
 */

/** The tool-name algorithm used up to 1.1.1. Kept to build the alias table. */
export function legacyToolName(path: string): string {
  return path
    .replace(/^\//, "")
    .replace(/[/-]/g, "_")
    .replace(/__+/g, "_");
}

/**
 * Batch endpoints that absorb their single-record twin. The batch path is
 * canonical: it takes a list and therefore covers both cases, so the pair is
 * exposed as one tool instead of two near-identical ones.
 *
 * `param` is the batch array parameter. `singlePath` is still reachable at
 * call time: a call that arrives with the flat single-record fields instead
 * of the array is routed there, which keeps pre-merge callers working.
 */
export interface MergeSpec {
  singlePath: string;
  param: string;
}

export const MERGED_PATHS: Record<string, MergeSpec> = {
  "/receipts/addBatch": { singlePath: "/receipts/add", param: "receipts" },
  "/transactions/addBatch": {
    singlePath: "/transactions/add",
    param: "transactions",
  },
  "/postings/add-batch/free": {
    singlePath: "/postings/add/free",
    param: "free_postings",
  },
  "/postings/add-batch/receipts": {
    singlePath: "/postings/add/receipt",
    param: "receipts",
  },
  "/postings/add-batch/transactions": {
    singlePath: "/postings/add/transaction",
    param: "transactions",
  },
  "/settings/add-batch/creditors": {
    singlePath: "/settings/add/creditor",
    param: "creditors",
  },
  "/settings/add-batch/debtors": {
    singlePath: "/settings/add/debtor",
    param: "debtors",
  },
  "/transactions/assign-batch/receipt": {
    singlePath: "/transactions/assign/receipt",
    param: "transactions_to_receipts",
  },
};

/** Paths that are folded into a merged tool and get no tool of their own. */
export const ABSORBED_PATHS = new Set(
  Object.values(MERGED_PATHS).map((m) => m.singlePath)
);

/** Canonical tool name for every path that becomes a tool of its own. */
export const TOOL_NAMES: Record<string, string> = {
  // accounts
  "/accounts/get": "accounts_list",
  "/accounts/add": "accounts_create",

  // comments
  "/comments/add": "comments_create",

  // cost locations
  "/cost-locations/get": "cost_locations_list",
  "/cost-locations/add": "cost_locations_create",
  "/cost-locations/update": "cost_locations_update",
  "/cost-locations/delete": "cost_locations_delete",

  // invoices
  "/invoices/create": "invoices_create",
  "/invoices/create/draft": "invoices_create_draft",
  "/invoices/create/e-invoice": "invoices_create_e_invoice",

  // postings
  "/postings/get": "postings_list",
  "/postings/add-batch/free": "postings_create_free",
  "/postings/add-batch/receipts": "postings_create_for_receipt",
  "/postings/add-batch/transactions": "postings_create_for_transaction",
  "/postings/assign/receipt-to-free-posting": "postings_assign_receipt_to_free",
  "/postings/unconfirm/free": "postings_unconfirm_free",
  "/postings/unconfirm/receipt": "postings_unconfirm_for_receipt",
  "/postings/unconfirm/transaction": "postings_unconfirm_for_transaction",
  "/postings/cancel": "postings_cancel",

  // receipts
  "/receipts/get": "receipts_list",
  "/receipts/get/id_by_customer": "receipts_get_by_id",
  "/receipts/addBatch": "receipts_create",
  "/receipts/upload": "receipts_upload",
  "/receipts/delete/id_by_customer": "receipts_delete",
  "/receipts/restore/id_by_customer": "receipts_restore",
  "/receipts/assigned-transactions/get": "receipts_list_assigned_transactions",

  // reports
  "/reports/create/bwa": "reports_create_bwa",
  "/reports/get/bwa": "reports_get_bwa",
  "/reports/create/sums": "reports_create_sums",
  "/reports/get/sums": "reports_get_sums",
  "/reports/get/sums/ledger": "reports_get_sums_ledger",

  // creditors / debtors / posting accounts (BB groups these under /settings)
  "/settings/get/creditors": "creditors_list",
  "/settings/add-batch/creditors": "creditors_create",
  "/settings/update/creditor": "creditors_update",
  "/settings/get/debtors": "debtors_list",
  "/settings/add-batch/debtors": "debtors_create",
  "/settings/update/debtor": "debtors_update",
  "/settings/get/postingaccounts": "postingaccounts_list",
  "/settings/add/postingaccount": "postingaccounts_create",
  "/settings/update/postingaccount": "postingaccounts_update",

  // transactions
  "/transactions/get": "transactions_list",
  "/transactions/get/id_by_customer": "transactions_get_by_id",
  "/transactions/addBatch": "transactions_create",
  "/transactions/assign-batch/receipt": "transactions_assign_receipts",
  "/transactions/unassign/receipt": "transactions_unassign_receipt",
  "/transactions/assigned-receipts/get": "transactions_list_assigned_receipts",
};

/**
 * Old name -> current name, for every path that had a tool before the rename,
 * including the single-record halves of the merged pairs. These are accepted
 * by the call router but deliberately not listed in `tools/list`: an agent
 * reading the catalogue sees one name per capability, while a call hardcoded
 * against an older release still resolves.
 *
 * No legacy name may collide with a canonical name of a *different* tool, or
 * an old call would silently reach the wrong endpoint. `tests/naming.test.ts`
 * enforces that.
 */
export function buildAliases(allPaths: string[]): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const path of allPaths) {
    const merge = MERGED_PATHS[path];
    const canonicalPath = ABSORBED_PATHS.has(path)
      ? Object.keys(MERGED_PATHS).find(
          (b) => MERGED_PATHS[b].singlePath === path
        )!
      : path;
    const current = TOOL_NAMES[canonicalPath];
    if (!current) continue;
    const old = legacyToolName(path);
    if (old !== current) aliases[old] = current;
    if (merge) {
      const oldSingle = legacyToolName(merge.singlePath);
      if (oldSingle !== current) aliases[oldSingle] = current;
    }
  }
  return aliases;
}
