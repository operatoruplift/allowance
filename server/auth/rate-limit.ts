import { rateLimit } from 'express-rate-limit';

/** Requests one address may make to /api per minute: generous for the console's two-second polling, tight for a flood. */
export const API_REQUESTS_PER_MINUTE = 300;
/** Sign-in requests one address may make per lockout window, in front of the durable per-address lockout. */
export const LOGIN_REQUESTS_PER_WINDOW = 20;
const MINUTE_MS = 60 * 1000;
const LOGIN_WINDOW_MS = 15 * MINUTE_MS;

const limited = (error: string) => ({ code: 'RATE_LIMITED', error });

export function apiRateLimiter(limit = API_REQUESTS_PER_MINUTE) {
  return rateLimit({
    windowMs: MINUTE_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: limited('Too many requests from this address. Retry shortly.'),
  });
}

export function loginRateLimiter(limit = LOGIN_REQUESTS_PER_WINDOW) {
  return rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: limited('Too many sign-in requests from this address. Try again later.'),
  });
}
