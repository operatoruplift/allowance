import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

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

const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'self'",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  // frame-ancestors above is the modern control; this covers older browsers
  // that ignore it, so the rehearsal can never be framed.
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const config = {
  version: 3,
  routes: [
    { src: '/.*', headers: securityHeaders, continue: true },
    { src: '/(?:api|merchant|tools)(?:/.*)?', status: 404 },
    {
      src: '/.*',
      methods: ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT'],
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    },
    { handle: 'filesystem' },
    { src: '/(?:demo|lab|developers|brand|login|app|runs/[^/]+)?/?', dest: '/index.html' },
  ],
};
await fs.writeFile(path.join(output, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
process.stdout.write(
  'Static rehearsal prepared. No backend functions, signing or model runtime.\n'
);
