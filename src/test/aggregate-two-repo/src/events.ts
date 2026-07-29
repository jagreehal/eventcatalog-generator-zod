import { z } from 'zod';
import { defineEvent } from '../../../define-event';

export const SecondCreatedEvent = defineEvent(
  {
    id: 'second.created',
    version: '1.0.0',
    producers: ['second-service'],
    consumers: ['shared-service'],
  },
  z.object({ secondId: z.string() })
);
