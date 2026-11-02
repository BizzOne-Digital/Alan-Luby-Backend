import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { StoredUpload } from '../src/models/StoredUpload.js';
import { deleteManagedUpload, parseManagedUrl } from '../src/services/uploads.js';
import { IMAGES, clearDb, createAdmin, seedService, signIn, startDb, stopDb, upload } from './helpers.js';

beforeAll(startDb);
afterAll(stopDb);

let agent;
let csrf;
beforeEach(async () => {
  await clearDb();
  await createAdmin();
  ({ agent, csrf } = await signIn());
});

describe('POST /api/upload', () => {
  it.each(['png', 'jpg', 'webp', 'gif'])('stores a valid %s in MongoDB', async (ext) => {
    const res = await upload(agent, csrf, { ext });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, folder: 'gallery', size: IMAGES[ext].length });
    expect(res.body.filename).toMatch(new RegExp(`^\\d{13}-[a-f0-9]{16}\\.${ext}$`));
    expect(res.body.url).toBe(`/api/uploads/gallery/${res.body.filename}`);
    const stored = await StoredUpload.findOne({ filename: res.body.filename });
    expect(Buffer.compare(stored.data, IMAGES[ext])).toBe(0);
  });

  it('accepts .jpeg files and saves them as .jpg', async () => {
    const res = await upload(agent, csrf, { ext: 'jpg', name: 'photo.jpeg' });
    expect(res.status).toBe(201);
    expect(res.body.filename.endsWith('.jpg')).toBe(true);
  });

  it('rejects disallowed MIME types', async () => {
    const res = await upload(agent, csrf, { buffer: Buffer.from('<svg onload="alert(1)"/>'), mime: 'image/svg+xml', name: 'x.svg' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Only PNG, JPEG, WebP and GIF/);
  });

  it('rejects content whose signature does not match the stated type', async () => {
    const res = await upload(agent, csrf, { buffer: Buffer.from('#!/bin/sh\necho not an image, honestly'), mime: 'image/png', name: 'x.png' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a valid image/);
    const disguised = await upload(agent, csrf, { buffer: IMAGES.gif, mime: 'image/png', name: 'x.png' });
    expect(disguised.status).toBe(400);
  });

  it('rejects a mismatched extension', async () => {
    const res = await upload(agent, csrf, { ext: 'png', name: 'x.html' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/extension/);
  });

  it('rejects files larger than 8MB', async () => {
    const big = Buffer.concat([IMAGES.png, Buffer.alloc(8 * 1024 * 1024)]);
    const res = await upload(agent, csrf, { buffer: big });
    expect(res.status).toBe(413);
    expect(await StoredUpload.countDocuments()).toBe(0);
  });

  it('rejects invalid folders', async () => {
    for (const folder of ['products', '../etc', 'gallery/../misc', '']) {
      const res = await upload(agent, csrf, { folder });
      expect(res.status).toBe(400);
    }
  });

  it('rejects a request without a file', async () => {
    const res = await agent.post('/api/upload').set('X-CSRF-Token', csrf).field('folder', 'gallery');
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated uploads', async () => {
    const res = await request(createApp()).post('/api/upload').field('folder', 'gallery').attach('file', IMAGES.png, 'x.png');
    expect(res.status).toBe(401);
    expect(await StoredUpload.countDocuments()).toBe(0);
  });

  it('rejects uploads without the CSRF token', async () => {
    const res = await agent.post('/api/upload').field('folder', 'gallery').attach('file', IMAGES.png, 'x.png');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/uploads/:folder/:filename', () => {
  it('serves the image with correct headers', async () => {
    const { body } = await upload(agent, csrf, { ext: 'webp' });
    const res = await request(createApp()).get(body.url).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['content-length']).toBe(String(IMAGES.webp.length));
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(res.body, IMAGES.webp)).toBe(0);
  });

  it('returns 404 for a missing image', async () => {
    const res = await request(createApp()).get('/api/uploads/gallery/1700000000000-0123456789abcdef.png');
    expect(res.status).toBe(404);
  });

  it('rejects invalid folders and path traversal', async () => {
    const app = createApp();
    for (const path of [
      '/api/uploads/products/1700000000000-0123456789abcdef.png',
      '/api/uploads/gallery/..%2F..%2Fetc%2Fpasswd',
      '/api/uploads/gallery/%2e%2e%2fsecret.png',
      '/api/uploads/gallery/..%5Csecret.png',
      '/api/uploads/gallery/photo.png',
    ]) {
      const res = await request(app).get(path);
      expect([400, 404]).toContain(res.status);
      expect(res.headers['content-type']).toMatch(/json/);
    }
    expect((await request(app).get('/api/uploads/gallery/..%2F..%2Fetc%2Fpasswd')).status).toBe(400);
  });
});

describe('image deletion', () => {
  it('lets the admin delete an unused upload', async () => {
    const { body } = await upload(agent, csrf);
    const res = await agent.delete(body.url).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect((await request(createApp()).get(body.url)).status).toBe(404);
  });

  it('refuses unauthenticated deletion', async () => {
    const { body } = await upload(agent, csrf);
    expect((await request(createApp()).delete(body.url)).status).toBe(401);
    expect(await StoredUpload.countDocuments()).toBe(1);
  });

  it('refuses to delete an upload still used by a photo', async () => {
    const { body } = await upload(agent, csrf);
    await seedService(agent, csrf);
    await agent.post('/api/photos').set('X-CSRF-Token', csrf).send({ title: 'T', alt: 'A', category: 'events', width: 10, height: 10, src: body.url });
    expect((await agent.delete(body.url).set('X-CSRF-Token', csrf)).status).toBe(409);
  });

  it('deletes the old upload when a photo image is replaced, and on photo deletion', async () => {
    await seedService(agent, csrf);
    const first = (await upload(agent, csrf)).body.url;
    const second = (await upload(agent, csrf)).body.url;
    const created = await agent.post('/api/photos').set('X-CSRF-Token', csrf).send({ title: 'T', alt: 'A', category: 'events', width: 10, height: 10, src: first });
    await agent.patch(`/api/photos/${created.body.data._id}`).set('X-CSRF-Token', csrf).send({ src: second });
    expect(await StoredUpload.exists(parseManagedUrl(first))).toBeNull();
    expect(await StoredUpload.exists(parseManagedUrl(second))).not.toBeNull();

    await agent.delete(`/api/photos/${created.body.data._id}`).set('X-CSRF-Token', csrf);
    expect(await StoredUpload.countDocuments()).toBe(0);
  });

  it('deletes uploads removed from page content, but keeps ones still used elsewhere', async () => {
    const portrait = (await upload(agent, csrf, { folder: 'pages' })).body.url;
    await agent.put('/api/pages/about').set('X-CSRF-Token', csrf).send({ content: { portrait } });
    await agent.put('/api/pages/home').set('X-CSRF-Token', csrf).send({ content: { extra: portrait } });
    await agent.put('/api/pages/about').set('X-CSRF-Token', csrf).send({ content: { portrait: '/alan/AlanLuby.jpg' } });
    expect(await StoredUpload.countDocuments()).toBe(1);
    await agent.put('/api/pages/home').set('X-CSRF-Token', csrf).send({ content: {} });
    expect(await StoredUpload.countDocuments()).toBe(0);
  });

  it('never deletes anything outside the managed upload system', async () => {
    expect(await deleteManagedUpload('/images/work/dsc-1563-1600.webp')).toBe(false);
    expect(await deleteManagedUpload('https://example.com/api/uploads/gallery/1700000000000-0123456789abcdef.png')).toBe(false);
    expect(await deleteManagedUpload('/api/uploads/gallery/../../x.png')).toBe(false);
    expect(parseManagedUrl('/uploads/gallery/legacy.png')).toBeNull();
  });
});
