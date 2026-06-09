import express from "express";
import type { RequestHandler } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth";
import { DbClient } from "@/db/client";
import { DbOAuthProvider } from "@/auth/provider";

export function createServer(baseUrl: string) {
  const app = createMcpExpressApp();

  const provider = new DbOAuthProvider(
    DbClient.getInstance().connection,
    baseUrl,
  );

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(baseUrl),
      scopesSupported: [],
    }),
  );

  // Target of the login form rendered by DbOAuthProvider.authorize().
  app.post(
    "/login",
    express.urlencoded({ extended: false }),
    provider.handleLogin,
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ── MCP route ────────────────────────────────────────────────────────────
  // Left unwired on purpose: the src/mcp/ layer (controllers.ts / server.ts) is
  // still a WIP. When it's ready, protect it with the Bearer guard below, e.g.:
  //
  //   import { mcpHandler } from "@/mcp/controllers";
  //   app.post("/mcp", makeMcpAuthGuard(provider, baseUrl), mcpHandler);
  //
  // The guard rejects missing/invalid/expired tokens with 401 + a
  // WWW-Authenticate header and populates req.auth (incl. req.auth.extra.userId).

  return app;
}

/** Bearer-token guard for the MCP route — see the note in createServer(). */
export function makeMcpAuthGuard(
  provider: DbOAuthProvider,
  baseUrl: string,
): RequestHandler {
  return requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
      new URL(`${baseUrl}/mcp`),
    ),
  });
}
