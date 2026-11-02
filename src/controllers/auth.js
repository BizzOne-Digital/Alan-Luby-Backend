import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { SESSION_COOKIE, cookieOptions } from '../config/session.js';
import { issueCsrf } from '../middleware/auth.js';
import { Admin } from '../models/Admin.js';
import { logActivity } from '../services/activity.js';
import { AppError } from '../utils/http.js';
import { loginSchema } from '../validators/schemas.js';

export const BCRYPT_ROUNDS = env.isTest ? 4 : 12;
const LOCK_AFTER = 5;
/** 15 minutes after the 5th failure, doubling with each further failure, capped at 24 hours. */
const lockMs = (failures) => Math.min(15 * 60_000 * 2 ** (failures - LOCK_AFTER), 24 * 60 * 60_000);
// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', BCRYPT_ROUNDS);

const promisify = (fn) => new Promise((resolve, reject) => fn((err) => (err ? reject(err) : resolve())));

export function csrf(req, res) {
  res.json({ success: true, data: { csrfToken: issueCsrf(req) } });
}

export async function login(req, res) {
  const { email, password } = loginSchema.parse(req.body);
  const admin = await Admin.findOne({ email }).select('+passwordHash +failedLogins +lockUntil');

  if (admin?.lockUntil && admin.lockUntil > Date.now()) {
    const minutes = Math.ceil((admin.lockUntil - Date.now()) / 60_000);
    throw new AppError(423, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  const valid = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);
  if (!admin || !valid) {
    if (admin) {
      admin.failedLogins += 1;
      if (admin.failedLogins >= LOCK_AFTER) admin.lockUntil = new Date(Date.now() + lockMs(admin.failedLogins));
      await admin.save();
      await logActivity(req, 'auth.login_failed', { admin, entity: 'admin', entityId: admin._id, summary: `Failed sign-in (${admin.failedLogins} in a row)` });
    }
    throw new AppError(401, 'Invalid email or password');
  }

  admin.failedLogins = 0;
  admin.lockUntil = null;
  admin.lastLoginAt = new Date();
  await admin.save();

  // New session id on sign-in prevents session fixation.
  await promisify((cb) => req.session.regenerate(cb));
  req.session.adminId = String(admin._id);
  req.session.loginAt = Date.now();
  const csrfToken = issueCsrf(req);
  await promisify((cb) => req.session.save(cb));

  await logActivity(req, 'auth.login', { admin, entity: 'admin', entityId: admin._id, summary: 'Signed in' });
  res.json({ success: true, data: { admin, csrfToken } });
}

export async function logout(req, res) {
  if (req.admin) await logActivity(req, 'auth.logout', { entity: 'admin', entityId: req.admin._id, summary: 'Signed out' });
  await promisify((cb) => req.session.destroy(cb));
  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.json({ success: true });
}

export function me(req, res) {
  res.json({ success: true, data: { admin: req.admin, csrfToken: issueCsrf(req) } });
}
