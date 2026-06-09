import { z } from "zod";
import { Deal } from "@/models/deal";

/** A flattened, aligned row per compared deal for quick side-by-side scanning. */
const DealComparisonRow = z.object({
  deal_id: z.number().int(),
  title: z.string(),
  /** Headline (lowest-priced) option. */
  price: z.number(),
  /** Headline (largest) discount across the deal's options. */
  discount_pct: z.number().int(),
  rating: z.number().nullable(),
  reviews_count: z.number().int().nonnegative(),
});

/** Side-by-side comparison of several deals plus the obvious "winner" picks. */
export const DealComparison = z.object({
  deals: z.array(Deal),
  summary: z.array(DealComparisonRow),
  /** Ids of the standout deals; null only when no deals were found. */
  cheapest_deal_id: z.number().int().nullable(),
  biggest_discount_deal_id: z.number().int().nullable(),
  highest_rated_deal_id: z.number().int().nullable(),
});
export type DealComparison = z.infer<typeof DealComparison>;
