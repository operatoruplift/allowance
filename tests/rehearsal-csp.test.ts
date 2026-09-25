import { describe, expect, it } from 'vitest';
import { config, contentSecurityPolicy } from '../scripts/rehearsal-config';

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
