import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ActivityLog } from '../src/models/ActivityLog.js';
import { Admin } from '../src/models/Admin.js';
import { ADMIN, clearDb, createAdmin, signIn, startDb, stopDb } from './helpers.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await clearDb();
  await createAdmin();
});

async function attempt(agent, creds) {
  const { body } = await agent.get('/api/auth/csrf');
  return agent.post('/api/auth/login').set('X-CSRF-Token', body.data.csrfToken).send(creds);
}

describe('login', () => {
  it('signs in with the right credentials and sets an HTTP-only session cookie', async () => {
    const agent = request.agent(createApp());
    const res = await attempt(agent, ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data.admin.email).toBe(ADMIN.email);
    expect(res.body.data.admin.passwordHash).toBeUndefined();
    expect(res.body.data.csrfToken).toMatch(/^[a-f0-9]{64}$/);
    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/alp\.sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(await ActivityLog.countDocuments({ action: 'auth.login' })).toBe(1);
  });

  it('accepts the email in any letter case', async () => {
    const res = await attempt(request.agent(createApp()), { ...ADMIN, email: ADMIN.email.toUpperCase() });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong password with a generic message', async () => {
    const res = await attempt(request.agent(createApp()), { ...ADMIN, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('gives an unknown email the same response as a wrong password', async () => {
    const res = await attempt(request.agent(createApp()), { email: 'nobody@example.com', password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('rejects missing credentials', async () => {
    const agent = request.agent(createApp());
    expect((await attempt(agent, {})).status).toBe(400);
    expect((await attempt(agent, { email: ADMIN.email })).status).toBe(400);
  });

  it('requires a CSRF token', async () => {
    const res = await request(createApp()).post('/api/auth/login').send(ADMIN);
    expect(res.status).toBe(403);
  });

  it('issues a new session id on sign-in (no session fixation)', async () => {
    const agent = request.agent(createApp());
    const pre = await agent.get('/api/auth/csrf');
    const before = pre.headers['set-cookie'][0].split(';')[0];
    const res = await agent.post('/api/auth/login').set('X-CSRF-Token', pre.body.data.csrfToken).send(ADMIN);
    const after = res.headers['set-cookie'][0].split(';')[0];
    expect(after).not.toBe(before);
    expect(res.body.data.csrfToken).not.toBe(pre.body.data.csrfToken);
  });

  it('locks the account after 5 failed attempts, even with the right password', async () => {
    const agent = request.agent(createApp());
    for (let i = 0; i < 5; i++) expect((await attempt(agent, { ...ADMIN, password: 'nope' })).status).toBe(401);
    const locked = await attempt(agent, ADMIN);
    expect(locked.status).toBe(423);
    expect(locked.body.error.message).toMatch(/Try again in 15 minutes/);
    const admin = await Admin.findOne({ email: ADMIN.email }).select('+lockUntil +failedLogins');
    expect(admin.failedLogins).toBe(5);
    expect(admin.lockUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it('resets the failure count after a successful sign-in', async () => {
    const agent = request.agent(createApp());
    for (let i = 0; i < 3; i++) await attempt(agent, { ...ADMIN, password: 'nope' });
    expect((await attempt(agent, ADMIN)).status).toBe(200);
    const admin = await Admin.findOne({ email: ADMIN.email }).select('+failedLogins');
    expect(admin.failedLogins).toBe(0);
  });

  it('rate limits repeated failed sign-ins from one IP', async () => {
    const agent = request.agent(createApp());
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await attempt(agent, { email: `x${i}@example.com`, password: 'nope' })).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('session', () => {
  it('rejects /me without a session', async () => {
    const res = await request(createApp()).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the admin for a valid session', async () => {
    const { agent } = await signIn();
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.admin.email).toBe(ADMIN.email);
  });

  it('rejects a forged session cookie', async () => {
    const res = await request(createApp()).get('/api/auth/me').set('Cookie', 'alp.sid=s%3Aforged.signature');
    expect(res.status).toBe(401);
  });

  it('ends the session when the admin account is removed', async () => {
    const { agent } = await signIn();
    await Admin.deleteMany({});
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('logs out and invalidates the session', async () => {
    const { agent, csrf } = await signIn();
    const res = await agent.post('/api/auth/logout').set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect(await ActivityLog.countDocuments({ action: 'auth.logout' })).toBe(1);
  });

  it('refuses logout without the CSRF token', async () => {
    const { agent } = await signIn();
    expect((await agent.post('/api/auth/logout')).status).toBe(403);
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  it('never stores the password or session id in the activity log', async () => {
    await signIn();
    const logs = JSON.stringify(await ActivityLog.find().lean());
    expect(logs).not.toContain(ADMIN.password);
    expect(logs).not.toContain('alp.sid');
  });
});
