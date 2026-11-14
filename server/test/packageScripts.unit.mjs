import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const scripts = packageJson.scripts ?? {};
const missing = [];

for (const [name, command] of Object.entries(scripts)) {
  for (const match of command.matchAll(/\btsx(?:\s+watch)?\s+([^\s&|;]+\.tsx?)/g)) {
    const target = match[1];
    if (!existsSync(resolve(process.cwd(), target))) missing.push(`${name}: ${target}`);
  }
}

assert.equal(scripts['test:saas-onboarding'], 'npm run test:onboarding:playwright');
assert.ok(scripts['test:onboarding:playwright'], 'onboarding Playwright command must exist');
assert.deepEqual(missing, [], `TypeScript script targets missing from disk: ${missing.join(', ')}`);

console.log(`PASS package scripts: ${Object.keys(scripts).length} commands and all tsx targets exist.`);
