import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types";
import { DbClient } from "@/db/client";
import { DealRepository } from "@/repositories/deal-repository";
import { buildMcpServer } from "@/mcp/server";
import type { UserRole } from "@/db/schema";

/** Live streamable-HTTP sessions. */
const transports: Record<string, StreamableHTTPServerTransport> = {};

/** JSON-RPC 400 for malformed or sessionless requests on the /mcp endpoint. */
function badRequest(res: Response, message: string): void {
  res.status(400).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

export async function mcpHandler(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && transports[sessionId]) {
    await transports[sessionId].handleRequest(req, res, req.body);
    return;
  }

  if (!sessionId && isInitializeRequest(req.body)) {
    const role = (req.auth?.extra?.role as UserRole) ?? "customer";
    const deals = new DealRepository(DbClient.getInstance().connection);
    const server = buildMcpServer(role, deals);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        transports[id] = transport;
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  badRequest(res, "No valid session ID, or not an initialize request");
}

/** GET (server→client stream) and DELETE (session teardown) for /mcp. */
export async function mcpSessionHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    badRequest(res, "Missing or unknown session ID");
    return;
  }
  await transports[sessionId].handleRequest(req, res);
}
