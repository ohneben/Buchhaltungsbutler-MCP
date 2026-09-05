#!/usr/bin/env node
/**
 * Entry point. Chooses a transport based on MCP_TRANSPORT:
 *   - "stdio" (default): for Claude Desktop / local launchers.
 *   - "http": Streamable HTTP server for hosted/remote use (Docker default).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "./server.js";
import { BBClient } from "./client.js";

const transport = (process.env.MCP_TRANSPORT || "stdio").toLowerCase();

async function runStdio(): Promise<void> {
  // No loadConfig() here: credentials are resolved on the first tool call, so
  // the server still starts and lists its tools without them.
  const client = new BBClient();
  const server = createServer(client);
  const t = new StdioServerTransport();
  await server.connect(t);
  // Logging on stdio must go to stderr to avoid corrupting the protocol stream.
  console.error("buchhaltungsbutler-mcp: stdio transport ready");
}

async function runHttp(): Promise<void> {
  const client = new BBClient();
  const port = Number(process.env.PORT || "3000");
  const host = process.env.HOST || "0.0.0.0";
  const authToken = process.env.MCP_AUTH_TOKEN || "";
  const path = process.env.MCP_HTTP_PATH || "/mcp";

  const app = express();
  app.use(express.json({ limit: "25mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", server: "buchhaltungsbutler-mcp" });
  });

  // Optional shared-secret gate for the exposed endpoint.
  const guard = (req: Request, res: Response): boolean => {
    if (!authToken) return true;
    const header = req.headers.authorization || "";
    const provided = header.replace(/^Bearer\s+/i, "");
    if (provided !== authToken) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return false;
    }
    return true;
  };

  // Streamable HTTP with session management: `initialize` creates a session and
  // its server/transport are reused for that session's later requests. This is
  // the transport pattern Claude and `mcp-remote` expect.
  const sessions: Record<string, StreamableHTTPServerTransport> = {};

  app.post(path, async (req: Request, res: Response) => {
    if (!guard(req, res)) return;
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let t: StreamableHTTPServerTransport;

      if (sessionId && sessions[sessionId]) {
        t = sessions[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        t = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            sessions[sid] = t;
          },
        });
        t.onclose = () => {
          if (t.sessionId) delete sessions[t.sessionId];
        };
        const server = createServer(client);
        await server.connect(t);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: no valid session ID provided.",
          },
          id: null,
        });
        return;
      }

      await t.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("HTTP request handling error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // GET (SSE stream) and DELETE (session teardown) reuse the existing session.
  const bySession = async (req: Request, res: Response) => {
    if (!guard(req, res)) return;
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await sessions[sessionId].handleRequest(req, res);
  };
  app.get(path, bySession);
  app.delete(path, bySession);

  app.listen(port, host, () => {
    console.error(
      `buchhaltungsbutler-mcp: HTTP transport ready on http://${host}:${port}${path}` +
        (authToken ? " (bearer auth enabled)" : "")
    );
  });
}

async function main(): Promise<void> {
  if (transport === "http") {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
