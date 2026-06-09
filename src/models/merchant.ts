import { z } from "zod";

export const Merchant = z.object({
  id: z.number().int(),
  name: z.string(),
  location_id: z.number().int(),
});
export type Merchant = z.infer<typeof Merchant>;
