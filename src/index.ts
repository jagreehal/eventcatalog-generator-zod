import utils from '@eventcatalog/sdk';
import chalk from 'chalk';
import { join } from 'node:path';
import semver from 'semver';
import { z } from 'zod';

import { discoverZodEvents, type DiscoveredEvent } from './scanner';
import {
  defaultMarkdownForDomain,
  defaultMarkdownForEvent,
  defaultMarkdownForService,
  mergeGeneratedMarkdown,
} from './utils/markdown';

export { defineEvent, getEventMetadata, type EventMetadata, type EventRole } from './define-event';
export { discoverZodEvents, type DiscoveredEvent, type DiscoverResult } from './scanner';

const nonEmptyString = z.string().trim().min(1);
const catalogId = nonEmptyString.regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  'Use letters, numbers, dots, underscores, or hyphens'
);
const semanticVersion = nonEmptyString.refine((version) => semver.valid(version) !== null, {
  message: 'Expected a semantic version such as 1.0.0',
});

const optionsSchema = z
  .object({
    /** Directory (or directories) to scan for Zod event schemas. */
    source: z.union([nonEmptyString, z.array(nonEmptyString).min(1)]),
    /** Directory names never descended into (node_modules, dist etc. are always skipped). */
    exclude: z.array(z.string()).optional(),
    domain: z
      .object({
        id: catalogId,
        name: nonEmptyString,
        version: semanticVersion,
        owners: z.array(nonEmptyString).optional(),
      })
      .strict()
      .optional(),
    debug: z.boolean().optional(),
    /** Continue with successfully loaded files. Strict failure is the default. */
    continueOnError: z.boolean().optional(),
    /** Permit a successful run that discovers no events. */
    allowEmpty: z.boolean().optional(),
  })
  .strict();

export type Options = z.infer<typeof optionsSchema>;

const ZOD_BADGE = { content: 'Zod', backgroundColor: 'purple', textColor: 'white' };
const REVIEW_BADGE = { content: 'Needs review', backgroundColor: 'orange', textColor: 'white' };

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)])
    );
  }
  return value;
}

function schemasMatch(existing: string, generated: Record<string, unknown>): boolean {
  try {
    return JSON.stringify(canonicalJson(JSON.parse(existing))) === JSON.stringify(canonicalJson(generated));
  } catch {
    return false;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function mergeResourcePointers<T extends { id: string }>(existing: T[] = [], incoming: T[] = []): T[] {
  const pointers = new Map(existing.map((pointer) => [pointer.id, pointer]));
  for (const pointer of incoming) pointers.set(pointer.id, pointer);
  return [...pointers.values()].sort((left, right) => left.id.localeCompare(right.id));
}

async function generate(_: unknown, options: Options) {
  if (!process.env.PROJECT_DIR) {
    process.env.PROJECT_DIR = process.cwd();
  }

  const {
    writeEvent,
    getEvent,
    getSchemaForMessage,
    versionEvent,
    addSchemaToEvent,
    writeService,
    getService,
    addEventToService,
    writeDomain,
    getDomain,
    versionDomain,
  } = utils(process.env.PROJECT_DIR);

  const { source, exclude, domain, debug, continueOnError, allowEmpty } = optionsSchema.parse(options);
  const roots = Array.isArray(source) ? source : [source];

  console.log(chalk.green(`\nScanning ${roots.length} source root(s) for Zod events...\n`));

  const events: DiscoveredEvent[] = [];
  const discoveryErrors: string[] = [];
  for (const root of roots) {
    try {
      const result = await discoverZodEvents({ root, exclude });
      events.push(...result.events);
      discoveryErrors.push(...result.errors.map((error) => `${root}: ${error}`));
    } catch (error) {
      discoveryErrors.push(`${root}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (discoveryErrors.length > 0 && !continueOnError) {
    throw new Error(`Zod event discovery failed:\n${discoveryErrors.map((error) => ` - ${error}`).join('\n')}`);
  }
  for (const error of discoveryErrors) {
    console.log(chalk.yellow(` - Skipped: ${error}`));
  }

  if (events.length === 0 && !allowEmpty) {
    throw new Error('Zod event discovery found no events. Check the source path and exports, or set allowEmpty: true.');
  }

  const eventsById = new Map<string, DiscoveredEvent[]>();
  for (const event of events) {
    const definitions = eventsById.get(event.id) ?? [];
    definitions.push(event);
    eventsById.set(event.id, definitions);
  }

  const contractEvents: DiscoveredEvent[] = [];
  const clientOnlyEvents: DiscoveredEvent[] = [];
  for (const [id, definitions] of eventsById) {
    const providers = definitions.filter((event) => event.role === 'provider');
    if (providers.length > 1) {
      throw new Error(
        `Duplicate event id "${id}" has more than one provider: ${providers
          .map((event) => `${event.source.file}:${event.source.line}`)
          .join(', ')}`
      );
    }

    const versions = unique(definitions.map((event) => event.version));
    if (versions.length > 1) {
      throw new Error(`Shared event "${id}" has conflicting versions: ${versions.join(', ')}`);
    }

    const provider = providers[0];
    if (!provider) {
      clientOnlyEvents.push(...definitions);
      continue;
    }

    contractEvents.push({
      ...provider,
      producers: unique(definitions.flatMap((event) => event.producers)),
      consumers: unique(definitions.flatMap((event) => event.consumers)),
    });
  }

  if (debug) {
    for (const event of events) {
      console.log(
        chalk.gray(`Discovered ${event.id} (${event.kind}, ${event.role}) at ${event.source.file}:${event.source.line}`)
      );
    }
  }

  const servicePathFor = (serviceId: string) =>
    domain ? join('../', 'domains', domain.id, 'services', serviceId) : join('../', 'services', serviceId);

  // service id → { sends, receives }
  const services = new Map<
    string,
    { sends: { id: string; version: string }[]; receives: { id: string; version: string }[] }
  >();
  const serviceEntry = (id: string) => {
    if (!services.has(id)) services.set(id, { sends: [], receives: [] });
    return services.get(id)!;
  };

  for (const event of events) {
    for (const serviceId of event.producers) {
      serviceEntry(serviceId).sends.push({ id: event.id, version: event.version });
    }
    for (const serviceId of event.consumers) {
      serviceEntry(serviceId).receives.push({ id: event.id, version: event.version });
    }
  }

  for (const event of clientOnlyEvents) {
    const providerContract = await getEvent(event.id, event.version);
    if (!providerContract) {
      throw new Error(
        `Event "${event.id}" has role "client" but no provider exists for version ${event.version}. Scan its provider in the same run or generate the provider first.`
      );
    }
  }

  // Validate every existing event before rewriting any of them. This keeps a
  // drift or downgrade failure from leaving a partially refreshed catalog.
  const latestEvents = new Map<string, Awaited<ReturnType<typeof getEvent>>>();
  for (const event of contractEvents) {
    const latest = await getEvent(event.id, 'latest');
    if (!latest) continue;

    if (latest.version === event.version) {
      const existingSchema = await getSchemaForMessage(event.id, event.version);
      if (existingSchema && !schemasMatch(existingSchema.schema, event.schema)) {
        throw new Error(
          `Schema for event "${event.id}" changed without a version bump (${event.version}). Increment the event version before generating.`
        );
      }
    } else if (!semver.gt(event.version, latest.version)) {
      throw new Error(
        `Event "${event.id}" must advance from ${latest.version}; received ${event.version}. Version downgrades are not allowed.`
      );
    }

    latestEvents.set(event.id, latest);
  }

  for (const event of contractEvents) {
    console.log(chalk.blue(`Processing event: ${event.name} (v${event.version})`));

    let markdown = defaultMarkdownForEvent(event);
    let badges = [ZOD_BADGE, ...(event.needsReview ? [REVIEW_BADGE] : [])];

    const latestInCatalog = latestEvents.get(event.id);
    if (latestInCatalog) {
      markdown = mergeGeneratedMarkdown(latestInCatalog.markdown, markdown);
      const userBadges = (latestInCatalog.badges || []).filter(
        (badge: { content?: string }) => badge.content !== ZOD_BADGE.content && badge.content !== REVIEW_BADGE.content
      );
      badges = [...userBadges, ...badges];
      if (latestInCatalog.version !== event.version) {
        await versionEvent(event.id);
        console.log(chalk.cyan(` - Versioned previous event: ${event.name} (v${latestInCatalog.version})`));
      }
    }

    const producer = event.producers[0];
    const eventPath = producer ? join(servicePathFor(producer), 'events', event.id) : event.id;

    await writeEvent(
      {
        id: event.id,
        name: event.name,
        version: event.version,
        summary: event.summary,
        markdown,
        badges,
        ...(event.owners.length > 0 ? { owners: event.owners } : {}),
        schemaPath: 'schema.json',
      },
      { path: eventPath, override: true }
    );

    await addSchemaToEvent(
      event.id,
      { fileName: 'schema.json', schema: JSON.stringify(event.schema, null, 2) },
      event.version
    );

    console.log(chalk.cyan(` - Event (v${event.version}) created`));
  }

  for (const [serviceId, { sends, receives }] of services) {
    console.log(chalk.blue(`Processing service: ${serviceId}`));

    const latestInCatalog = await getService(serviceId, 'latest');
    const version = latestInCatalog?.version ?? '1.0.0';
    if (latestInCatalog) {
      for (const event of mergeResourcePointers([], sends)) {
        await addEventToService(serviceId, 'sends', event, latestInCatalog.version);
      }
      for (const event of mergeResourcePointers([], receives)) {
        await addEventToService(serviceId, 'receives', event, latestInCatalog.version);
      }
    } else {
      await writeService(
        {
          id: serviceId,
          name: serviceId,
          version,
          summary: '',
          markdown: defaultMarkdownForService(serviceId),
          ...(sends.length > 0 ? { sends: mergeResourcePointers([], sends) } : {}),
          ...(receives.length > 0 ? { receives: mergeResourcePointers([], receives) } : {}),
        },
        { path: servicePathFor(serviceId), override: true }
      );
    }

    console.log(chalk.cyan(` - Service (v${version}) created`));
  }

  if (domain) {
    console.log(chalk.blue(`\nProcessing domain: ${domain.name} (v${domain.version})`));

    let markdown = defaultMarkdownForDomain();
    let owners = domain.owners || [];

    const latestInCatalog = await getDomain(domain.id, 'latest');
    if (latestInCatalog) {
      markdown = latestInCatalog.markdown;
      owners = latestInCatalog.owners || owners;
      if (latestInCatalog.version !== domain.version) {
        await versionDomain(domain.id);
        console.log(chalk.cyan(` - Versioned previous domain: ${domain.name} (v${latestInCatalog.version})`));
      }
    }

    const discoveredServices = [...services.keys()].map((id) => ({ id, version: 'latest' }));
    await writeDomain(
      {
        ...(latestInCatalog ?? {}),
        id: domain.id,
        name: domain.name,
        version: domain.version,
        markdown,
        services: mergeResourcePointers(latestInCatalog?.services, discoveredServices),
        ...(owners.length > 0 ? { owners } : {}),
      },
      { override: true }
    );

    console.log(chalk.cyan(` - Domain (v${domain.version}) created`));
  }

  const needsReview = events.filter((event) => event.needsReview);
  if (needsReview.length > 0) {
    console.log(chalk.yellow(`\n${needsReview.length} event(s) inferred from naming conventions and flagged for review:`));
    for (const event of needsReview) {
      console.log(chalk.yellow(` - ${event.id} (${event.source.file}:${event.source.line})`));
    }
  }

  console.log(
    chalk.blue(
      `\nZod event processing complete: ${contractEvents.length} contract(s) written from ${events.length} definition(s).\n`
    )
  );
}

export default async (config: unknown, options: Options) => {
  try {
    return await generate(config, options);
  } catch (error) {
    // EventCatalog currently logs and swallows generator exceptions. Preserve
    // the exception for callers and make the CLI process fail for CI.
    process.exitCode = 1;
    throw error;
  }
};
