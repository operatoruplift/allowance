import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { config, SPA_ROUTE } from '../scripts/rehearsal-config';
import { CLIENT_ROUTES, isClientRoute } from '../shared/routes';

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
function rewrite(): RegExp {
  return new RegExp(`^${SPA_ROUTE}$`);
}

/** The routes the platform applies once nothing else has answered. */
function errorRoutes() {
  const start = config.routes.findIndex((route) => route.handle === 'error');
  expect(start, 'the route table should handle errors itself').toBeGreaterThan(-1);
  return config.routes.slice(start + 1);
}

describe('static rehearsal SPA rewrite', () => {
  it('serves every client route on a direct load', async () => {
    const pattern = rewrite();
    const missing = (await routerPaths()).filter((route) => !pattern.test(route));
    expect(missing, `these routes would 404 on refresh: ${missing.join(', ')}`).toEqual([]);
  });

  it('still refuses paths the router does not claim', async () => {
    const pattern = rewrite();
    for (const route of ['/api', '/merchant', '/tools', '/nope', '/lab/extra']) {
      expect(pattern.test(route), `${route} should not fall through to the shell`).toBe(false);
    }
  });

  it('is built from the one client route list both deploy targets read', async () => {
    const declared = (await routerPaths()).sort();
    expect(
      [...CLIENT_ROUTES].map((route) => route.replace(/:[^/]+/g, 'example-id')).sort()
    ).toEqual(declared);
    for (const route of declared) expect(isClientRoute(route)).toBe(true);
    for (const route of ['/api', '/nope', '/lab/extra']) expect(isClientRoute(route)).toBe(false);
  });
});

// An address that is not a page is a 404, and the body should be this site's own
// 404 page rather than the platform's error template. Serving the shell from the
// error phase does both: the router renders its NotFound with the site header,
// navigation and a home link, under the status that says the page is not here.
describe('unmatched addresses', () => {
  it('answer with the app shell under a 404 status', () => {
    expect(errorRoutes().find((route) => route.src === '/.*')).toMatchObject({
      status: 404,
      dest: '/index.html',
    });
  });

  it('leave the 405 answer for mutating methods in place', () => {
    expect(errorRoutes().find((route) => route.src === '/.*')?.methods).toEqual(['GET', 'HEAD']);
    const method = config.routes.find((route) => route.status === 405);
    expect(method?.methods).toContain('POST');
    expect(config.routes.indexOf(method!)).toBeLessThan(
      config.routes.findIndex((route) => route.handle === 'error')
    );
  });

  it('are handled after the filesystem and after the client routes, never before', () => {
    const order = (match: (route: (typeof config.routes)[number]) => boolean) =>
      config.routes.findIndex(match);
    expect(order((route) => route.handle === 'filesystem')).toBeLessThan(
      order((route) => route.src === SPA_ROUTE)
    );
    expect(order((route) => route.src === SPA_ROUTE)).toBeLessThan(
      order((route) => route.handle === 'error')
    );
  });
});
