import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * CSRF protection for a visitor who has not signed in, without a session row.
 * The token travels in an HttpOnly cookie signed with the session secret and
 * is echoed back in the x-csrf-token header (a signed double-submit cookie).
 * A signed-in operator keeps the session-bound token instead.
 */
export interface AnonymousCsrfOptions {
  secret: string;
  secure: boolean;
}
const TOKEN = /^[a-f0-9]{64}$/;
const COOKIE_MAX_AGE_MS = 60 * 60 * 1000;

export const anonymousCsrfCookieName = (secure: boolean): string =>
  secure ? '__Host-allowance-csrf' : 'allowance.csrf';

const sign = (secret: string, token: string): string =>
  createHmac('sha256', secret).update(token, 'utf8').digest('hex');

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** The token inside a cookie whose signature verifies under this secret; undefined otherwise. */
function tokenFromCookie(req: Request, options: AnonymousCsrfOptions): string | undefined {
  const value = readCookie(req, anonymousCsrfCookieName(options.secure));
  const [token, signature] = value?.split('.') ?? [];
  if (!token || !signature || !TOKEN.test(token) || !TOKEN.test(signature)) return undefined;
  const expected = Buffer.from(sign(options.secret, token), 'hex');
  const actual = Buffer.from(signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? token : undefined;
}

/** Reuses the browser's valid token so several tabs agree; issues and sets a new one otherwise. */
export function issueAnonymousCsrf(req: Request, res: Response, options: AnonymousCsrfOptions): string {
  const existing = tokenFromCookie(req, options);
  if (existing) return existing;
  const token = randomBytes(32).toString('hex');
  // A Secure cookie is only set on a connection the server knows to be secure, as express-session does.
  if (!options.secure || req.secure)
    res.cookie(anonymousCsrfCookieName(options.secure), `${token}.${sign(options.secret, token)}`, {
      httpOnly: true,
      sameSite: 'strict',
      secure: options.secure,
      path: '/',
      maxAge: COOKIE_MAX_AGE_MS,
    });
  return token;
}

export function verifyAnonymousCsrf(req: Request, presented: string, options: AnonymousCsrfOptions): boolean {
  const token = tokenFromCookie(req, options);
  if (!token || !TOKEN.test(presented) || presented.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(presented, 'utf8'), Buffer.from(token, 'utf8'));
}

export function clearAnonymousCsrf(res: Response, secure: boolean): void {
  res.clearCookie(anonymousCsrfCookieName(secure), { httpOnly: true, sameSite: 'strict', secure, path: '/' });
}
