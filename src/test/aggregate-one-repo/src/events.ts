import { z } from 'zod';
import { defineEvent } from '../../../define-event';

export const FirstCreatedEvent = defineEvent(
  {
    id: 'first.created',
    version: '1.0.0',
    producers: ['first-service'],
    consumers: ['shared-service'],
  },
  z.object({ firstId: z.string() })
);
