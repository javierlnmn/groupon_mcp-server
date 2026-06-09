import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth";
import { DbClient } from "@/db/client";
import { DbOAuthProvider } from "@/mcp/auth-provider";
import { OAuthRepository } from "@/repositories/oauth-repository";
import { mcpHandler, mcpSessionHandler } from "@/mcp/controllers";

/**
 * Assembles the Express app that hosts the MCP server.
 */
export function createMcpApp(baseUrl: string) {
  const app = createMcpExpressApp();

  const connection = DbClient.getInstance().connection;
  const provider = new DbOAuthProvider(
    new OAuthRepository(connection),
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

  const guard = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
      new URL(`${baseUrl}/mcp`),
    ),
  });

  app.post("/mcp", guard, mcpHandler);
  app.get("/mcp", guard, mcpSessionHandler);
  app.delete("/mcp", guard, mcpSessionHandler);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
