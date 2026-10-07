import { describe, expect, it } from 'vitest';
import { config, contentSecurityPolicy, SPA_ROUTE } from '../scripts/rehearsal-config';
import { LEGAL_ROUTES } from '../shared/routes';

// A rehearsal document never calls the network, and `connect-src 'none'` is what
// makes that checkable from outside rather than a claim in the README. The
// service worker is the single exception: precaching runs in its own context,
// under the policy delivered with its script. Adding the worker must not become
// a reason to relax every document to match it.

const headerRoutes = config.routes.filter((route) => route.headers?.['Content-Security-Policy']);

const connectSrc = (src: string): string => {
  const policy = headerRoutes.find((route) => route.src === src)?.headers?.['Content-Security-Policy'];
  expect(policy, `no header route matches ${src}`).toBeDefined();
  return /connect-src ([^;]*)/.exec(policy!)![1];
};

describe('static rehearsal content security policy', () => {
  it('forbids every network call from a document', () => {
    expect(connectSrc('/.*')).toBe("'none'");
  });

  it('grants the service worker same-origin fetches and nothing wider', () => {
    expect(connectSrc('/sw\\.js')).toBe("'self'");
  });

  it('applies the worker override after the document policy so it wins', () => {
    const document = headerRoutes.findIndex((route) => route.src === '/.*');
    const worker = headerRoutes.findIndex((route) => route.src === '/sw\\.js');
    expect(worker).toBeGreaterThan(document);
  });

  it('never names an external origin or a wildcard in any policy', () => {
    for (const source of ["'none'", "'self'"]) {
      const policy = contentSecurityPolicy(source);
      expect(policy).not.toMatch(/https?:\/\//);
      expect(policy).not.toMatch(/\*/);
    }
  });
});

/**
 * The headers a GET for this path would carry, read from the route table the way
 * the platform applies it: every matching route before the filesystem phase adds
 * its headers in order, a later match overriding an earlier one, until a route
 * without `continue` ends the phase.
 */
function documentHeaders(pathname: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const route of config.routes) {
    if (route.handle === 'filesystem') break;
    if (route.methods && !route.methods.includes('GET')) continue;
    if (!route.src || !new RegExp(`^${route.src}$`).test(pathname)) continue;
    expect(route.status, `${pathname} is answered with ${route.status}`).toBeUndefined();
    Object.assign(headers, route.headers);
    if (!route.continue) break;
  }
  return headers;
}

// Store listings link straight to these two documents, so a reviewer's first load
// arrives without the app ever having run. They need nothing from the network to
// render, which is why they get the same policy as every other document.
describe('the legal pages on the static rehearsal', () => {
  const paths = LEGAL_ROUTES.flatMap((route) => [route, `${route}/`]);

  it.each(paths)('serves %s as a page, not the 404 shell', (path) => {
    expect(new RegExp(`^${SPA_ROUTE}$`).test(path)).toBe(true);
  });

  it.each(paths)('keeps connect-src none on %s', (path) => {
    const policy = documentHeaders(path)['Content-Security-Policy'];
    expect(policy).toBe(contentSecurityPolicy("'none'"));
    expect(/connect-src ([^;]*)/.exec(policy)![1]).toBe("'none'");
  });
});
