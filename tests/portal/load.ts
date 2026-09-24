import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Vitest runs from the project root; under jsdom, import.meta.url is not a file URL. */
export function loadFixture(name: string): Document {
  const html = readFileSync(join(process.cwd(), 'tests/fixtures/portal', name), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}
