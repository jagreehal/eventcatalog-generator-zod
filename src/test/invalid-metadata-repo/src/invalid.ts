import { z } from 'zod';
import { defineEvent } from '../../../define-event';

export const InvalidMetadataEvent = defineEvent(
  {
    id: 'invalid.event',
    version: 'tomorrow',
  },
  z.object({ id: z.string() })
);
