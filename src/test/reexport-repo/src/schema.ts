import { z } from 'zod';

export const InternalSchema = z.object({
  paymentId: z.string(),
});
