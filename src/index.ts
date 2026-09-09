#!/usr/bin/env node
/**
 * Entry point. Chooses a transport based on MCP_TRANSPORT:
 *   - "stdio" (default): for Claude Desktop / local launchers.
 *   - "http": Streamable HTTP server for hosted/remote use (Docker default).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "./server.js";
import { BBClient } from "./client.js";
import {
  bearerFrom,
  hostAllowlist,
  loadHttpConfig,
  startupRefusal,
  tokenMatches,
} from "./http.js";

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
  const cfg = loadHttpConfig();

  const refusal = startupRefusal(cfg);
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  if (!cfg.authToken && cfg.allowInsecure) {
    console.error(
      "buchhaltungsbutler-mcp: WARNING — MCP_ALLOW_INSECURE is set and no " +
        "MCP_AUTH_TOKEN is configured. Anyone who can reach this port has " +
        "full read/write/delete access to the accounting data."
    );
  }

  const app = express();

  // Liveness only, no credentials involved and no body read.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", server: "buchhaltungsbutler-mcp" });
  });

  // ---- everything below runs BEFORE the body is read ----

  // 1. DNS-rebinding protection.
  const allowlist = hostAllowlist(cfg);
  if (allowlist) {
    app.use(cfg.path, hostHeaderValidation(allowlist));
    console.error(
      `buchhaltungsbutler-mcp: Host header restricted to ${allowlist.join(", ")}`
    );
  }

  // 2. Shared-secret gate. Registered as middleware rather than called inside
  //    the route so an unauthenticated caller is rejected before express.json
  //    reads and parses a body.
  if (cfg.authToken) {
    app.use(cfg.path, (req: Request, res: Response, next: NextFunction) => {
      if (tokenMatches(bearerFrom(req.headers.authorization), cfg.authToken)) {
        next();
        return;
      }
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
    });
  }

  // 3. Only now is it worth parsing a body.
  app.use(express.json({ limit: cfg.bodyLimit }));

  // Streamable HTTP with session management: `initialize` creates a session and
  // its server/transport are reused for that session's later requests. This is
  // the transport pattern Claude and `mcp-remote` expect.
  interface Session {
    transport: StreamableHTTPServerTransport;
    lastSeen: number;
    /** Open SSE streams. A session serving one is in use, however quiet. */
    streams: number;
  }
  const sessions = new Map<string, Session>();

  const touch = (id: string): Session | undefined => {
    const s = sessions.get(id);
    if (s) s.lastSeen = Date.now();
    return s;
  };

  const drop = (id: string): void => {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    void Promise.resolve(s.transport.close()).catch(() => {});
  };

  const idle = (s: Session, cutoff: number): boolean =>
    s.streams === 0 && s.lastSeen < cutoff;

  // Sessions are only removed on an explicit DELETE or a transport error, and
  // each one holds a full Server instance. Without a sweep, a client that
  // reconnects instead of closing grows the map until the process dies.
  // A session with an open SSE stream is never swept: `lastSeen` only moves
  // when a request arrives, so an otherwise healthy long-lived stream would
  // look idle and be cut mid-flight.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - cfg.sessionTtlMs;
    for (const [id, s] of sessions) if (idle(s, cutoff)) drop(id);
  }, 60_000);
  sweep.unref();

  /** Evict the least recently used session, preferring one without a stream. */
  const evictOldest = (): void => {
    let victim: string | undefined;
    let oldest = Infinity;
    let victimStreaming = true;
    for (const [id, s] of sessions) {
      const streaming = s.streams > 0;
      // A non-streaming candidate always beats a streaming one.
      if (victimStreaming && !streaming) {
        victim = id;
        oldest = s.lastSeen;
        victimStreaming = false;
        continue;
      }
      if (streaming === victimStreaming && s.lastSeen < oldest) {
        victim = id;
        oldest = s.lastSeen;
      }
    }
    if (victim) drop(victim);
  };

  /** The spec's status for an unknown session: clients re-initialize on 404. */
  const unknownSession = (res: Response): void => {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
      id: null,
    });
  };

  app.post(cfg.path, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let t: StreamableHTTPServerTransport;

      if (sessionId) {
        const existing = touch(sessionId);
        if (!existing) {
          unknownSession(res);
          return;
        }
        t = existing.transport;
      } else if (isInitializeRequest(req.body)) {
        if (sessions.size >= cfg.maxSessions) evictOldest();
        t = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            sessions.set(sid, { transport: t, lastSeen: Date.now(), streams: 0 });
          },
        });
        t.onclose = () => {
          if (t.sessionId) sessions.delete(t.sessionId);
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
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? touch(sessionId) : undefined;
    if (!session) {
      unknownSession(res);
      return;
    }
    // A GET is the SSE stream and stays open. Count it for as long as the
    // response lives so the idle sweep leaves the session alone.
    const streaming = req.method === "GET";
    if (streaming) {
      session.streams += 1;
      res.on("close", () => {
        session.streams = Math.max(0, session.streams - 1);
        session.lastSeen = Date.now();
      });
    }
    await session.transport.handleRequest(req, res);
  };
  app.get(cfg.path, bySession);
  app.delete(cfg.path, bySession);

  // Without this, a malformed or oversized body reaches express's default
  // handler, which answers with an HTML page carrying a stack trace and
  // absolute file paths whenever NODE_ENV is not "production".
  app.use(
    (err: unknown, _req: Request, res: Response, next: NextFunction): void => {
      if (res.headersSent) {
        next(err);
        return;
      }
      const e = err as { type?: string; status?: number };
      const tooLarge = e?.type === "entity.too.large";
      res.status(tooLarge ? 413 : e?.status && e.status < 500 ? 400 : 500).json({
        jsonrpc: "2.0",
        error: {
          code: tooLarge ? -32600 : -32700,
          message: tooLarge
            ? `Request body exceeds the ${cfg.bodyLimit} limit`
            : "Parse error: request body is not valid JSON",
        },
        id: null,
      });
    }
  );

  app.listen(cfg.port, cfg.host, () => {
    console.error(
      `buchhaltungsbutler-mcp: HTTP transport ready on http://${cfg.host}:${cfg.port}${cfg.path}` +
        (cfg.authToken ? " (bearer auth enabled)" : " (NO AUTH)")
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
