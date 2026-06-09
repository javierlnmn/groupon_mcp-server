import { z } from "zod";

export const DealReview = z.object({
  id: z.number().int(),
  deal_id: z.number().int(),
  user_id: z.number().int(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable(),
  created_at: z.string(),
});
export type DealReview = z.infer<typeof DealReview>;
