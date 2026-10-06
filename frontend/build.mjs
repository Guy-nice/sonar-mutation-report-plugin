import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dev = process.argv.includes('--dev');
const out = fileURLToPath(new URL('../src/main/resources/static/', import.meta.url));
mkdirSync(out, { recursive: true });
const common = { bundle: true, format: 'iife', target: 'es2020', minify: !dev, logLevel: 'info' };
await build({ ...common, entryPoints: ['src/entry-overview.ts'], outfile: out + 'overview.js' });
await build({ ...common, entryPoints: ['src/entry-project.ts'], outfile: out + 'project.js' });
if (dev) {
  await build({ ...common, minify: false, entryPoints: ['dev/main.ts'], outfile: 'dev/dist/dev.js' });
}
