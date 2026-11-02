import session from 'express-session';
import { MongoStore } from 'connect-mongo';
import { env } from './env.js';

export const SESSION_COOKIE = 'alp.sid';
/** Idle timeout; every request renews it (rolling). The absolute cap is enforced in middleware/auth.js. */
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;

export const cookieOptions = () => ({
  httpOnly: true,
  secure: env.isProd,
  sameSite: env.cookieSameSite,
  path: '/',
});

export function sessionMiddleware(client) {
  return session({
    name: SESSION_COOKIE,
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    unset: 'destroy',
    cookie: { ...cookieOptions(), maxAge: SESSION_IDLE_MS },
    store: MongoStore.create({ client, collectionName: 'sessions', ttl: SESSION_IDLE_MS / 1000, stringify: false }),
  });
}
