import { z } from 'zod';
import { defineEvent } from '../../../define-event';

export const SecondEvent = defineEvent({ id: 'duplicate.event', version: '1.0.0' }, z.object({ second: z.string() }));
