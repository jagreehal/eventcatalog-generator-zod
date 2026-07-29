# Zod generator for EventCatalog

Your `OrderPlacedEvent` rejects bad payloads in production. EventCatalog cannot see it.

A developer renames `total` to `amount`. The service is correct, the copied catalog schema is stale, and both builds stay green. An analytics consumer reads the catalog, sends `total`, and meets a runtime rejection on its first message.

Duplicate contract maintenance is the villain. A pasted schema drifts; a separately maintained specification needs someone to catch each code change and mirror it. Human memory has already produced two contracts that disagree.

`eventcatalog-generator-zod` closes that gap. It scans the trusted Zod schemas that already validate your messages, writes their JSON Schemas to EventCatalog, and fails generation when a payload changes without a version bump.

```text
Zod event in source
        |
        v
eventcatalog-generator-zod
        |
        +-- event + schema.json
        +-- producer and consumer relationships
        +-- service and domain pages
        `-- nonzero exit on contract drift
```

The executable contracts become the catalog, removing a second specification someone has to remember to update.

## What it generates

One annotated Zod schema can produce:

- a versioned EventCatalog event with `schema.json`
- producer and consumer relationships
- service resources
- an optional domain and its service relationships
- source provenance down to the exported symbol and line

For example:

```text
domains/
  orders/
    services/
      orders-service/
        events/
          order.placed/
            index.mdx
            schema.json
```

Generated event pages render the payload through EventCatalog's `<SchemaViewer />`. Handwritten Markdown outside the generator's ownership markers survives regeneration.

## Install

Install the generator in the EventCatalog project:

```sh
npm install --save-dev eventcatalog-generator-zod
```

If a source project uses `defineEvent()`, install the package there too:

```sh
npm install eventcatalog-generator-zod
```

Projects that use only the `*Event` naming convention do not need the runtime package.

## Define the provider contract

The service that owns an event's payload declares `role: 'provider'`. Provider is the default, but spelling it out makes ownership clear in a multi-repository system.

```ts
import { z } from 'zod';
import { defineEvent } from 'eventcatalog-generator-zod/define-event';

export const OrderPlacedEvent = defineEvent(
  {
    id: 'order.placed',
    version: '1.0.0',
    role: 'provider',
    summary: 'Emitted when a customer places an order.',
    producers: ['orders-service'],
    consumers: ['billing-service'],
    owners: ['orders-team'],
  },
  z.object({
    orderId: z.string(),
    total: z.number().positive(),
  })
);
```

`defineEvent()` returns the same Zod schema. Its inferred TypeScript type and runtime validation still work:

```ts
type OrderPlaced = z.infer<typeof OrderPlacedEvent>;

const message: OrderPlaced = OrderPlacedEvent.parse(payload);
```

When a TypeScript frontend and microservice import the same contract package, both receive the payload type at compile time and the Zod check at runtime. Non-TypeScript consumers can use the generated JSON Schema. The contract is about the payload, so it can travel over Kafka, NATS, SQS, HTTP, WebSockets, or a test fixture without changing its meaning.

## Configure EventCatalog

Add the generator to `eventcatalog.config.js`. An absolute source path is safest because generation may run from a different working directory in CI.

```js
import { fileURLToPath } from 'node:url';

const ordersService = fileURLToPath(new URL('../orders-service', import.meta.url));

export default {
  // Your existing EventCatalog configuration
  generators: [
    [
      'eventcatalog-generator-zod',
      {
        source: ordersService,
        domain: {
          id: 'orders',
          name: 'Orders',
          version: '1.0.0',
        },
      },
    ],
  ],
};
```

Run the standard EventCatalog command:

```sh
npm run generate
```

Commit the generated catalog files. That makes schema changes reviewable in pull requests and lets CI prove the committed output matches the source.

```sh
npm run generate
git diff --exit-code
```

## Share one event across repositories

The provider owns the payload schema. A client records only its relationship to that contract:

```ts
import { z } from 'zod';
import { defineEvent } from 'eventcatalog-generator-zod/define-event';

export const OrderPlacedEvent = defineEvent(
  {
    id: 'order.placed',
    version: '1.0.0',
    role: 'client',
    consumers: ['analytics-service'],
  },
  // This local shape is useful for typing and validation, but it cannot
  // overwrite the provider's catalog schema.
  z.object({
    orderId: z.string(),
    total: z.number(),
  })
);
```

Scan both repositories in one run:

```js
[
  'eventcatalog-generator-zod',
  {
    source: [
      '/Users/me/dev/orders-service',
      '/Users/me/dev/analytics-service',
    ],
  },
],
```

You can also invoke the generator once per repository. Existing service and domain relationships are merged instead of replaced.

The ownership rules are strict:

- one provider owns each event id and version
- any number of clients may add producer or consumer relationships
- a client cannot replace the provider's schema
- a client-only scan succeeds only when that provider version is already in the catalog
- two providers for the same event id fail before writes begin

These rules follow the same provider/client split used by EventCatalog's first-party AsyncAPI workflows.

## Watch drift fail

Suppose the provider changes the schema:

```diff
- total: z.number().positive(),
+ amount: z.number().positive(),
```

If the version stays at `1.0.0`, generation fails:

```text
Schema for event "order.placed" changed without a version bump (1.0.0).
Increment the event version before generating.
```

The process exits nonzero even though EventCatalog's generator loader currently catches generator exceptions. Contract validation goes red before the generator refreshes events, services, or domains.

Change the source version to `2.0.0` and run generation again. The old `1.0.0` event is preserved under `versioned/1.0.0`, and the latest page becomes `2.0.0`.

Version downgrades fail too.

## Convention-only discovery

Existing schemas can opt in without `defineEvent()`:

```ts
export const ParcelShippedEventSchema = z.object({
  parcelId: z.string(),
  shippedAt: z.iso.datetime(),
});
```

Exports ending in `Event` or `EventSchema` are inferred with a `0.1.0` version and a `Needs review` badge. This is useful for adoption, but explicit metadata should be the destination because inferred contracts cannot name their owners, producers, or consumers.

Named re-exports are supported.

## Options

| Option            | Type                             | Default  | Description                                                                                |
| ----------------- | -------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `source`          | `string \| string[]`             | required | One or more trusted directories to scan.                                                   |
| `exclude`         | `string[]`                       | `[]`     | Extra directory names to skip. Dependency and build directories are skipped automatically. |
| `domain`          | `{ id, name, version, owners? }` | none     | Domain under which discovered services are written.                                        |
| `debug`           | `boolean`                        | `false`  | Log every discovered event and source location.                                            |
| `continueOnError` | `boolean`                        | `false`  | Skip modules that fail to load. Use for exploration, not CI.                               |
| `allowEmpty`      | `boolean`                        | `false`  | Allow a run that discovers no events.                                                      |

Event and domain versions must be valid semantic versions. Event ids may contain letters, numbers, dots, underscores, and hyphens.

## What each check catches

| Check                                     | Failure it prevents                                   |
| ----------------------------------------- | ----------------------------------------------------- |
| Changed JSON Schema at the same version   | Silent payload drift                                  |
| Lower or repeated incompatible version    | Replacing a newer contract with an older one          |
| More than one provider for an event id    | Competing sources of truth                            |
| Client without a provider contract        | Relationships pointing at an undocumented payload     |
| Missing source or broken candidate import | A green build that generated only part of the catalog |
| No discovered events                      | A bad path that quietly produces nothing              |
| Invalid metadata                          | Broken catalog ids or versions                        |

Strict behavior is the default. `continueOnError` and `allowEmpty` must be chosen explicitly.

## How scanning works

The generator examines `.ts`, `.tsx`, `.mts`, and `.cts` files. It skips tests, stories, hidden directories, dependencies, and common build output. A file becomes a candidate when it calls `defineEvent()` or exports a matching symbol. Candidate modules are imported, then their runtime exports are inspected.

> **Only scan trusted code.** Importing a candidate module executes its top-level code. Keep contract modules free of startup work such as database connections, servers, or required production credentials.

If application modules have unavoidable side effects, re-export schemas from a dedicated contracts directory and scan that directory.

## Markdown ownership

Event pages contain an owned region:

```md
<!-- eventcatalog-generator-zod:generated:start -->

Generated schema, diagram, and source details
<!-- eventcatalog-generator-zod:generated:end -->
```

The generator refreshes content inside the markers. Notes outside them remain untouched across regeneration and event version changes. Existing service and domain Markdown is preserved too.

## Payload contract, transport contract, consumer contract

This package has a deliberately narrow job.

- Zod and JSON Schema describe the payload.
- AsyncAPI describes channels, protocols, bindings, and message flow.
- Protobuf and Buf are a strong fit when protobuf is already the organizational standard.
- Pact and other consumer-driven contract tools test whether real consumer expectations still hold.
- EventCatalog connects those artifacts into a navigable architecture catalog.

A payment moved from Kafka to SQS keeps the same `amount` field. Its redrive policy, delivery guarantees, and destination can change with the broker. Keep those transport facts in AsyncAPI or broker-specific documentation.

Consumer-driven contract testing remains a separate layer. A producer can publish a schema-valid breaking change that violates a consumer assumption. Use CDC when that risk matters.

## Lifecycle boundaries

- Removing an event from source does not delete its catalog page. Archive or remove obsolete catalog resources explicitly.
- With multiple producers, the event page lives beneath the first producer while every producer receives its `sends` relationship.
- The package generates JSON Schema from Zod v4.
- Node.js 22 or newer is required. Node.js 24 on macOS is supported.

## Development

```sh
pnpm install
pnpm check
pnpm build
pnpm test:dist
npm pack --dry-run
```

`pnpm check` verifies formatting, types, and the integration suite. `prepack` repeats the checks, rebuilds both module formats, and verifies that each can be loaded.

## License

MIT

That `total` to `amount` rename from the opening now has only two honest outcomes: bump the contract to `2.0.0`, or watch generation stop the build. The two green builds with two different truths are gone.
