# Security Policy

## Supported Versions

This project tracks the latest commit on the `main` branch. Security fixes land
there — please make sure you are running the most recent version before
reporting an issue.

| Version | Supported |
| ------- | :-------: |
| `main` (latest) | ✅ |
| older commits   | ❌ |

## Reporting a Vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately through GitHub:

1. Open this repository's [**Security** tab](../../security).
2. Click [**Report a vulnerability**](../../security/advisories/new) to start a
   private security advisory.

> If the "Report a vulnerability" button isn't visible, a maintainer needs to
> enable **Private vulnerability reporting** under **Settings → Security**.

Please include:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if possible), and
- the affected version/commit and your environment.

You'll get an initial response on a best-effort basis. Once a fix is ready it is
released on `main` and the advisory is published.

## Deployment & Hardening Notes

This server bridges an MCP client to the **BuchhaltungsButler cloud API**. It can
read and write real accounting data, so treat it accordingly:

- **Your API credentials are secrets.** `BB_API_CLIENT`, `BB_API_SECRET`, and
  `BB_API_KEY` live in `.env`, which is git-ignored — never commit or share them.
  If any of them leaks, rotate it in **BuchhaltungsButler → Settings → API**.
- **Credentials never reach the model.** The server injects Basic auth and the
  `api_key` on every outgoing request; the MCP client (and the LLM behind it)
  only ever sees tool inputs and API responses, never your secrets.
- **The HTTP endpoint is unauthenticated by default**, which is fine for
  localhost-only use. If you expose it beyond your machine, set `MCP_AUTH_TOKEN`
  and require it via an `Authorization: Bearer <token>` header. Prefer running it
  behind TLS (a reverse proxy) rather than exposing the raw port.
- **Mind the destructive tools.** Two tools delete data and several revert state.
  They carry `destructiveHint` / non-`readOnlyHint` annotations so a well-behaved
  host can prompt for confirmation — keep that confirmation on.
- **Keep the container on a trusted network** and **keep dependencies current**
  (see Dependabot, if enabled).

Thank you for helping keep this project and its users safe.
