import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Deal } from "@/models";
import { jsonResult, errorResult } from "@/mcp/results";
import { ToolName, roleCanUse } from "@/mcp/tools";
import type { DealRepository } from "@/repositories/deal-repository";
import type { UserRole } from "@/db/schema";

/**
 * Builds a fresh MCP server for a single session, registering only the tools the
 * session's role is allowed to use.
 */
export function buildMcpServer(
  role: UserRole,
  deals: DealRepository,
): McpServer {
  const server = new McpServer({ name: "groupon-mcp", version: "1.0.0" });

  if (roleCanUse(role, ToolName.SearchDeals)) {
    server.registerTool(
      ToolName.SearchDeals,
      {
        title: "Search deals",
        description: "Search active Groupon deals by keyword.",
        inputSchema: { query: z.string().optional() },
        outputSchema: { deals: z.array(Deal) },
      },
      async ({ query }) => jsonResult({ deals: deals.searchActiveDeals(query) }),
    );
  }

  if (roleCanUse(role, ToolName.GetDeal)) {
    server.registerTool(
      ToolName.GetDeal,
      {
        title: "Get deal",
        description:
          "Full detail for one deal by id: pricing options, merchant, location, " +
          "rating, reviews count, fine print, and validity.",
        inputSchema: { deal_id: z.number().int().positive() },
        outputSchema: { deal: Deal },
      },
      async ({ deal_id }) => {
        const deal = deals.getDeal(deal_id);
        return deal
          ? jsonResult({ deal })
          : errorResult(`No deal found with id ${deal_id}.`);
      },
    );
  }

  if (roleCanUse(role, ToolName.ListAllDeals)) {
    server.registerTool(
      ToolName.ListAllDeals,
      {
        title: "List all deals",
        description:
          "List every deal including inactive ones — merchant management view.",
        inputSchema: {},
        outputSchema: { deals: z.array(Deal) },
      },
      async () => jsonResult({ deals: deals.listAllDeals() }),
    );
  }

  return server;
}
