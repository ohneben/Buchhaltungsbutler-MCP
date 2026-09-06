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
  const tools = buildToolDefs();
  const byName = new Map<string, ToolDef>(tools.map((t) => [t.name, t]));

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
    }));
    return { tools: list };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const def = byName.get(req.params.name);
    if (!def) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Unknown tool: ${req.params.name}` },
        ],
      };
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
