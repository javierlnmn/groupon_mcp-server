import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import {
  Deal,
  DealComparison,
  CategoryInsights,
  MarketGaps,
  PricePositioning,
} from "@/models";
import { jsonResult, errorResult } from "@/mcp/results";
import { ToolName, roleCanUse } from "@/mcp/tools";
import { DbClient } from "@/db/client";
import { DealRepository } from "@/repositories/deal-repository";
import { CategoryRepository } from "@/repositories/category-repository";
import { LocationRepository } from "@/repositories/location-repository";
import { InsightsRepository } from "@/repositories/insights-repository";
import type { UserRole } from "@/db/schema";

/**
 * Builds a fresh MCP server for a single session, registering only the tools the
 * session's role is allowed to use.
 */
export function buildMcpServer(role: UserRole): McpServer {
  const connection = DbClient.getInstance().connection;
  const server = new McpServer({ name: "groupon-mcp", version: "1.0.0" });

  // ── Reference-data resources (valid filter values) ──────────────────────────

  server.registerResource(
    "categories",
    "categories://all",
    {
      title: "Categories",
      description: "Every deal category — the valid `category` filter values.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            new CategoryRepository(connection).listAll(),
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "locations",
    "locations://all",
    {
      title: "Locations",
      description: "Every location — the valid `location` filter values.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            new LocationRepository(connection).listAll(),
            null,
            2,
          ),
        },
      ],
    }),
  );

  // ── Discovery tools (customer + merchant) ───────────────────────────────────

  if (roleCanUse(role, ToolName.SearchDeals)) {
    server.registerTool(
      ToolName.SearchDeals,
      {
        title: "Search deals",
        description:
          "Search active deals. All filters optional: keyword `query` " +
          "(full-text), `category`/`location` slugs (see the categories/" +
          "locations resources), `max_price`, `min_discount` (%), `limit`.",
        inputSchema: {
          query: z.string().optional(),
          category: z.string().optional(),
          location: z.string().optional(),
          max_price: z.number().nonnegative().optional(),
          min_discount: z.number().int().min(0).max(100).optional(),
          limit: z.number().int().positive().max(100).optional(),
        },
        outputSchema: { deals: z.array(Deal) },
      },
      async ({ query, category, location, max_price, min_discount, limit }) =>
        jsonResult({
          deals: new DealRepository(connection).searchActiveDeals({
            query,
            category,
            location,
            maxPrice: max_price,
            minDiscount: min_discount,
            limit,
          }),
        }),
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
        const deal = new DealRepository(connection).getDeal(deal_id);
        return deal
          ? jsonResult({ deal })
          : errorResult(`No deal found with id ${deal_id}.`);
      },
    );
  }

  if (roleCanUse(role, ToolName.CompareDeals)) {
    server.registerTool(
      ToolName.CompareDeals,
      {
        title: "Compare deals",
        description:
          "Side-by-side comparison of 2+ deals: full details, an aligned summary " +
          "row per deal, and the cheapest / biggest-discount / highest-rated picks.",
        inputSchema: {
          deal_ids: z.array(z.number().int().positive()).min(2),
        },
        outputSchema: DealComparison.shape,
      },
      async ({ deal_ids }) =>
        jsonResult(new DealRepository(connection).compareDeals(deal_ids)),
    );
  }

  // ── Merchant intelligence tools ─────────────────────────────────────────────

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
      async () =>
        jsonResult({ deals: new DealRepository(connection).listAllDeals() }),
    );
  }

  if (roleCanUse(role, ToolName.CategoryInsights)) {
    server.registerTool(
      ToolName.CategoryInsights,
      {
        title: "Category insights",
        description:
          "Benchmarking for a category (optionally one location): deal count, " +
          "avg/median discount, price range, and top merchants by deal count.",
        inputSchema: {
          category: z.string(),
          location: z.string().optional(),
        },
        outputSchema: CategoryInsights.shape,
      },
      async ({ category, location }) => {
        const result = new InsightsRepository(connection).categoryInsights(
          category,
          location,
        );
        return result
          ? jsonResult(result)
          : errorResult(
              `Unknown category${location ? " or location" : ""} slug.`,
            );
      },
    );
  }

  if (roleCanUse(role, ToolName.FindMarketGaps)) {
    server.registerTool(
      ToolName.FindMarketGaps,
      {
        title: "Find market gaps",
        description:
          "Categories under-supplied in a location relative to other markets, " +
          "ranked by opportunity (gap_score). Thin/absent local supply with " +
          "healthy supply elsewhere ranks highest.",
        inputSchema: { location: z.string() },
        outputSchema: MarketGaps.shape,
      },
      async ({ location }) => {
        const result = new InsightsRepository(connection).marketGaps(location);
        return result
          ? jsonResult(result)
          : errorResult(`Unknown location slug "${location}".`);
      },
    );
  }

  if (roleCanUse(role, ToolName.PricePositioning)) {
    server.registerTool(
      ToolName.PricePositioning,
      {
        title: "Price positioning",
        description:
          "How a deal's headline price/discount compares to its category peers: " +
          "peer medians and the share of peers it beats on price and discount.",
        inputSchema: { deal_id: z.number().int().positive() },
        outputSchema: PricePositioning.shape,
      },
      async ({ deal_id }) => {
        const result = new InsightsRepository(connection).pricePositioning(
          deal_id,
        );
        return result
          ? jsonResult(result)
          : errorResult(`No deal found with id ${deal_id}.`);
      },
    );
  }

  return server;
}
