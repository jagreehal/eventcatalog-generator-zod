import { z } from 'zod';
import { defineEvent } from '../../../../define-event';

export const OrderPlacedEvent = defineEvent(
  {
    id: 'order.placed',
    version: '1.0.0',
    name: 'Order Placed',
    summary: 'Emitted when a customer places an order.',
    producers: ['orders-service'],
    consumers: ['billing-service', 'shipping-service'],
    owners: ['orders-team'],
  },
  z.object({
    orderId: z.string(),
    customerId: z.string(),
    total: z.number().positive(),
    placedAt: z.iso.datetime(),
  })
);
