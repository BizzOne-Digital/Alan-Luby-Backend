import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDB } from '../src/config/db.js';

let mongod;
let handler;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  // env.js reads process.env when first imported, so import the entry point after setting it.
  ({ default: handler } = await import('../api/index.js'));
});

afterAll(async () => {
  await disconnectDB();
  await mongod.stop();
});

describe('Vercel function entry point', () => {
  it('connects lazily and serves requests through the Express app', async () => {
    const res = await request(handler).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.database).toBe('connected');
  });

  it('reuses the app across invocations', async () => {
    const [a, b] = await Promise.all([request(handler).get('/api/site'), request(handler).get('/api/auth/csrf')]);
    expect(a.status).toBe(200);
    expect(b.body.data.csrfToken).toMatch(/^[a-f0-9]{64}$/);
  });
});
