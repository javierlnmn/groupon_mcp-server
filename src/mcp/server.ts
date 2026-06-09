import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Deal } from "@/models";
import type { DealRepository } from "@/repositories/deal-repository";
import type { UserRole } from "@/db/schema";

/** Tool result carrying domain Deals as both readable text and structured output. */
function dealsResult(deals: Deal[]) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(deals, null, 2) }],
    structuredContent: { deals },
  };
}

/** Structured-output contract for the deal tools — the domain model itself. */
const dealsOutput = { deals: z.array(Deal) };

/**
 * Builds a fresh MCP server for a single session, registering only the tools the
 * session's role is allowed to use. The role is established at session creation
 * from the access token (see src/mcp/controllers.ts), so a session's tool set is
 * fixed for its lifetime — customers never even see merchant tools in tools/list.
 */
export function buildMcpServer(
  role: UserRole,
  deals: DealRepository,
): McpServer {
  const server = new McpServer({ name: "groupon-mcp", version: "1.0.0" });

  if (role === "customer") {
    server.registerTool(
      "search_deals",
      {
        title: "Search deals",
        description: "Search active Groupon deals by keyword.",
        inputSchema: { query: z.string().optional() },
        outputSchema: dealsOutput,
      },
      async ({ query }) => dealsResult(deals.searchActiveDeals(query)),
    );
  }

  if (role === "merchant") {
    server.registerTool(
      "list_all_deals",
      {
        title: "List all deals",
        description:
          "List every deal including inactive ones — merchant management view.",
        inputSchema: {},
        outputSchema: dealsOutput,
      },
      async () => dealsResult(deals.listAllDeals()),
    );
  }

  return server;
}
