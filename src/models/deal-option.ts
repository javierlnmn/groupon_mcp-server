import { z } from "zod";

export const DealOption = z.object({
  id: z.number().int(),
  deal_id: z.number().int(),
  title: z.string(),
  price: z.number().nonnegative(),
  original_price: z.number().nonnegative(),
  discount_pct: z.number().int().min(0).max(100),
});
export type DealOption = z.infer<typeof DealOption>;
