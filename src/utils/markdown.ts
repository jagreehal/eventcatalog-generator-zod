import type { DiscoveredEvent } from '../scanner';

const GENERATED_START = '<!-- eventcatalog-generator-zod:generated:start -->';
const GENERATED_END = '<!-- eventcatalog-generator-zod:generated:end -->';

function generatedBlock(markdown: string): string {
  const start = markdown.indexOf(GENERATED_START);
  const end = markdown.indexOf(GENERATED_END);
  if (start < 0 || end < start) {
    throw new Error('Generated EventCatalog markdown is missing its ownership markers');
  }
  return markdown.slice(start, end + GENERATED_END.length);
}

/**
 * Replace generator-owned documentation while preserving everything users
 * write outside the ownership markers.
 */
export function mergeGeneratedMarkdown(existing: string, generated: string): string {
  const replacement = generatedBlock(generated);
  const start = existing.indexOf(GENERATED_START);
  const end = existing.indexOf(GENERATED_END);

  if (start < 0 || end < start) {
    return `${replacement}\n\n${existing}`;
  }

  return `${existing.slice(0, start)}${replacement}${existing.slice(end + GENERATED_END.length)}`;
}

export const defaultMarkdownForEvent = (event: DiscoveredEvent) => {
  return `${GENERATED_START}
## Architecture Diagram

<NodeGraph />

## Schema

<SchemaViewer file="schema.json" title="Event Schema" maxHeight="500" />

## Source

Discovered from \`${event.source.file}\` (export \`${event.source.symbol}\`, line ${event.source.line}).${
    event.needsReview
      ? '\n\n> ⚠️ This event was inferred from a naming convention. Add `defineEvent()` metadata in the source file to confirm its id, version and summary.'
      : ''
  }
${GENERATED_END}

## Notes

Add operational context, examples, and migration notes here. Content outside the generated markers is preserved.`;
};

export const defaultMarkdownForService = (serviceId: string) => {
  return `## Architecture Diagram

<NodeGraph />

> This service was inferred from the \`producers\` and \`consumers\` declared on Zod event schemas (service id \`${serviceId}\`).
`;
};

export const defaultMarkdownForDomain = () => {
  return `## Architecture Diagram

<NodeGraph />
`;
};
