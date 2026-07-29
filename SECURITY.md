# Security model

Read this before pointing `eventcatalog-generator-zod` at code you do not trust.

## What the generator does

To discover Zod schemas, the generator **imports and executes** the TypeScript
files it scans (via jiti). Module top-level code in a scanned file runs with
your user privileges, your environment, and your filesystem.

- Only point `source` at directories you trust — your own repositories, not
  third-party or vendored code.
- Generation runs wherever `eventcatalog generate` runs (developer machines and
  CI), so scanned code executes there too.

## What it writes

The generator writes markdown and JSON Schema files into the EventCatalog
project directory (`PROJECT_DIR`). It does not make network calls of its own.

## Reporting a vulnerability

Email <jag.reehal+security@gmail.com> with details and a reproduction. Please do
not open a public issue for an unpatched vulnerability.
