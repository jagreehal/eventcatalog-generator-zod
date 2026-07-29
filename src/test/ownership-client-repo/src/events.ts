import { z } from 'zod';
import { defineEvent } from '../../../define-event';

export const OrderPlacedEvent = defineEvent(
  {
    id: 'order.placed',
    version: '1.0.0',
    role: 'client',
    consumers: ['analytics-service'],
  },
  z.object({
    orderId: z.string(),
    clientMirrorMustNotWin: z.boolean(),
  })
);
