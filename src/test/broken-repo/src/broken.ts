import { z } from 'zod';
import { defineEvent } from '../../../define-event';

throw new Error('fixture import failed');

export const BrokenEvent = defineEvent({ id: 'broken.event', version: '1.0.0' }, z.object({ id: z.string() }));
