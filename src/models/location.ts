import { z } from "zod";

export const Location = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.string(),
  region: z.string(),
});
export type Location = z.infer<typeof Location>;
