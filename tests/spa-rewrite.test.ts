import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The rehearsal is a static deploy: Vercel serves index.html for client routes
// only when they appear in the rewrite list. A route added to <Routes> but not
// to that list returns a hard 404 on refresh or on a shared link, while
// in-app navigation still works, so the gap survives every click-through test.
// `/lab` shipped that way and 404'd in production. Derive the expectation from
// the router itself so the next route cannot repeat it.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Concrete URL paths the router claims to serve, ignoring the `*` fallback. */
async function routerPaths(): Promise<string[]> {
  const source = await readFile(path.join(root, 'src/App.tsx'), 'utf8');
  const block = source.slice(source.indexOf('<Routes>'), source.indexOf('</Routes>'));
  expect(block).not.toHaveLength(0);
  return [...block.matchAll(/path="([^"]+)"/g)]
    .map(([, value]) => value)
    .filter((value) => value !== '*')
    .map((value) => value.replace(/:[^/]+/g, 'example-id'));
}

/** The SPA rewrite Vercel applies, anchored the way the platform anchors it. */
async function rewrite(): Promise<RegExp> {
  const source = await readFile(path.join(root, 'scripts/build-rehearsal.ts'), 'utf8');
  const match = source.match(/\{ src: '([^']+)', dest: '\/index\.html' \}/);
  expect(match, 'build-rehearsal.ts should declare one SPA rewrite to /index.html').not.toBeNull();
  return new RegExp(`^${match![1]}$`);
}

describe('static rehearsal SPA rewrite', () => {
  it('serves every client route on a direct load', async () => {
    const pattern = await rewrite();
    const missing = (await routerPaths()).filter((route) => !pattern.test(route));
    expect(missing, `these routes would 404 on refresh: ${missing.join(', ')}`).toEqual([]);
  });

  it('still refuses paths the router does not claim', async () => {
    const pattern = await rewrite();
    for (const route of ['/api', '/merchant', '/tools', '/nope', '/lab/extra']) {
      expect(pattern.test(route), `${route} should not fall through to the shell`).toBe(false);
    }
  });
});
