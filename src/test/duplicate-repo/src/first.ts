import { z } from 'zod';
import { defineEvent } from '../../../define-event';

export const FirstEvent = defineEvent({ id: 'duplicate.event', version: '1.0.0' }, z.object({ first: z.string() }));
