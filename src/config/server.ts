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
import { OAuthRepository } from "@/repositories/oauth-repository";
import { mcpHandler, mcpSessionHandler } from "@/mcp/controllers";

export function createServer(baseUrl: string) {
  const app = createMcpExpressApp();

  const connection = DbClient.getInstance().connection;
  const provider = new DbOAuthProvider(new OAuthRepository(connection), baseUrl);

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

  // MCP endpoint, protected by the Bearer guard. The guard rejects missing/
  // invalid/expired tokens with 401 + a WWW-Authenticate header and populates
  // req.auth (incl. req.auth.extra.role), which the handler uses to scope tools.
  const guard = makeMcpAuthGuard(provider, baseUrl);
  app.post("/mcp", guard, mcpHandler);
  app.get("/mcp", guard, mcpSessionHandler);
  app.delete("/mcp", guard, mcpSessionHandler);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

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
