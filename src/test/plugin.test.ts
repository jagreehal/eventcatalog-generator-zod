import { expect, it, describe, beforeEach, afterEach } from 'vitest';
import utils from '@eventcatalog/sdk';
import plugin from '../index';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';

// Fake eventcatalog config
const config = {};

let catalogDir: string;
const exampleRepo = join(__dirname, 'example-repo');
const exampleRepoV2 = join(__dirname, 'example-repo-v2');
const duplicateRepo = join(__dirname, 'duplicate-repo');
const brokenRepo = join(__dirname, 'broken-repo');
const invalidMetadataRepo = join(__dirname, 'invalid-metadata-repo');
const reexportRepo = join(__dirname, 'reexport-repo');
const schemaDriftRepo = join(__dirname, 'schema-drift-repo');
const ownershipProviderRepo = join(__dirname, 'ownership-provider-repo');
const ownershipClientRepo = join(__dirname, 'ownership-client-repo');
const aggregateOneRepo = join(__dirname, 'aggregate-one-repo');
const aggregateTwoRepo = join(__dirname, 'aggregate-two-repo');
const originalExitCode = process.exitCode;

describe.sequential('Zod EventCatalog Plugin', () => {
  beforeEach(async () => {
    catalogDir = await fs.mkdtemp(join(__dirname, 'catalog-'));
    process.env.PROJECT_DIR = catalogDir;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    await fs.rm(catalogDir, { recursive: true, force: true });
    process.exitCode = originalExitCode;
  });

  describe.sequential('events', () => {
    it('documents events defined with defineEvent(), including their JSON schema', async () => {
      const { getEvent } = utils(catalogDir);

      await plugin(config, { source: exampleRepo });

      const event = await getEvent('order.placed', '1.0.0');
      expect(event).toEqual(
        expect.objectContaining({
          id: 'order.placed',
          name: 'Order Placed',
          version: '1.0.0',
          summary: 'Emitted when a customer places an order.',
          owners: ['orders-team'],
        })
      );

      const schemaPath = join(catalogDir, 'services', 'orders-service', 'events', 'order.placed', 'schema.json');
      expect(existsSync(schemaPath)).toBe(true);
      const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
      expect(schema.properties).toHaveProperty('orderId');
    });

    it('infers events from *EventSchema naming conventions and flags them for review', async () => {
      const { getEvent } = utils(catalogDir);

      await plugin(config, { source: exampleRepo });

      const event = await getEvent('parcel.shipped', 'latest');
      expect(event).toEqual(
        expect.objectContaining({
          id: 'parcel.shipped',
          name: 'Parcel Shipped',
          version: '0.1.0',
          badges: expect.arrayContaining([expect.objectContaining({ content: 'Needs review' })]),
        })
      );
    });

    it('versions events when the version in source changes, keeping user-edited markdown', async () => {
      const { getEvent } = utils(catalogDir);

      await plugin(config, { source: exampleRepo });
      const indexPath = join(catalogDir, 'services', 'orders-service', 'events', 'order.placed', 'index.mdx');
      await fs.appendFile(indexPath, '\n\nDeployment owner: Orders Platform.\n');
      await plugin(config, { source: exampleRepoV2 });

      const previous = await getEvent('order.placed', '1.0.0');
      expect(previous).toBeDefined();

      const latest = await getEvent('order.placed', 'latest');
      expect(latest.version).toBe('2.0.0');
      expect(latest.markdown).toContain('Deployment owner: Orders Platform.');
    });

    it('is idempotent when run twice against the same source', async () => {
      const { getEvent } = utils(catalogDir);

      await plugin(config, { source: exampleRepo });
      await plugin(config, { source: exampleRepo });

      const event = await getEvent('order.placed', 'latest');
      expect(event.version).toBe('1.0.0');
    });

    it('rejects schema drift without a version bump', async () => {
      await plugin(config, { source: exampleRepo });

      await expect(plugin(config, { source: schemaDriftRepo })).rejects.toThrow('changed without a version bump');

      const { getEvent } = utils(catalogDir);
      expect((await getEvent('order.placed', 'latest')).version).toBe('1.0.0');
    });

    it('rejects event version downgrades', async () => {
      await plugin(config, { source: exampleRepoV2 });

      await expect(plugin(config, { source: exampleRepo })).rejects.toThrow('Version downgrades are not allowed');
    });

    it('discovers named re-exports that follow the event convention', async () => {
      const { getEvent } = utils(catalogDir);

      await plugin(config, { source: reexportRepo });

      const event = await getEvent('payment.captured', 'latest');
      expect(event).toEqual(
        expect.objectContaining({
          id: 'payment.captured',
          version: '0.1.0',
        })
      );
      expect(event.markdown).toContain('src/events.ts');
    });

    it('uses the provider schema and client relationships for a shared event', async () => {
      const { getSchemaForMessage } = utils(catalogDir);

      await plugin(config, {
        source: [ownershipProviderRepo, ownershipClientRepo],
      });

      const schema = await getSchemaForMessage('order.placed', '1.0.0');
      expect(schema?.schema).toContain('providerField');
      expect(schema?.schema).not.toContain('clientMirrorMustNotWin');
      const providerService = await fs.readFile(join(catalogDir, 'services', 'orders-service', 'index.mdx'), 'utf8');
      const clientService = await fs.readFile(join(catalogDir, 'services', 'analytics-service', 'index.mdx'), 'utf8');
      expect(providerService).toContain('sends:');
      expect(providerService).toContain('id: order.placed');
      expect(providerService).toContain('version: 1.0.0');
      expect(providerService).not.toContain('2.0.0');
      expect(clientService).toContain('receives:');
      expect(clientService).toContain('id: order.placed');
      expect(clientService).toContain('version: 1.0.0');
    });

    it('lets a client add relationships without overwriting an existing provider contract', async () => {
      const { getSchemaForMessage, getService } = utils(catalogDir);

      await plugin(config, { source: ownershipProviderRepo });
      await plugin(config, { source: ownershipClientRepo });

      const schema = await getSchemaForMessage('order.placed', '1.0.0');
      expect(schema?.schema).toContain('providerField');
      expect(schema?.schema).not.toContain('clientMirrorMustNotWin');
      expect((await getService('analytics-service', 'latest')).receives).toEqual([{ id: 'order.placed', version: '1.0.0' }]);
    });

    it('rejects a client contract when no provider exists', async () => {
      await expect(plugin(config, { source: ownershipClientRepo })).rejects.toThrow(
        'has role "client" but no provider exists'
      );
    });
  });

  describe.sequential('strict discovery', () => {
    it('fails when a source root does not exist', async () => {
      await expect(plugin(config, { source: join(__dirname, 'does-not-exist') })).rejects.toThrow(
        'Zod event discovery failed'
      );
      expect(process.exitCode).toBe(1);
    });

    it('fails when a candidate module cannot be imported', async () => {
      await expect(plugin(config, { source: brokenRepo })).rejects.toThrow('fixture import failed');
    });

    it('can continue past broken modules when explicitly requested', async () => {
      await expect(
        plugin(config, {
          source: [brokenRepo, exampleRepo],
          continueOnError: true,
        })
      ).resolves.toBeUndefined();

      const { getEvent } = utils(catalogDir);
      expect(await getEvent('order.placed', 'latest')).toBeDefined();
    });

    it('fails on invalid event metadata', async () => {
      await expect(plugin(config, { source: invalidMetadataRepo })).rejects.toThrow(
        'Expected a semantic version such as 1.0.0'
      );
    });

    it('fails before writing when duplicate event ids are discovered', async () => {
      await expect(plugin(config, { source: duplicateRepo })).rejects.toThrow('Duplicate event id "duplicate.event"');
      expect(existsSync(join(catalogDir, 'events', 'duplicate.event'))).toBe(false);
    });

    it('requires allowEmpty for an empty source', async () => {
      const emptyRepo = join(catalogDir, 'empty-source');
      await fs.mkdir(emptyRepo, { recursive: true });

      await expect(plugin(config, { source: emptyRepo })).rejects.toThrow('found no events');
      await expect(plugin(config, { source: emptyRepo, allowEmpty: true })).resolves.toBeUndefined();
    });
  });

  describe.sequential('services', () => {
    it('creates services from the producers and consumers declared on events', async () => {
      await plugin(config, { source: exampleRepo });

      const producer = await fs.readFile(join(catalogDir, 'services', 'orders-service', 'index.mdx'), 'utf8');
      expect(producer).toContain('sends:');
      expect(producer).toContain('id: order.placed');
      expect(producer).toContain('version: 1.0.0');
      expect(producer).not.toContain('2.0.0');

      const consumer = await fs.readFile(join(catalogDir, 'services', 'billing-service', 'index.mdx'), 'utf8');
      expect(consumer).toContain('receives:');
      expect(consumer).toContain('id: order.placed');
      expect(consumer).toContain('version: 1.0.0');
    });

    it('merges relationships produced by separate generator invocations', async () => {
      const { getService } = utils(catalogDir);

      await plugin(config, { source: aggregateOneRepo });
      await plugin(config, { source: aggregateTwoRepo });

      expect((await getService('shared-service', 'latest')).receives).toEqual([
        { id: 'first.created', version: '1.0.0' },
        { id: 'second.created', version: '1.0.0' },
      ]);
    });
  });

  describe.sequential('domains', () => {
    it('adds discovered services to the configured domain', async () => {
      const { getDomain } = utils(catalogDir);

      await plugin(config, {
        source: exampleRepo,
        domain: { id: 'orders', name: 'Orders Domain', version: '1.0.0' },
      });

      const domain = await getDomain('orders', '1.0.0');
      expect(domain).toEqual(
        expect.objectContaining({
          id: 'orders',
          name: 'Orders Domain',
          services: expect.arrayContaining([expect.objectContaining({ id: 'orders-service' })]),
        })
      );

      const eventPath = join(
        catalogDir,
        'domains',
        'orders',
        'services',
        'orders-service',
        'events',
        'order.placed',
        'index.mdx'
      );
      expect(existsSync(eventPath)).toBe(true);
    });

    it('merges services produced by separate generator invocations', async () => {
      const { getDomain } = utils(catalogDir);
      const domain = { id: 'shared', name: 'Shared Domain', version: '1.0.0' };

      await plugin(config, { source: aggregateOneRepo, domain });
      await plugin(config, { source: aggregateTwoRepo, domain });

      expect((await getDomain('shared', 'latest')).services).toEqual([
        { id: 'first-service', version: 'latest' },
        { id: 'second-service', version: 'latest' },
        { id: 'shared-service', version: 'latest' },
      ]);
    });
  });
});
