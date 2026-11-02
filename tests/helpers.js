import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Admin } from '../src/models/Admin.js';

// Tests only ever touch a throwaway in-memory database, never MONGODB_URI.
let mongod;

export async function startDb() {
  mongod = await MongoMemoryServer.create();
  await connectDB(mongod.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}

export async function stopDb() {
  await disconnectDB();
  await mongod?.stop();
}

export async function clearDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export const ADMIN = { email: 'owner@example.com', password: 'correct-horse-battery-staple' };

export async function createAdmin({ email, password } = ADMIN) {
  return Admin.create({ email, passwordHash: await bcrypt.hash(password, 4) });
}

/** Signed-in supertest agent plus its CSRF token. */
export async function signIn(app = createApp(), creds = ADMIN) {
  const agent = request.agent(app);
  const { body } = await agent.get('/api/auth/csrf');
  const res = await agent.post('/api/auth/login').set('X-CSRF-Token', body.data.csrfToken).send(creds);
  if (res.status !== 200) throw new Error(`Sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, csrf: res.body.data.csrfToken, app };
}

// Minimal real file headers for each allowed type (signature bytes plus padding).
export const IMAGES = {
  png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]),
  jpg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]),
  gif: Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(32)]),
  webp: Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'), Buffer.alloc(32)]),
};
export const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

export const upload = (agent, csrf, { folder = 'gallery', ext = 'png', buffer = IMAGES[ext], mime = MIME[ext], name = `photo.${ext}` } = {}) =>
  agent.post('/api/upload').set('X-CSRF-Token', csrf).field('folder', folder).attach('file', buffer, { filename: name, contentType: mime });

export async function seedService(agent, csrf, overrides = {}) {
  const { Photo } = await import('../src/models/Photo.js');
  await Photo.updateOne(
    { slug: 'cover' },
    { $setOnInsert: { slug: 'cover', title: 'Cover', alt: 'Cover photo', category: overrides.slug ?? 'events', width: 1600, height: 1000, src: '/images/work/cover-1600.webp' } },
    { upsert: true },
  );
  return agent
    .post('/api/services')
    .set('X-CSRF-Token', csrf)
    .send({ slug: 'events', title: 'Events', shortTitle: 'Events', categoryLabel: 'Events', inquiryValue: 'Events', summary: 'Event coverage', image: 'cover', ...overrides });
}
