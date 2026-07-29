import { z } from 'zod';
import { defineEvent } from '../../../../define-event';

export const OrderPlacedEvent = defineEvent(
  {
    id: 'order.placed',
    version: '2.0.0',
    name: 'Order Placed',
    summary: 'Emitted when a customer places an order.',
    producers: ['orders-service'],
    consumers: ['billing-service'],
  },
  z.object({
    orderId: z.string(),
    customerId: z.string(),
    total: z.number().positive(),
    currency: z.string(),
    placedAt: z.iso.datetime(),
  })
);
