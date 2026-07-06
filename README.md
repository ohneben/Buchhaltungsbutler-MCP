# ohneben's Buchhaltungsbutler MCP

[![CI](https://github.com/ohneben/Buchhaltungsbutler-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/ohneben/Buchhaltungsbutler-MCP/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE.md)

Manage your [BuchhaltungsButler](https://www.buchhaltungsbutler.de/) bookkeeping in
plain language from AI assistants like **Claude**, **Cursor**, and any other
[MCP](https://modelcontextprotocol.io) client.

This [Model Context Protocol](https://modelcontextprotocol.io) server exposes the
**[BuchhaltungsButler API v1](https://app.buchhaltungsbutler.de/docs/api/v1/)** —
all **48 endpoints**, auto-generated from the official OpenAPI spec into MCP tools.
Every tool is **safety-categorized** (read-only / write / destructive) so your
assistant knows what an action does *before* it calls it. Runs over **stdio**
(Claude Desktop and other local launchers) or **Streamable HTTP** (hosted in Docker).

## Why you'll want this

Some MCP servers just forward an API. This one is built to be **safe to hand to an
LLM** and **easy to run for real**:

| What you get | Why it matters |
| --- | --- |
| **All 48 endpoints, auto-generated** from the official spec | Full coverage of receipts, transactions, postings, invoices and master data — nothing hand-picked or left behind. |
| **Every tool is safety-categorized** 🟢 / 🟡 / 🔴 | A banner at the top of each tool description tells the model exactly what it does — fetch, create, update, revert or delete — before it acts. |
| **Machine-readable MCP annotations** (`readOnlyHint`, `destructiveHint`) | Hosts that honor annotations (Claude included) can auto-trust reads and demand confirmation before anything destructive. |
| **Two transports: stdio *and* Streamable HTTP** | Use it locally in Claude Desktop, or run one always-on server that any number of MCP clients reach over HTTP. |
| **Docker + docker-compose, health check, auto-restart** | Production-style deployment out of the box: `docker compose up` and it stays up. |
| **Optional bearer-token auth** on the HTTP endpoint | Put the server behind a shared secret the moment it's reachable beyond localhost. |
| **Built-in rate limiting** | Self-throttles under BuchhaltungsButler's 100 requests/customer/minute cap so you never trip it. |
| **Your secrets never reach the model** | Credentials live in the server's environment and are injected on every request — the assistant only ever sees tool inputs and API responses. |

## What you can do

Once it's connected, ask your assistant things like:

- "List all inbound receipts from last month that are still unpaid."
- "Create a draft invoice for ACME GmbH: 10 hours of consulting at €120 each."
- "Book this bank transaction against posting account 4400."
- "Upload this PDF receipt and assign it to the matching transaction."
- "Show me my creditors, and add a new one for our hosting provider."

Tools are generated automatically from the official API and grouped into 🟢 read-only,
🟡 write, and 🔴 destructive — so a well-behaved host can treat each group differently.

## How it works

```
Claude / Cursor / any MCP client  ──MCP──►  this server  ──HTTPS──►  BuchhaltungsButler API (cloud)
```

The server parses the bundled OpenAPI spec into MCP tools (resolving `$ref` batch
payloads and stripping HTML from descriptions), tags each with its safety category,
and injects your Basic-auth credentials and `api_key` on every outgoing request.
Your credentials stay in the server's environment — the model never sees or handles
them.

## Requirements

- A **BuchhaltungsButler account with API access** — an **API Client + API Secret**
  (Settings → API) and a **customer `api_key`** (see [Get your API credentials](#get-your-api-credentials)).
- **Docker** (Docker Desktop on macOS/Windows) for the quick start below — or
  **Node.js ≥ 18** to [run from source](#run-from-source-stdio-no-docker).

## Quick start (Docker)

**1. Add your credentials.** Copy the example config and fill it in:

```bash
cp .env.example .env
# edit .env → set BB_API_CLIENT, BB_API_SECRET, BB_API_KEY
#           → set MCP_AUTH_TOKEN to a long random string if reachable beyond localhost
```

**2. Start the server:**

```bash
docker compose up -d --build
```

**3. Confirm it's running:**

```bash
curl -s http://localhost:3000/health     # → {"status":"ok","server":"buchhaltungsbutler-mcp"}
```

**4. Connect your MCP client.** Remote endpoints are added in Claude as a **custom
connector** (Settings → Connectors), or bridged locally with
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote). Add this under `mcpServers`
in your client config, then fully quit and reopen the app:

```json
{
  "mcpServers": {
    "buchhaltungsbutler": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3000/mcp",
        "--header", "Authorization: Bearer YOUR_MCP_AUTH_TOKEN"
      ]
    }
  }
}
```

(Drop the `--header` line if you left `MCP_AUTH_TOKEN` empty.)

## Get your API credentials

BuchhaltungsButler uses two layers of authentication (see the
[official docs](https://app.buchhaltungsbutler.de/docs/api/v1/)):

1. **HTTP Basic auth** — an **API Client** + **API Secret**, your global API
   credentials. Find or create them in BuchhaltungsButler under **Settings → API**.
2. **`api_key`** — identifies *which customer account* a request acts on. It lives in
   that customer's company-data settings.

Put all three in `.env`. The server injects them on every request, so your assistant
never sees them. A single tool call may optionally pass its own `api_key` to target a
different customer.

## Configuration

Everything is set in `.env` (copied from `.env.example`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `BB_API_CLIENT` | ✅ | — | API Client (Basic-auth username) |
| `BB_API_SECRET` | ✅ | — | API Secret (Basic-auth password) |
| `BB_API_KEY` | ✅ | — | Default customer `api_key` |
| `MCP_TRANSPORT` | — | `stdio` | `stdio` or `http` (the Docker image defaults to `http`) |
| `PORT` | — | `3000` | HTTP listen port |
| `HOST` | — | `0.0.0.0` | HTTP bind address |
| `MCP_HTTP_PATH` | — | `/mcp` | HTTP MCP route |
| `MCP_AUTH_TOKEN` | — | _(off)_ | Require `Authorization: Bearer <token>` on `/mcp` |
| `BB_RATE_LIMIT` | — | `90` | Client-side requests/minute cap |
| `BB_BASE_URL` | — | _(from spec)_ | Override the API base URL |

After changing `.env`, reload with `docker compose up -d --force-recreate`.

## Tool safety categories

Each tool's description starts with one of these banners and carries the matching
[MCP annotations](https://modelcontextprotocol.io/docs/concepts/tools#tool-annotations):

| Banner | Count | `readOnlyHint` | `destructiveHint` | Meaning |
|---|---|---|---|---|
| 🟢 **READ-ONLY** | 12 | `true` | `false` | Fetches data only. Safe. |
| 🟡 **WRITE · creates data** | 22 | `false` | `false` | Creates records (not idempotent — may duplicate). |
| 🟡 **WRITE · updates data** | 4 | `false` | `false` | Modifies existing master data in place. |
| 🟡 **WRITE · links/unlinks** | 4 | `false` | `false` | Assigns/unassigns receipt ↔ transaction. Reversible. |
| 🟡 **WRITE · reverts state** | 4 | `false` | `false` | Un-confirms postings / restores receipts. Reversible. |
| 🔴 **DESTRUCTIVE · deletes** | 2 | `false` | `true` | Deletes a record. Confirm first. |

Hosts that respect annotations (Claude included) can require confirmation for
`destructiveHint` tools and trust `readOnlyHint` tools automatically.

> Run `npm run list-tools` (no credentials needed) to print the full catalog at any time.

<details>
<summary><strong>🟢 READ-ONLY (12)</strong></summary>

| Tool | Endpoint |
|---|---|
| `accounts_get` | `POST /accounts/get` |
| `cost_locations_get` | `POST /cost-locations/get` |
| `postings_get` | `POST /postings/get` |
| `receipts_get` | `POST /receipts/get` |
| `receipts_get_id_by_customer` | `POST /receipts/get/id_by_customer` |
| `receipts_assigned_transactions_get` | `POST /receipts/assigned-transactions/get` |
| `transactions_get` | `POST /transactions/get` |
| `transactions_get_id_by_customer` | `POST /transactions/get/id_by_customer` |
| `transactions_assigned_receipts_get` | `POST /transactions/assigned-receipts/get` |
| `settings_get_creditors` | `POST /settings/get/creditors` |
| `settings_get_debtors` | `POST /settings/get/debtors` |
| `settings_get_postingaccounts` | `POST /settings/get/postingaccounts` |
</details>

<details>
<summary><strong>🟡 WRITE · creates data (22)</strong></summary>

| Tool | Endpoint |
|---|---|
| `accounts_add` | `POST /accounts/add` |
| `comments_add` | `POST /comments/add` |
| `cost_locations_add` | `POST /cost-locations/add` |
| `invoices_create` | `POST /invoices/create` |
| `invoices_create_draft` | `POST /invoices/create/draft` |
| `invoices_create_e_invoice` | `POST /invoices/create/e-invoice` |
| `postings_add_free` | `POST /postings/add/free` |
| `postings_add_receipt` | `POST /postings/add/receipt` |
| `postings_add_transaction` | `POST /postings/add/transaction` |
| `postings_add_batch_free` | `POST /postings/add-batch/free` |
| `postings_add_batch_receipts` | `POST /postings/add-batch/receipts` |
| `postings_add_batch_transactions` | `POST /postings/add-batch/transactions` |
| `receipts_add` | `POST /receipts/add` |
| `receipts_addBatch` | `POST /receipts/addBatch` |
| `receipts_upload` | `POST /receipts/upload` |
| `settings_add_creditor` | `POST /settings/add/creditor` |
| `settings_add_debtor` | `POST /settings/add/debtor` |
| `settings_add_postingaccount` | `POST /settings/add/postingaccount` |
| `settings_add_batch_creditors` | `POST /settings/add-batch/creditors` |
| `settings_add_batch_debtors` | `POST /settings/add-batch/debtors` |
| `transactions_add` | `POST /transactions/add` |
| `transactions_addBatch` | `POST /transactions/addBatch` |
</details>

<details>
<summary><strong>🟡 WRITE · updates (4) · links (4) · reverts (4)</strong></summary>

| Tool | Endpoint | Sub-category |
|---|---|---|
| `cost_locations_update` | `POST /cost-locations/update` | update |
| `settings_update_creditor` | `POST /settings/update/creditor` | update |
| `settings_update_debtor` | `POST /settings/update/debtor` | update |
| `settings_update_postingaccount` | `POST /settings/update/postingaccount` | update |
| `transactions_assign_receipt` | `POST /transactions/assign/receipt` | link |
| `transactions_assign_batch_receipt` | `POST /transactions/assign-batch/receipt` | link |
| `transactions_unassign_receipt` | `POST /transactions/unassign/receipt` | link |
| `postings_assign_receipt_to_free_posting` | `POST /postings/assign/receipt-to-free-posting` | link |
| `postings_unconfirm_free` | `POST /postings/unconfirm/free` | revert |
| `postings_unconfirm_receipt` | `POST /postings/unconfirm/receipt` | revert |
| `postings_unconfirm_transaction` | `POST /postings/unconfirm/transaction` | revert |
| `receipts_restore_id_by_customer` | `POST /receipts/restore/id_by_customer` | revert |
</details>

<details>
<summary><strong>🔴 DESTRUCTIVE · deletes (2)</strong></summary>

| Tool | Endpoint | Note |
|---|---|---|
| `receipts_delete_id_by_customer` | `POST /receipts/delete/id_by_customer` | Restorable via `receipts_restore_id_by_customer` |
| `cost_locations_delete` | `POST /cost-locations/delete` | **Not** restorable |
</details>

## Run from source (stdio, no Docker)

Prefer the classic stdio mode for Claude Desktop? Build it locally:

```bash
npm install
npm run build
```

Then point Claude Desktop at the compiled entrypoint in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "buchhaltungsbutler": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/Buchhaltungsbutler MCP/dist/index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "BB_API_CLIENT": "your-api-client",
        "BB_API_SECRET": "your-api-secret",
        "BB_API_KEY": "your-customer-api-key"
      }
    }
  }
}
```

Or run the container over stdio instead:

```json
{
  "mcpServers": {
    "buchhaltungsbutler": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCP_TRANSPORT=stdio",
        "-e", "BB_API_CLIENT", "-e", "BB_API_SECRET", "-e", "BB_API_KEY",
        "buchhaltungsbutler-mcp:latest"
      ],
      "env": {
        "BB_API_CLIENT": "your-api-client",
        "BB_API_SECRET": "your-api-secret",
        "BB_API_KEY": "your-customer-api-key"
      }
    }
  }
}
```

(Build the image first: `docker build -t buchhaltungsbutler-mcp:latest .`)

## Keeping the spec current

The bundled `spec.json` is the official BuchhaltungsButler v1 OpenAPI spec — the
source of truth for the tools. To refresh against a newer API version:

```bash
curl -s https://app.buchhaltungsbutler.de/docs/api/v1.de.json -o spec.json
npm run build
```

New paths are picked up automatically; add them to `PATH_CATEGORY` in
`src/categories.ts` so they get the correct safety category (unmapped paths fall back
to the safe-but-conservative *create* category).

## Notes & conventions

- **Dates**: `YYYY-MM-DD`. **Amounts**: dot decimal separator (e.g. `-12.30`).
- **File uploads** (`receipts_upload`, `receipts_add`, `receipts_addBatch`): pass the
  file as a base64 string in the `file` field.
- **Paging**: most `get` tools accept `limit` and `offset`.
- **Batch tools** take arrays of objects; item schemas are resolved from the spec
  definitions and shown to the model.
- **Rate limit**: BuchhaltungsButler allows 100 requests/customer/minute; the server
  self-throttles at `BB_RATE_LIMIT` (default 90) to stay safely under it.

## Security

- Your API credentials live only in `.env`, which is git-ignored. **Never commit real
  secrets.** If any leak, rotate them in **BuchhaltungsButler → Settings → API**.
- The HTTP endpoint is unauthenticated by default (fine on localhost). To expose it
  beyond your machine, set `MCP_AUTH_TOKEN` and send it as an
  `Authorization: Bearer <token>` header — ideally behind TLS.

See [SECURITY.md](./SECURITY.md) for the full policy and how to report a vulnerability.

## Credits & license

An unofficial community integration for [BuchhaltungsButler](https://www.buchhaltungsbutler.de/);
not affiliated with or endorsed by BuchhaltungsButler. Built on the
[Model Context Protocol](https://modelcontextprotocol.io). Licensed under the
[MIT License](./LICENSE.md).
