// The one list of client routes the app serves. Both deploy targets read it:
// the static rehearsal builds its SPA rewrite from it, and the Node server uses
// it to decide whether a document is a page (200) or the in-app 404 (404).
// Keeping it in one place is what stops the two from disagreeing, which is how a
// real route ends up served by the platform's own error page instead of ours.

/** Every concrete client route the router serves, `/runs/:id` written as a pattern. */
export const CLIENT_ROUTES = [
  '/',
  '/demo',
  '/lab',
  '/developers',
  '/brand',
  '/login',
  '/app',
  '/runs/:id',
] as const;

/** `/runs/:id` becomes `runs/[^/]+`; the leading slash and trailing `/?` are added once. */
const branch = (route: string): string => route.slice(1).replace(/:[^/]+/g, '[^/]+');

/**
 * The SPA rewrite pattern, written the way Vercel anchors a route `src`.
 * Every client route, with or without a trailing slash, and nothing else.
 */
export const SPA_ROUTE = `/(?:${CLIENT_ROUTES.filter((route) => route !== '/')
  .map(branch)
  .join('|')})?/?`;

const pattern = new RegExp(`^${SPA_ROUTE}$`);

/** True when the router renders a page for this path, rather than its 404. */
export function isClientRoute(pathname: string): boolean {
  return pattern.test(pathname);
}
