import { z } from 'zod';

// A bare Zod schema following the *EventSchema naming convention.
// The generator should infer this event and flag it for review.
export const ParcelShippedEventSchema = z.object({
  parcelId: z.string(),
  shippedAt: z.iso.datetime(),
});
