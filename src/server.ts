/**
 * Builds the low-level MCP Server: registers every generated tool with its
 * JSON-Schema input + MCP annotations, and routes tool calls to the BB client.
 */

import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { buildToolDefs, specInfo, type ToolDef } from "./spec.js";
import { BBClient, type BBConfig } from "./client.js";

const FALLBACK_VERSION = "unknown";

/**
 * Optional server-side tool exposure policy, read from the environment:
 *   BB_READ_ONLY=true        expose only the 🟢 read-only tools.
 *   BB_TOOL_ALLOWLIST=a,b,c  expose only the named tools (applied on top).
 * Filtered tools are neither listed nor callable, so the restriction holds
 * even for clients that ignore annotations or lack per-tool permissions.
 */
export function applyToolPolicy(
  tools: ToolDef[],
  env: NodeJS.ProcessEnv = process.env
): ToolDef[] {
  let out = tools;
  if (/^(1|true|yes)$/i.test((env.BB_READ_ONLY ?? "").trim())) {
    out = out.filter((t) => t.category.id === "read");
  }
  const allow = (env.BB_TOOL_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length) {
    const set = new Set(allow);
    out = out.filter((t) => set.has(t.name));
  }
  return out;
}

/**
 * The version this server reports over MCP. It is read from package.json,
 * which always carries the last released version: CI stamps it from the
 * release tag and writes it back into the repository, so the number is never
 * maintained by hand and never a placeholder. FALLBACK_VERSION is only ever
 * reported if package.json cannot be read at all.
 */
function readPackageVersion(): string {
  try {
    const pkg = createRequire(import.meta.url)("../package.json") as {
      version?: string;
    };
    return pkg.version ?? FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

export function createServer(client: BBClient): Server {
  const info = specInfo();
  const allTools = buildToolDefs();
  const tools = applyToolPolicy(allTools);
  const byName = new Map<string, ToolDef>(tools.map((t) => [t.name, t]));
  const known = new Set(allTools.map((t) => t.name));
  if (tools.length !== allTools.length) {
    console.error(
      `buchhaltungsbutler-mcp: tool policy active, exposing ${tools.length}/${allTools.length} tools`
    );
  }

  const server = new Server(
    {
      name: "buchhaltungsbutler-mcp",
      version: readPackageVersion(),
    },
    {
      capabilities: { tools: {} },
      instructions:
        `MCP server for ${info.title} (${info.version}).\n\n` +
        "Every tool description starts with a category banner:\n" +
        "  🟢 READ-ONLY — safe, fetches data only.\n" +
        "  🟡 WRITE — creates / updates / links / reverts accounting data.\n" +
        "  🔴 DESTRUCTIVE — deletes data; confirm with the user first.\n\n" +
        "Amounts use a dot as decimal separator. Dates are 'YYYY-MM-DD'. " +
        "Most list/get tools support `limit` and `offset` for paging. " +
        "The `api_key` field defaults to the server configuration; only pass " +
        "it to target a different BB customer account.",
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const list: Tool[] = tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema as Tool["inputSchema"],
      annotations: {
        title: t.title,
        ...t.category.annotations,
      },
      // Annotations alone are advisory and not every host acts on them.
      // This asks the host to confirm each destructive call regardless of
      // the permission mode in effect. Hosts that don't know the field
      // ignore it.
      ...(t.category.id === "delete"
        ? { _meta: { "anthropic/requiresUserInteraction": true } }
        : {}),
    }));
    return { tools: list };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const def = byName.get(req.params.name);
    if (!def) {
      const text = known.has(req.params.name)
        ? `Tool disabled by server policy (BB_READ_ONLY / BB_TOOL_ALLOWLIST): ${req.params.name}`
        : `Unknown tool: ${req.params.name}`;
      return { isError: true, content: [{ type: "text", text }] };
    }

    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

    try {
      const { status, ok, body } = await client.call(def.path, args);
      const payload =
        typeof body === "string" ? body : JSON.stringify(body, null, 2);

      if (!ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `BuchhaltungsButler API returned HTTP ${status} for ${def.path}:\n${payload}`,
            },
          ],
        };
      }

      // BB responses use a {success: boolean, ...} envelope; surface a failed
      // success flag as an error so the model doesn't treat it as a win.
      if (
        body &&
        typeof body === "object" &&
        "success" in body &&
        (body as { success: unknown }).success === false
      ) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `BuchhaltungsButler reported failure for ${def.path}:\n${payload}`,
            },
          ],
        };
      }

      return { content: [{ type: "text", text: payload }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Request to ${def.path} failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
      };
    }
  });

  return server;
}

export type { BBConfig };
