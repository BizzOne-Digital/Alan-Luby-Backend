const NODE_ENV = process.env.NODE_ENV || 'development';

export const env = {
  nodeEnv: NODE_ENV,
  isProd: NODE_ENV === 'production',
  isTest: NODE_ENV === 'test',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI,
  sessionSecret: process.env.SESSION_SECRET,
  /** Comma-separated list of origins allowed to call the API with cookies. */
  frontendUrls: (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
  /** 'lax' when the frontend proxies /api (same site); 'none' when the API is on another site. */
  cookieSameSite: (process.env.COOKIE_SAMESITE || 'lax').toLowerCase(),
  /** Number of proxies in front of the app (Render, Railway, Vercel rewrite...). */
  trustProxy: process.env.TRUST_PROXY === undefined ? 1 : Number(process.env.TRUST_PROXY),
};

export function assertEnv() {
  const problems = [];
  if (!env.mongoUri) problems.push('MONGODB_URI is required');
  if (!env.sessionSecret || env.sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');
  if (!['lax', 'strict', 'none'].includes(env.cookieSameSite)) problems.push('COOKIE_SAMESITE must be lax, strict or none');
  if (env.cookieSameSite === 'none' && !env.isProd) problems.push('COOKIE_SAMESITE=none requires NODE_ENV=production (secure cookies)');
  if (problems.length) throw new Error(`Invalid environment:\n- ${problems.join('\n- ')}`);
}
