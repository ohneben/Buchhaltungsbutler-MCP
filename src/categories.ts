/**
 * Action categorization for every BuchhaltungsButler API endpoint.
 *
 * Each MCP tool carries:
 *   1. a machine-readable category + MCP annotations (readOnlyHint, destructiveHint, ...)
 *      so the host (Claude) can reason about safety automatically, and
 *   2. a human-readable banner prepended to the tool description so the category
 *      is visible to the model even if it ignores annotations.
 */

export type CategoryId =
  | "read"
  | "create"
  | "update"
  | "link"
  | "revert"
  | "delete";

export interface CategoryMeta {
  id: CategoryId;
  /** Short banner shown at the top of each tool description. */
  banner: string;
  /** Longer one-line explanation of what this class of action does. */
  blurb: string;
  /** MCP tool annotations — consumed by the host for safety/UX. */
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

export const CATEGORIES: Record<CategoryId, CategoryMeta> = {
  read: {
    id: "read",
    banner: "🟢 READ-ONLY",
    blurb: "Fetches data. Makes no changes to the accounting records.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  create: {
    id: "create",
    banner: "🟡 WRITE · creates data",
    blurb:
      "Creates new records (receipts, transactions, postings, invoices, master data). Not idempotent — calling twice may create duplicates.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  update: {
    id: "update",
    banner: "🟡 WRITE · updates data",
    blurb: "Modifies existing master data in place.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  link: {
    id: "link",
    banner: "🟡 WRITE · links/unlinks records",
    blurb:
      "Creates or removes an assignment between records (e.g. receipt ↔ transaction). Reversible.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  revert: {
    id: "revert",
    banner: "🟡 WRITE · reverts state",
    blurb:
      "Reverts a prior state change (un-confirm a posting, restore a deleted receipt). Reversible.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  delete: {
    id: "delete",
    banner: "🔴 DESTRUCTIVE · deletes data",
    blurb:
      "Deletes or cancels a record. Confirm with the user before calling. Receipt deletes are restorable; cost-location deletes are not. Cancelling a posting deletes it if it is not yet fixed, otherwise it books a reversal posting.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
};

/**
 * Explicit category for every path in the v1 spec (54 endpoints).
 * Curated by hand rather than inferred, so categorization is exact.
 */
export const PATH_CATEGORY: Record<string, CategoryId> = {
  // ---- READ-ONLY ----------------------------------------------------------
  "/accounts/get": "read",
  "/cost-locations/get": "read",
  "/postings/get": "read",
  "/receipts/get": "read",
  "/receipts/get/id_by_customer": "read",
  "/receipts/assigned-transactions/get": "read",
  "/transactions/get": "read",
  "/transactions/get/id_by_customer": "read",
  "/transactions/assigned-receipts/get": "read",
  "/settings/get/creditors": "read",
  "/settings/get/debtors": "read",
  "/settings/get/postingaccounts": "read",
  "/reports/get/bwa": "read",
  "/reports/get/sums": "read",
  "/reports/get/sums/ledger": "read",

  // ---- WRITE · create -----------------------------------------------------
  "/accounts/add": "create",
  "/comments/add": "create",
  "/cost-locations/add": "create",
  "/invoices/create": "create",
  "/invoices/create/draft": "create",
  "/invoices/create/e-invoice": "create",
  "/postings/add/free": "create",
  "/postings/add/receipt": "create",
  "/postings/add/transaction": "create",
  "/postings/add-batch/free": "create",
  "/postings/add-batch/receipts": "create",
  "/postings/add-batch/transactions": "create",
  "/receipts/add": "create",
  "/receipts/addBatch": "create",
  "/receipts/upload": "create",
  "/settings/add/creditor": "create",
  "/settings/add/debtor": "create",
  "/settings/add/postingaccount": "create",
  "/settings/add-batch/creditors": "create",
  "/settings/add-batch/debtors": "create",
  "/transactions/add": "create",
  "/transactions/addBatch": "create",
  "/reports/create/bwa": "create",
  "/reports/create/sums": "create",

  // ---- WRITE · update -----------------------------------------------------
  "/cost-locations/update": "update",
  "/settings/update/creditor": "update",
  "/settings/update/debtor": "update",
  "/settings/update/postingaccount": "update",

  // ---- WRITE · link / unlink ---------------------------------------------
  "/postings/assign/receipt-to-free-posting": "link",
  "/transactions/assign/receipt": "link",
  "/transactions/assign-batch/receipt": "link",
  "/transactions/unassign/receipt": "link",

  // ---- WRITE · revert state ----------------------------------------------
  "/postings/unconfirm/free": "revert",
  "/postings/unconfirm/receipt": "revert",
  "/postings/unconfirm/transaction": "revert",
  "/receipts/restore/id_by_customer": "revert",

  // ---- DESTRUCTIVE · delete ----------------------------------------------
  "/cost-locations/delete": "delete",
  "/receipts/delete/id_by_customer": "delete",
  "/postings/cancel": "delete",
};

export function categoryForPath(path: string): CategoryMeta {
  const id = PATH_CATEGORY[path];
  if (!id) {
    // Unknown path: fail safe by treating as a write so it isn't mistaken
    // for harmless. (Should never happen — every v1 path is mapped above.)
    return CATEGORIES.create;
  }
  return CATEGORIES[id];
}
