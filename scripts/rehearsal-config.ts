// The deploy configuration for the static rehearsal, kept apart from the build
// that writes it so tests can assert on the real values rather than on a copy.

import { SPA_ROUTE } from '../shared/routes.js';

export { SPA_ROUTE };

// A rehearsal document never calls the network: the site is static and every
// route under /api, /merchant and /tools is refused. `connect-src 'none'` states
// that in the policy, so a script injected into a document cannot reach anywhere
// at all. The service worker is the one exception, because precaching the shell
// is a fetch from its own context, and a worker runs under the policy delivered
// with its script rather than the page's. That one response gets 'self' instead
// of relaxing every document to match it.
export const contentSecurityPolicy = (connectSrc: string): string =>
  [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'self'",
    `connect-src ${connectSrc}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

export const DOCUMENT_CONNECT_SRC = "'none'";
export const WORKER_CONNECT_SRC = "'self'";
export const WORKER_ROUTE = '/sw\\.js';

export const securityHeaders = {
  'Content-Security-Policy': contentSecurityPolicy(DOCUMENT_CONNECT_SRC),
  'X-Content-Type-Options': 'nosniff',
  // frame-ancestors above is the modern control; this covers older browsers
  // that ignore it, so the rehearsal can never be framed.
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** One entry of the Vercel build output v3 route table. */
export type RehearsalRoute = {
  src?: string;
  dest?: string;
  headers?: Record<string, string>;
  continue?: boolean;
  status?: number;
  methods?: string[];
  handle?: string;
};

export const config: { version: number; routes: RehearsalRoute[] } = {
  version: 3,
  routes: [
    { src: '/.*', headers: securityHeaders, continue: true },
    // Overrides the policy above for this one response; the worker precaches the
    // shell, which the document policy has no reason to allow.
    {
      src: WORKER_ROUTE,
      headers: { ...securityHeaders, 'Content-Security-Policy': contentSecurityPolicy(WORKER_CONNECT_SRC) },
      continue: true,
    },
    { src: '/(?:api|merchant|tools)(?:/.*)?', status: 404 },
    {
      src: '/.*',
      methods: ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT'],
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    },
    { handle: 'filesystem' },
    // Every client route the router serves, so a direct load or a refresh does
    // not 404.
    { src: SPA_ROUTE, dest: '/index.html' },
    // Anything else is not a page here. Serve the app shell so the router's own
    // 404 renders with the site header, navigation and a home link, and keep the
    // 404 status that says so. Restricted to document methods: a POST already
    // answered 405 above and keeps that status.
    { handle: 'error' },
    { src: '/.*', methods: ['GET', 'HEAD'], status: 404, dest: '/index.html' },
  ],
};
