import { z } from 'zod';
import { defineEvent } from '../../../../define-event';

export const OrderPlacedEvent = defineEvent(
  {
    id: 'order.placed',
    version: '1.0.0',
    summary: 'Emitted when a customer places an order.',
    producers: ['orders-service'],
  },
  z.object({
    orderId: z.string(),
    changedWithoutVersionBump: z.boolean(),
  })
);
