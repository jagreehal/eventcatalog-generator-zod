import type { z } from 'zod';

export type EventRole = 'provider' | 'client';

/**
 * Metadata attachable to a Zod schema via defineEvent(). Bare schemas can use
 * the export naming convention, but explicit definitions always require a
 * stable id and semantic version.
 */
export interface EventMetadata {
  id: string;
  version: string;
  /**
   * Providers own and may update the catalog contract. Clients only add
   * service relationships to a provider-owned contract.
   * @default 'provider'
   */
  role?: EventRole;
  name?: string;
  summary?: string;
  /** Service ids that send (produce) this event. */
  producers?: string[];
  /** Service ids that receive (consume) this event. */
  consumers?: string[];
  owners?: string[];
}

export const EVENT_META = Symbol.for('eventcatalog-generator-zod:meta');

/**
 * Attach EventCatalog metadata to a Zod schema. Returns the schema unchanged,
 * so it can keep being used for runtime validation.
 */
export function defineEvent<T extends z.ZodTypeAny>(meta: EventMetadata, schema: T): T {
  (schema as Record<symbol, unknown>)[EVENT_META] = meta;
  return schema;
}

export function getEventMetadata(schema: unknown): EventMetadata | undefined {
  if (schema && typeof schema === 'object' && Object.getOwnPropertySymbols(schema).includes(EVENT_META)) {
    return (schema as Record<symbol, EventMetadata>)[EVENT_META];
  }
  return undefined;
}
