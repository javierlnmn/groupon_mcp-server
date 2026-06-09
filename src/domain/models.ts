import { z } from "zod";

/**
 * Domain models.
 */

export const User = z.object({
  id: z.number().int(),
  name: z.string(),
});
export type User = z.infer<typeof User>;

export const Category = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.string(),
});
export type Category = z.infer<typeof Category>;

export const Location = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.string(),
  region: z.string(),
});
export type Location = z.infer<typeof Location>;

export const Merchant = z.object({
  id: z.number().int(),
  name: z.string(),
  location_id: z.number().int(),
});
export type Merchant = z.infer<typeof Merchant>;

export const DealOption = z.object({
  id: z.number().int(),
  deal_id: z.number().int(),
  title: z.string(),
  price: z.number().nonnegative(),
  original_price: z.number().nonnegative(),
  discount_pct: z.number().int().min(0).max(100),
});
export type DealOption = z.infer<typeof DealOption>;

export const DealReview = z.object({
  id: z.number().int(),
  deal_id: z.number().int(),
  user_id: z.number().int(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  created_at: z.string(),
});
export type DealReview = z.infer<typeof DealReview>;

export const Deal = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string(),
  category: Category,
  merchant: Merchant,
  location: Location,
  options: z.array(DealOption),
  /** Average review rating, or null when the deal has no reviews. */
  rating: z.number().min(1).max(5).nullable(),
  reviews_count: z.number().int().nonnegative(),
  fine_print: z.string().nullable(),
  valid_until: z.string().nullable(),
  is_active: z.boolean(),
});
export type Deal = z.infer<typeof Deal>;
