import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Photo } from '../src/models/Photo.js';
import { Setting } from '../src/models/Setting.js';
import { ADMIN, clearDb, createAdmin, seedService, signIn, startDb, stopDb } from './helpers.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(async () => {
  await clearDb();
  await createAdmin();
});

const ID = '507f1f77bcf86cd799439011';
const PROTECTED = [
  ['get', '/api/dashboard/stats'],
  ['get', '/api/activity'],
  ['get', '/api/contact'],
  ['get', `/api/contact/${ID}`],
  ['patch', `/api/contact/${ID}`],
  ['delete', `/api/contact/${ID}`],
  ['put', '/api/settings'],
  ['put', '/api/pages/home'],
  ['post', '/api/upload'],
  ['delete', '/api/uploads/gallery/1700000000000-0123456789abcdef.png'],
  ...['photos', 'services', 'testimonials'].flatMap((r) => [
    ['post', `/api/${r}`],
    ['patch', `/api/${r}/${ID}`],
    ['delete', `/api/${r}/${ID}`],
  ]),
];

describe('access control', () => {
  it.each(PROTECTED)('%s %s requires a signed-in admin', async (method, path) => {
    const res = await request(createApp())[method](path).send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('blocks state-changing admin requests without a valid CSRF token', async () => {
    const { agent } = await signIn();
    expect((await agent.put('/api/settings').send({ siteName: 'Hacked' })).status).toBe(403);
    expect((await agent.put('/api/settings').set('X-CSRF-Token', 'f'.repeat(64)).send({ siteName: 'Hacked' })).status).toBe(403);
    expect((await agent.delete(`/api/photos/${ID}`).set('X-CSRF-Token', 'short')).status).toBe(403);
    expect(await Setting.countDocuments()).toBe(0);
  });

  it('does not accept one session’s CSRF token on another session', async () => {
    const a = await signIn();
    const b = await signIn();
    expect((await b.agent.put('/api/settings').set('X-CSRF-Token', a.csrf).send({ siteName: 'X' })).status).toBe(403);
  });
});

describe('injection and payload handling', () => {
  it('rejects NoSQL operator injection in login', async () => {
    const agent = request.agent(createApp());
    const { body } = await agent.get('/api/auth/csrf');
    const res = await agent.post('/api/auth/login').set('X-CSRF-Token', body.data.csrfToken).send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects operator keys nested anywhere in a body', async () => {
    const { agent, csrf } = await signIn();
    const res = await agent.put('/api/pages/home').set('X-CSRF-Token', csrf).send({ content: { $where: 'sleep(1000)' } });
    expect(res.status).toBe(400);
    const dotted = await agent.put('/api/settings').set('X-CSRF-Token', csrf).send({ 'socials.0.url': 'x' });
    expect(dotted.status).toBe(400);
  });

  it('does not let query strings become query operators', async () => {
    const { agent, csrf } = await signIn();
    await seedService(agent, csrf);
    const res = await agent.get('/api/photos?category[$ne]=nothing');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1); // filter ignored, not turned into $ne
  });

  it('rejects malformed JSON and oversized bodies without leaking internals', async () => {
    const app = createApp();
    const bad = await request(app).post('/api/contact').set('Content-Type', 'application/json').send('{"name":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.stack).toBeUndefined();
    const big = await request(app).post('/api/contact').send({ name: 'x', email: 'a@b.co', message: 'x'.repeat(200_000) });
    expect(big.status).toBe(413);
  });

  it('stores text as plain strings (rendering escapes it), never altering markup into something executable', async () => {
    const { agent, csrf } = await signIn();
    const res = await agent.put('/api/settings').set('X-CSRF-Token', csrf).send({ footerText: '<img src=x onerror=alert(1)>' });
    expect(res.body.data.footerText).toBe('<img src=x onerror=alert(1)>');
    const site = await request(createApp()).get('/api/site');
    expect(site.headers['content-type']).toMatch(/application\/json/);
  });
});

describe('public / private separation', () => {
  it('the public site bundle exposes only public content', async () => {
    const { agent, csrf } = await signIn();
    await seedService(agent, csrf);
    await seedService(agent, csrf, { slug: 'hidden', title: 'Hidden service', visible: false });
    await agent.post('/api/testimonials').set('X-CSRF-Token', csrf).send({ quote: 'Shown', clientRole: 'A', showOnPage: true });
    await agent.post('/api/testimonials').set('X-CSRF-Token', csrf).send({ quote: 'Not shown', clientRole: 'B' });
    await request(createApp()).post('/api/contact').send({ name: 'Private Person', email: 'private@example.com', message: 'Hi' });

    const res = await request(createApp()).get('/api/site');
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(res.body.data.services.map((s) => s.slug)).toEqual(['events']);
    expect(res.body.data.testimonials.map((t) => t.quote)).toEqual(['Shown']);
    expect(text).not.toContain('private@example.com');
    expect(text).not.toContain(ADMIN.email);
    expect(text).not.toContain('passwordHash');
    expect(await Photo.countDocuments()).toBe(1);
  });

  it('sets security headers and restricts CORS to the configured frontend', async () => {
    const app = createApp();
    const ok = await request(app).get('/api/health').set('Origin', 'http://localhost:3000');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['x-powered-by']).toBeUndefined();
    expect(ok.headers['strict-transport-security']).toBeDefined();

    const evil = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('reports health without needing a session', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.database).toBe('connected');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('returns JSON 404 for unknown endpoints', async () => {
    const res = await request(createApp()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: { message: 'Endpoint not found' } });
  });
});
