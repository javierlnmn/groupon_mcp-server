import { z } from "zod";

export const Category = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.string(),
});
export type Category = z.infer<typeof Category>;
