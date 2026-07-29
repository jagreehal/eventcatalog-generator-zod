import fs from 'node:fs/promises';
import path from 'node:path';
import { createJiti } from 'jiti';
import semver from 'semver';
import { z } from 'zod';
import { getEventMetadata, type EventMetadata, type EventRole } from './define-event';

export interface SourceLocation {
  file: string; // relative to the scanned root
  symbol: string;
  line: number;
}

export interface DiscoveredEvent {
  id: string;
  version: string;
  name: string;
  summary: string;
  schema: Record<string, unknown>;
  producers: string[];
  consumers: string[];
  owners: string[];
  role: EventRole;
  /** defineEvent() metadata was present vs. naming-convention guesswork. */
  kind: 'defineEvent' | 'convention';
  needsReview: boolean;
  source: SourceLocation;
}

export interface DiscoverResult {
  events: DiscoveredEvent[];
  errors: string[];
}

const DEFAULT_EXCLUDE = ['node_modules', 'dist', 'build', '.git', 'coverage'];
const SOURCE_EXT = /\.(ts|tsx|mts|cts)$/;
const TEST_FILE = /\.(test|spec|stories)\.[cm]?tsx?$/;
const CONVENTION_RE = /(Event|EventSchema)$/;
const EVENT_SYMBOL_IN_EXPORT_RE = /\bexport\b[\s\S]{0,200}\b[A-Za-z_$][A-Za-z0-9_$]*(?:Event|EventSchema)\b/;

const nonEmptyString = z.string().trim().min(1);
const catalogId = nonEmptyString.regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  'Use letters, numbers, dots, underscores, or hyphens'
);
const serviceIds = z.array(catalogId).refine((ids) => new Set(ids).size === ids.length, 'Service ids must be unique');
const eventMetadataSchema = z
  .object({
    id: catalogId,
    version: nonEmptyString.refine((version) => semver.valid(version) !== null, {
      message: 'Expected a semantic version such as 1.0.0',
    }),
    role: z.enum(['provider', 'client']).optional(),
    name: nonEmptyString.optional(),
    summary: nonEmptyString.optional(),
    producers: serviceIds.optional(),
    consumers: serviceIds.optional(),
    owners: z.array(nonEmptyString).optional(),
  })
  .strict();

export function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return typeof value === 'object' && value !== null && typeof (value as { safeParse?: unknown }).safeParse === 'function';
}

/** "ParcelShippedEvent" | "ParcelShippedEventSchema" → "parcel.shipped" */
export function idFromSymbol(symbol: string): string {
  const base = symbol.replace(/EventSchema$|Event$|Schema$/, '') || symbol;
  return base.replace(/([a-z0-9])([A-Z])/g, '$1.$2').toLowerCase();
}

/** "order.placed" → "Order Placed" */
export function nameFromId(id: string): string {
  return id
    .split(/[.\-_/]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

async function walkSource(root: string, exclude: Set<string>): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!exclude.has(entry.name) && !entry.name.startsWith('.')) await walk(full);
      } else if (SOURCE_EXT.test(entry.name) && !TEST_FILE.test(entry.name)) {
        results.push(full);
      }
    }
  }
  await walk(root);
  return results.sort();
}

function lineForExport(text: string, symbol: string): number {
  const lines = text.split('\n');
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns =
    symbol === 'default'
      ? [/\bexport\s+default\b/]
      : [
          new RegExp(`\\b(?:const|let|var|class|function)\\s+${escaped}\\b`),
          new RegExp(`\\b${escaped}\\s+as\\s+[A-Za-z_$][A-Za-z0-9_$]*\\b`),
          new RegExp(`\\b${escaped}\\b`),
        ];

  for (const pattern of patterns) {
    const index = lines.findIndex((line) => pattern.test(line));
    if (index >= 0) return index + 1;
  }
  return 1;
}

function toDiscoveredEvent(input: {
  value: unknown;
  meta: EventMetadata | undefined;
  relFile: string;
  symbol: string;
  line: number;
}): DiscoveredEvent | null {
  const { value, relFile, symbol, line } = input;
  if (!isZodSchema(value)) return null;

  const meta = input.meta ? eventMetadataSchema.parse(input.meta) : undefined;
  const id = catalogId.parse(meta?.id ?? idFromSymbol(symbol));
  const needsReview = !meta;

  return {
    id,
    version: meta?.version ?? '0.1.0',
    name: meta?.name ?? nameFromId(id),
    summary: meta?.summary ?? `Inferred from export \`${symbol}\` in ${relFile}; review before trusting.`,
    schema: z.toJSONSchema(value) as Record<string, unknown>,
    producers: meta?.producers ?? [],
    consumers: meta?.consumers ?? [],
    owners: meta?.owners ?? [],
    role: meta?.role ?? 'provider',
    kind: meta ? 'defineEvent' : 'convention',
    needsReview,
    source: { file: relFile, symbol, line },
  };
}

/**
 * Discover Zod event definitions in a repo.
 * - defineEvent()-wrapped schema exports → documented as declared
 * - bare Zod exports named *Event / *EventSchema → inferred, flagged for review
 */
export async function discoverZodEvents(opts: { root: string; exclude?: string[] }): Promise<DiscoverResult> {
  const root = path.resolve(opts.root);
  const exclude = new Set([...DEFAULT_EXCLUDE, ...(opts.exclude ?? [])]);
  const files = await walkSource(root, exclude);

  // Every imported path is absolute, so using the scan root as Jiti's base
  // keeps the published ESM and CommonJS builds free of import.meta shims.
  const jiti = createJiti(root, { interopDefault: true });
  const events: DiscoveredEvent[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const relFile = path.relative(root, file);
    const usesDefineEvent = /\bdefineEvent\s*\(/.test(text);
    if (!usesDefineEvent && !EVENT_SYMBOL_IN_EXPORT_RE.test(text)) continue;

    let mod: Record<string, unknown>;
    try {
      mod = (await jiti.import(file)) as Record<string, unknown>;
    } catch (err) {
      errors.push(`${relFile}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const [symbol, value] of Object.entries(mod)) {
      const meta = getEventMetadata(value);
      if (!meta && !CONVENTION_RE.test(symbol)) continue;
      try {
        const event = toDiscoveredEvent({
          value,
          meta,
          relFile,
          symbol,
          line: lineForExport(text, symbol),
        });
        if (event) events.push(event);
      } catch (err) {
        errors.push(`${relFile} (${symbol}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return { events, errors };
}
