import rateLimit from 'express-rate-limit';
import { AppError } from '../utils/http.js';

const limiter = (windowMs, limit, message, extra = {}) => () =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ success: false, error: { message } }),
    ...extra,
  });

export const apiLimiter = limiter(60 * 1000, 300, 'Too many requests. Please slow down.');
/** Counts failed sign-ins only, per IP. Per-account lockout is handled in the login controller. */
export const loginLimiter = limiter(15 * 60 * 1000, 10, 'Too many sign-in attempts. Try again in 15 minutes.', { skipSuccessfulRequests: true });
export const contactLimiter = limiter(10 * 60 * 1000, 5, 'Too many messages sent. Please try again later or call instead.');

/** Rejects request bodies containing MongoDB operator keys ($gt, $where...) or dotted paths anywhere. */
export function rejectOperatorKeys(req, _res, next) {
  const bad = (value, depth = 0) => {
    if (depth > 10) return true;
    if (Array.isArray(value)) return value.some((v) => bad(v, depth + 1));
    if (value && typeof value === 'object') {
      return Object.entries(value).some(([k, v]) => k.startsWith('$') || k.includes('.') || bad(v, depth + 1));
    }
    return false;
  };
  if (bad(req.body)) throw new AppError(400, 'Invalid request body');
  next();
}
