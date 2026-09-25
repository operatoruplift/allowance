import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { config } from './rehearsal-config';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.vercel/output');
await fs.mkdir(output, { recursive: true });
// Refuse to publish an output directory containing server functions or other build artifacts.
const previous = await fs.readdir(output);
if (previous.some((entry) => !['config.json', 'static'].includes(entry))) {
  throw new Error('Rehearsal output must contain only config.json and static assets.');
}
await build({
  root,
  configFile: path.join(root, 'vite.config.ts'),
  envDir: false,
  mode: 'rehearsal',
  define: { 'import.meta.env.VITE_REHEARSAL_ONLY': JSON.stringify('true') },
  build: { outDir: path.join(output, 'static'), emptyOutDir: true },
});

await fs.writeFile(path.join(output, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
process.stdout.write(
  'Static rehearsal prepared. No backend functions, signing or model runtime.\n'
);
