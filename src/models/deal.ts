import { z } from "zod";
import { Category } from "@/models/category";
import { Merchant } from "@/models/merchant";
import { Location } from "@/models/location";
import { DealOption } from "@/models/deal-option";

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
