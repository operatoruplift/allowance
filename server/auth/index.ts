import { randomBytes, timingSafeEqual } from 'node:crypto';
import session from 'express-session';
import argon2 from 'argon2';
import type { Express, Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { authenticationConfigured, type Config } from '../config.js';
import { revokeSessionAgentGrants } from '../mcp/grants.js';
import { revokeSessionMandateGrants } from '../direct/grants.js';
import { clearAnonymousCsrf, issueAnonymousCsrf, verifyAnonymousCsrf } from './csrf.js';
declare module 'express-session' {
  interface SessionData {
    operator?: string;
    csrf?: string;
    issuedAt?: number;
  }
}
const SESSION_MS = 8 * 60 * 60 * 1000;
/** Failed sign-ins one address may make before that address is locked out for the window. */
export const LOGIN_ATTEMPTS_PER_ADDRESS = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const CSRF_TOKEN = /^[a-f0-9]{64}$/;
class SQLiteSessionStore extends session.Store {
  constructor(private db: Database.Database) {
    super();
  }
  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void) {
    try {
      const row = this.db.prepare('SELECT data,expires FROM sessions WHERE sid=?').get(sid) as
        { data: string; expires: number } | undefined;
      callback(null, row && row.expires > Date.now() ? JSON.parse(row.data) : null);
    } catch (error) {
      callback(error);
    }
  }
  set(sid: string, data: session.SessionData, callback?: (err?: unknown) => void) {
    try {
      const expires = data.cookie.expires
        ? new Date(data.cookie.expires).getTime()
        : Date.now() + SESSION_MS;
      this.db
        .prepare(
          'INSERT INTO sessions VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET expires=excluded.expires,data=excluded.data'
        )
        .run(sid, expires, JSON.stringify(data));
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }
  destroy(sid: string, callback?: (err?: unknown) => void) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);
      callback?.();
    } catch (error) {
      callback?.(error);
    }
  }
  touch(sid: string, data: session.SessionData, callback?: (err?: unknown) => void) {
    this.set(sid, data, callback);
  }
}
/**
 * Durable sign-in lockout per address. Counting happens under one immediate
 * transaction; a locked address is refused before the password is examined,
 * and a successful sign-in clears only that address's counter.
 */
function registerLoginAttempt(db: Database.Database, key: string, now: number): boolean {
  return db
    .transaction(() => {
      db.prepare('DELETE FROM login_attempts WHERE expires<=?').run(now);
      const row = db.prepare('SELECT count FROM login_attempts WHERE key=?').get(key) as
        { count: number } | undefined;
      if ((row?.count || 0) >= LOGIN_ATTEMPTS_PER_ADDRESS) return true;
      db.prepare(
        'INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1'
      ).run(key, now + LOGIN_LOCKOUT_MS);
      return false;
    })
    .immediate();
}
export function installAuth(
  app: Express,
  db: Database.Database,
  config: Config,
  onLogout: () => void = () => {}
) {
  const configured = authenticationConfigured(config);
  const secureCookies = new URL(config.origin).protocol === 'https:';
  const secret = config.sessionSecret || randomBytes(48).toString('hex');
  const anonymousCsrf = { secret, secure: secureCookies };
  app.use(
    session({
      name: secureCookies ? '__Host-allowance' : 'allowance.sid',
      secret,
      store: new SQLiteSessionStore(db),
      resave: false,
      saveUninitialized: false,
      rolling: false,
      cookie: {
        httpOnly: true,
        sameSite: 'strict',
        secure: secureCookies,
        maxAge: SESSION_MS,
        path: '/',
      },
    })
  );
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.session.issuedAt && Date.now() - req.session.issuedAt >= SESSION_MS) {
      req.session.destroy(() => res.status(401).json({ error: 'Session expired. Sign in again.' }));
      return;
    }
    next();
  });
  app.get('/api/session', (req, res) => {
    const signedIn = req.session.operator === 'operator';
    // Only a signed-in session is persisted. A visitor's token travels in a signed cookie instead,
    // so a cookie-less request never writes a row.
    const csrfToken = signedIn
      ? (req.session.csrf ||= randomBytes(32).toString('hex'))
      : issueAnonymousCsrf(req, res, anonymousCsrf);
    res.json({ authenticated: configured && signedIn, csrfToken, configured });
  });
  const matchesSession = (req: Request, token: string) =>
    Boolean(req.session.csrf) &&
    token.length === req.session.csrf!.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrf!));
  const csrf = (req: Request, res: Response, next: NextFunction) => {
    const token = req.get('x-csrf-token') || '';
    const valid =
      req.get('origin') === config.origin &&
      CSRF_TOKEN.test(token) &&
      (req.session.operator === 'operator'
        ? matchesSession(req, token)
        : verifyAnonymousCsrf(req, token, anonymousCsrf));
    if (!valid) {
      res.status(403).json({ error: 'Same-origin request and valid CSRF token required.' });
      return;
    }
    next();
  };
  app.use('/api', (req, res, next) =>
    ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : csrf(req, res, next)
  );
  app.post('/api/login', async (req, res, next) => {
    if (!configured) {
      res
        .status(503)
        .json({ error: 'Operator authentication is not configured. Run npm run setup:operator.' });
      return;
    }
    try {
      const key = `ip:${req.ip}`;
      if (registerLoginAttempt(db, key, Date.now())) {
        res.setHeader('Retry-After', String(LOGIN_LOCKOUT_MS / 1000));
        res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
        return;
      }
      const password = req.body?.password;
      if (
        typeof password !== 'string' ||
        password.length < 1 ||
        password.length > 256 ||
        !(await argon2.verify(config.passwordHash, password))
      ) {
        res.status(401).json({ error: 'Password not recognized.' });
        return;
      }
      db.prepare('DELETE FROM login_attempts WHERE key=?').run(key);
      req.session.regenerate((error) => {
        if (error) {
          next(error);
          return;
        }
        req.session.operator = 'operator';
        req.session.issuedAt = Date.now();
        req.session.csrf = randomBytes(32).toString('hex');
        clearAnonymousCsrf(res, secureCookies);
        req.session.save((saveError) => {
          if (saveError) next(saveError);
          else res.json({ authenticated: true, csrfToken: req.session.csrf, configured: true });
        });
      });
    } catch (error) {
      next(error);
    }
  });
  const requireOperator = (req: Request, res: Response, next: NextFunction) => {
    if (!configured || req.session.operator !== 'operator') {
      res.status(401).json({ error: 'Operator sign-in required.' });
      return;
    }
    next();
  };
  app.post('/api/logout', requireOperator, (req, res, next) => {
    revokeSessionAgentGrants(db, req.sessionID);
    revokeSessionMandateGrants(db, req.sessionID);
    onLogout();
    req.session.destroy((error) => {
      if (error) next(error);
      else {
        res.clearCookie(secureCookies ? '__Host-allowance' : 'allowance.sid', {
          path: '/',
          secure: secureCookies,
          sameSite: 'strict',
        });
        res.json({ ok: true });
      }
    });
  });
  return { requireOperator };
}
