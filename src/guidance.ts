/**
 * Per-tool usage guidance, keyed by canonical endpoint path.
 *
 * The BuchhaltungsButler spec supplies a summary and a short description for
 * each endpoint. That answers "what does this do" but not "when do I reach
 * for this one instead of its neighbour", which is exactly what an agent
 * choosing between 46 accounting tools needs. The three fields below are
 * appended to the generated description:
 *
 *   use    when this tool is the right choice
 *   avoid  the neighbouring tool it is most likely to be confused with
 *   note   behaviour worth knowing before the call: side effects, ordering
 *          constraints, and the lifecycle operations v1 does not offer
 *
 * `note` states missing endpoints out loud on purpose. A resource that can be
 * created but not deleted looks like an oversight until the description says
 * the API has no such endpoint.
 */

export interface Guidance {
  use: string;
  avoid?: string;
  note?: string;
}

const CUSTOMER_ID_NOTE =
  "`id_by_customer` is the per-customer counter shown in the BuchhaltungsButler UI, not a global database id.";

export const GUIDANCE: Record<string, Guidance> = {
  // ---- accounts -----------------------------------------------------------
  "/accounts/get": {
    use: "Use to list the bank, cash and credit-card accounts that transactions can be booked against, e.g. to resolve an account name to the numeric `account` id the transaction tools expect.",
    avoid:
      "Not the chart of accounts. For posting account numbers such as 1200 or 4400, use `postingaccounts_list`.",
    note: "v1 offers no update or delete endpoint for accounts. An account created here can only be listed afterwards.",
  },
  "/accounts/add": {
    use: "Use to register a new bank, cash or credit-card account before importing transactions for it.",
    avoid:
      "Not for chart-of-accounts entries. To add a posting account number, use `postingaccounts_create`.",
    note: "Not idempotent: calling twice with the same name creates two accounts. Check `accounts_list` first. v1 offers no way to update or delete an account afterwards.",
  },

  // ---- comments -----------------------------------------------------------
  "/comments/add": {
    use: "Use to attach a free-text note to one receipt or one transaction, for example to record why a booking was categorised the way it was.",
    note: "Exactly one of `transaction_id_by_customer` or `receipt_id_by_customer` must be set. v1 offers no endpoint to read, edit or delete comments, so a comment written here can only be seen in the BuchhaltungsButler web app.",
  },

  // ---- cost locations -----------------------------------------------------
  "/cost-locations/get": {
    use: "Use to list the cost centres available for the `cost_location` fields on the posting tools.",
  },
  "/cost-locations/add": {
    use: "Use to create a cost centre before referencing it from a posting.",
    note: "Not idempotent. Check `cost_locations_list` first to avoid a duplicate.",
  },
  "/cost-locations/update": {
    use: "Use to rename an existing cost centre or change its number.",
    note: "Overwrites the fields you send. Read the current record with `cost_locations_list` first if you intend a partial change.",
  },
  "/cost-locations/delete": {
    use: "Use to remove a cost centre that is no longer needed.",
    note: "Permanent. Unlike a deleted receipt there is no restore endpoint, so confirm with the user before calling.",
  },

  // ---- invoices -----------------------------------------------------------
  "/invoices/create": {
    use: "Use to issue a final outgoing invoice that is booked immediately.",
    avoid:
      "For an invoice that should stay editable, use `invoices_create_draft`. For a structured XML invoice in XRechnung or ZUGFeRD format, use `invoices_create_e_invoice`.",
    note: "Not idempotent: a second call issues a second invoice with a new number. v1 offers no endpoint to list, change or cancel an invoice once created.",
  },
  "/invoices/create/draft": {
    use: "Use to prepare an invoice that a human should review and release in the BuchhaltungsButler web app.",
    avoid:
      "A draft is not booked and carries no invoice number. To issue a final invoice directly, use `invoices_create`.",
    note: "v1 offers no endpoint to list, edit or release drafts. Releasing happens in the web app.",
  },
  "/invoices/create/e-invoice": {
    use: "Use when the recipient requires a structured electronic invoice, for example a German public-sector customer expecting XRechnung.",
    avoid:
      "For an ordinary PDF invoice, use `invoices_create`.",
    note: "Not idempotent. v1 offers no endpoint to list or cancel an e-invoice once created.",
  },

  // ---- postings -----------------------------------------------------------
  "/postings/get": {
    use: "Use to read the booking journal, filtered by date range or posting account.",
    note: "Supports `limit` and `offset`. Ask for a bounded date range rather than paging through a whole financial year.",
  },
  "/postings/add-batch/free": {
    use: "Use to book a debit/credit pair that is not tied to an existing receipt or bank transaction, such as a manual accrual or a correction.",
    avoid:
      "If the booking documents a receipt, use `postings_create_for_receipt`. If it settles a bank transaction, use `postings_create_for_transaction`.",
    note: 'A "free" posting is BuchhaltungsButler\'s term for a standalone journal entry: you name both sides yourself via `postingaccount_debit` and `postingaccount_credit`. Not idempotent, so a repeated call books the amount twice. A receipt can be attached afterwards with `postings_assign_receipt_to_free`.',
  },
  "/postings/add-batch/receipts": {
    use: "Use to book one or more receipts that already exist in BuchhaltungsButler, splitting each across posting accounts, VAT rates and cost centres.",
    avoid:
      "For a journal entry with no receipt behind it, use `postings_create_free`.",
    note: "The per-receipt arrays (`postingaccounts`, `amounts`, `vats`, `postingtexts`) are positional: index 0 of each describes the same split line, so they must all have the same length. Not idempotent. Reversible with `postings_unconfirm_for_receipt` while the posting is not fixed.",
  },
  "/postings/add-batch/transactions": {
    use: "Use to book one or more bank transactions, splitting each across posting accounts, VAT rates and cost centres.",
    avoid:
      "For a journal entry with no bank transaction behind it, use `postings_create_free`.",
    note: "The per-transaction arrays are positional and must all have the same length. Not idempotent. Reversible with `postings_unconfirm_for_transaction` while the posting is not fixed.",
  },
  "/postings/assign/receipt-to-free-posting": {
    use: "Use to attach a receipt to a free posting that was booked without one, so the entry has its supporting document.",
    avoid:
      "To link a receipt to a bank transaction rather than a posting, use `transactions_assign_receipts`.",
  },
  "/postings/unconfirm/free": {
    use: "Use to send a free posting back to the unconfirmed state so it can be corrected.",
    avoid:
      "This keeps the posting and only clears its confirmation. To remove the posting itself, use `postings_cancel`.",
    note: "Only works while the posting is not fixed. Fixed postings can no longer be unconfirmed.",
  },
  "/postings/unconfirm/receipt": {
    use: "Use to send a receipt posting back to the unconfirmed state so it can be corrected.",
    avoid:
      "This keeps the posting and only clears its confirmation. To remove the posting itself, use `postings_cancel`.",
    note: "Only works while the posting is not fixed.",
  },
  "/postings/unconfirm/transaction": {
    use: "Use to send a transaction posting back to the unconfirmed state so it can be corrected.",
    avoid:
      "This keeps the posting and only clears its confirmation. To remove the posting itself, use `postings_cancel`.",
    note: "Only works while the posting is not fixed.",
  },
  "/postings/cancel": {
    use: "Use to take a booking out of the books entirely.",
    avoid:
      "This is stronger than the `postings_unconfirm_*` tools: those keep the posting and only clear its confirmation, this one removes or reverses it. Prefer unconfirming when the goal is to edit and rebook.",
    note: "The effect depends on the posting: one that is not yet fixed is deleted outright, a fixed one stays and is offset by a reversal posting, which leaves two visible entries in the journal. Confirm with the user before calling.",
  },

  // ---- receipts -----------------------------------------------------------
  "/receipts/get": {
    use: "Use to search receipts by direction, date range or payment status.",
    avoid:
      "To fetch one known receipt, use `receipts_get_by_id`.",
    note: "`list_direction` is required and selects inbound or outbound receipts. Supports `limit` and `offset`; the response reports the total in `rows`.",
  },
  "/receipts/get/id_by_customer": {
    use: "Use to fetch a single receipt whose id you already have.",
    avoid: "To search or page through receipts, use `receipts_list`.",
    note: CUSTOMER_ID_NOTE,
  },
  "/receipts/addBatch": {
    use: "Use to record receipts that have no file attached, for example when the document lives in another system.",
    avoid:
      "If you have the actual PDF or image, use `receipts_upload` instead so BuchhaltungsButler can read the document and pre-fill its data.",
    note: "Not idempotent: a repeated call creates duplicate receipts. The response reports per-item success, so a partial failure leaves the successful entries in place.",
  },
  "/receipts/upload": {
    use: "Use to send the actual receipt file. BuchhaltungsButler runs document recognition on it and returns the stored filename.",
    avoid:
      "To record a receipt without a file, use `receipts_create`.",
    note: "Rate limited to 10 requests per minute. Not idempotent, so uploading the same file twice creates two receipts.",
  },
  "/receipts/delete/id_by_customer": {
    use: "Use to remove a receipt that was filed by mistake.",
    note: "Recoverable: `receipts_restore` brings the receipt back. Confirm with the user before calling.",
  },
  "/receipts/restore/id_by_customer": {
    use: "Use to bring back a receipt that was deleted with `receipts_delete`.",
  },
  "/receipts/assigned-transactions/get": {
    use: "Use to see which bank transactions are linked to a given receipt, for example to check whether an invoice has been matched to a payment.",
    avoid:
      "For the opposite direction, use `transactions_list_assigned_receipts`.",
  },

  // ---- reports ------------------------------------------------------------
  "/reports/create/bwa": {
    use: "Use to request a BWA (Betriebswirtschaftliche Auswertung, the German management report). Step one of two.",
    avoid:
      "This only triggers generation. To read the finished report, call `reports_get_bwa` afterwards.",
    note: "Runs asynchronously and returns an id, not the report. A new BWA can only be requested once the previous one has finished, and it replaces the previous one.",
  },
  "/reports/get/bwa": {
    use: "Use to read a BWA that `reports_create_bwa` has finished generating. Step two of two.",
    note: "Returns nothing useful until generation has finished. If the report is not ready, wait and retry rather than requesting a new one, since a new request replaces the pending one.",
  },
  "/reports/create/sums": {
    use: "Use to request a sums and balances report (Summen- und Saldenliste). Step one of two.",
    avoid: "To read the finished report, call `reports_get_sums` afterwards.",
    note: "Runs asynchronously and returns an id. A new report may only be requested once the previous one has finished, and it replaces the previous one.",
  },
  "/reports/get/sums": {
    use: "Use to read a sums and balances report that `reports_create_sums` has finished generating. Step two of two.",
    avoid:
      "For the individual bookings behind one posting account, use `reports_get_sums_ledger`.",
  },
  "/reports/get/sums/ledger": {
    use: "Use to drill into one posting account of a finished sums report and see the individual entries behind its balance.",
    avoid:
      "For the totals across all posting accounts, use `reports_get_sums`.",
    note: "Requires a sums report created by `reports_create_sums` to have finished.",
  },

  // ---- creditors / debtors / posting accounts -----------------------------
  "/settings/get/creditors": {
    use: "Use to list suppliers, for example to resolve a supplier name to the `creditor` id the receipt and posting tools expect.",
    avoid: "For customers you invoice, use `debtors_list`.",
    note: "Supports `limit` and `offset`; the response reports the total in `rows`, so page until you have seen that many rows. v1 offers no delete endpoint for creditors, so they can only be created, listed and updated.",
  },
  "/settings/add-batch/creditors": {
    use: "Use to create one or more suppliers.",
    avoid: "For customers you invoice, use `debtors_create`.",
    note: "Not idempotent: check `creditors_list` first, since a repeated call creates duplicate suppliers. v1 offers no delete endpoint, so a creditor created here can only be updated afterwards, never removed.",
  },
  "/settings/update/creditor": {
    use: "Use to change a supplier's address, bank details or payment terms.",
    note: "Overwrites the fields you send. Read the current record with `creditors_list` first if you intend a partial change.",
  },
  "/settings/get/debtors": {
    use: "Use to list customers, for example to resolve a customer name to the `debtor` id the receipt and posting tools expect.",
    avoid: "For suppliers you buy from, use `creditors_list`.",
    note: "Supports `limit` and `offset`. v1 offers no delete endpoint for debtors, so they can only be created, listed and updated.",
  },
  "/settings/add-batch/debtors": {
    use: "Use to create one or more customers.",
    avoid: "For suppliers you buy from, use `creditors_create`.",
    note: "Not idempotent: check `debtors_list` first. v1 offers no delete endpoint, so a debtor created here can only be updated afterwards, never removed.",
  },
  "/settings/update/debtor": {
    use: "Use to change a customer's address, bank details or customer number.",
    note: "Overwrites the fields you send. Read the current record with `debtors_list` first if you intend a partial change.",
  },
  "/settings/get/postingaccounts": {
    use: "Use to list the chart of accounts, for example to find the posting account number for office supplies before booking.",
    avoid:
      "Not bank accounts. For the bank, cash and credit-card accounts transactions belong to, use `accounts_list`.",
    note: "Supports `limit` and `offset`; a full SKR chart runs to several hundred rows, so page until `rows` is covered or filter instead. v1 offers no delete endpoint for posting accounts.",
  },
  "/settings/add/postingaccount": {
    use: "Use to add an account number to the chart of accounts that the standard chart does not cover.",
    avoid:
      "To register a bank or cash account, use `accounts_create`.",
    note: "Not idempotent. v1 offers no delete endpoint, so a posting account created here can only be updated afterwards.",
  },
  "/settings/update/postingaccount": {
    use: "Use to rename a posting account or change its properties.",
    note: "Overwrites the fields you send. Read the current record with `postingaccounts_list` first if you intend a partial change.",
  },

  // ---- transactions -------------------------------------------------------
  "/transactions/get": {
    use: "Use to search bank transactions by account and date range.",
    avoid: "To fetch one known transaction, use `transactions_get_by_id`.",
    note: "Supports `limit` and `offset`; the response reports the total in `rows`. Ask for a bounded date range rather than the full history.",
  },
  "/transactions/get/id_by_customer": {
    use: "Use to fetch a single bank transaction whose id you already have.",
    avoid: "To search or page through transactions, use `transactions_list`.",
    note: CUSTOMER_ID_NOTE,
  },
  "/transactions/addBatch": {
    use: "Use to import bank transactions that no bank connection delivers automatically, for example from a CSV export or a cash book.",
    note: "Not idempotent and there is no duplicate detection: re-importing the same statement books every line a second time. Check `transactions_list` for the date range first. v1 offers no endpoint to update or delete an imported transaction.",
  },
  "/transactions/assign-batch/receipt": {
    use: "Use to match receipts to the bank transactions that paid them, one pair or many at once.",
    avoid:
      "To attach a receipt to a posting rather than a bank transaction, use `postings_assign_receipt_to_free`.",
    note: "Reversible with `transactions_unassign_receipt`. Creating the link does not book anything: use `postings_create_for_transaction` to post the transaction.",
  },
  "/transactions/unassign/receipt": {
    use: "Use to undo a receipt-to-transaction match that was made in error.",
    note: "Removes only the link. Neither the receipt nor the transaction is deleted.",
  },
  "/transactions/assigned-receipts/get": {
    use: "Use to see which receipts are linked to a given bank transaction, for example to check whether a payment has its invoice attached.",
    avoid:
      "For the opposite direction, use `receipts_list_assigned_transactions`.",
  },
};
