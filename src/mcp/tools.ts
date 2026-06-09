import type { UserRole } from "@/db/schema";

/**
 * Canonical MCP tool names. Registration and any name-based logic reference these
 * instead of string literals, so a tool is renamed in exactly one place.
 */
export enum ToolName {
  // Discovery (customer-facing; merchants get these too — see roleCanUse).
  SearchDeals = "search_deals",
  GetDeal = "get_deal",
  // Merchant-only.
  ListAllDeals = "list_all_deals",
}

/** The minimum role a tool is designed for — its "owning" role. */
const TOOL_ROLE: Record<ToolName, UserRole> = {
  [ToolName.SearchDeals]: "customer",
  [ToolName.GetDeal]: "customer",
  [ToolName.ListAllDeals]: "merchant",
};

/** Role hierarchy: a merchant can use everything a customer can, and more. */
const ROLE_RANK: Record<UserRole, number> = { customer: 0, merchant: 1 };

/** Whether `role` is allowed to see/call `tool`, honoring the hierarchy above. */
export function roleCanUse(role: UserRole, tool: ToolName): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[TOOL_ROLE[tool]];
}
