import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Admin } from '../models/Admin.js';
import { AppError, OBJECT_ID } from '../utils/http.js';

/** Hard cap on a login session, even if it keeps being renewed by activity. */
export const ABSOLUTE_SESSION_MS = 24 * 60 * 60 * 1000;

/** Resolves the signed-in admin from the server-side session (never from anything the client sends). */
export async function loadAdmin(req, _res, next) {
  const id = req.session?.adminId;
  if (!id) return next();
  const expired = !req.session.loginAt || Date.now() - req.session.loginAt > ABSOLUTE_SESSION_MS;
  const admin = !expired && OBJECT_ID.test(id) ? await Admin.findById(id) : null;
  if (admin) req.admin = admin;
  else await new Promise((resolve) => req.session.destroy(resolve));
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.admin) throw new AppError(401, 'Please sign in to continue');
  next();
}

export const issueCsrf = (req) => (req.session.csrf ??= randomBytes(32).toString('hex'));

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Synchronizer token: state-changing requests must echo the session's token in X-CSRF-Token. */
export function requireCsrf(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const sent = Buffer.from(String(req.get('x-csrf-token') || ''));
  const expected = Buffer.from(String(req.session?.csrf || ''));
  if (!expected.length || sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
    throw new AppError(403, 'Invalid or missing security token. Refresh the page and try again.');
  }
  next();
}
