import { z } from "zod";
import { Category } from "@/models/category";
import { Location } from "@/models/location";
import { Merchant } from "@/models/merchant";

/**
 * Computed analytics read-models returned by the merchant intelligence tools.
 */

/** A merchant paired with how many in-scope deals it runs. */
const MerchantDealCount = z.object({
  merchant: Merchant,
  deal_count: z.number().int().nonnegative(),
});

/** Benchmarking stats for a category (optionally narrowed to one location). */
export const CategoryInsights = z.object({
  category: Category,
  /** Null when the insights span every location. */
  location: Location.nullable(),
  deal_count: z.number().int().nonnegative(),
  /** Per-deal headline (largest) discount, averaged. Null when no deals. */
  avg_discount_pct: z.number().nullable(),
  median_discount_pct: z.number().nullable(),
  /** Cheapest and dearest option prices across the in-scope deals. */
  price_min: z.number().nullable(),
  price_max: z.number().nullable(),
  top_merchants: z.array(MerchantDealCount),
});
export type CategoryInsights = z.infer<typeof CategoryInsights>;

/** One category's supply in the target location vs the cross-market baseline. */
const MarketGap = z.object({
  category: Category,
  local_deal_count: z.number().int().nonnegative(),
  /** Mean active-deal count for this category across the *other* locations. */
  other_locations_avg: z.number().nonnegative(),
  /** other_locations_avg − local_deal_count; higher = bigger opportunity. */
  gap_score: z.number(),
});

export const MarketGaps = z.object({
  location: Location,
  other_location_count: z.number().int().nonnegative(),
  /** Every category, ordered by gap_score descending (biggest gaps first). */
  gaps: z.array(MarketGap),
});
export type MarketGaps = z.infer<typeof MarketGaps>;

/** How one deal's headline price/discount sits among its category peers. */
export const PricePositioning = z.object({
  deal_id: z.number().int(),
  title: z.string(),
  category: Category,
  /** Active deals in the same category, excluding this one. */
  peer_count: z.number().int().nonnegative(),
  /** This deal's headline (lowest) price and headline (largest) discount. */
  price: z.number(),
  discount_pct: z.number().int(),
  category_median_price: z.number().nullable(),
  category_median_discount_pct: z.number().nullable(),
  /** % of peers priced higher than this deal (high = comparatively cheap). */
  cheaper_than_pct: z.number().nullable(),
  /** % of peers with a smaller discount (high = comparatively generous). */
  bigger_discount_than_pct: z.number().nullable(),
});
export type PricePositioning = z.infer<typeof PricePositioning>;
