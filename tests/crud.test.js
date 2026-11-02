import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ActivityLog } from '../src/models/ActivityLog.js';
import { Inquiry } from '../src/models/Inquiry.js';
import { Page } from '../src/models/Page.js';
import { Photo } from '../src/models/Photo.js';
import { clearDb, createAdmin, seedService, signIn, startDb, stopDb } from './helpers.js';

beforeAll(startDb);
afterAll(stopDb);

let agent;
let csrf;
beforeEach(async () => {
  await clearDb();
  await createAdmin();
  ({ agent, csrf } = await signIn());
});

const photo = (overrides = {}) => ({
  title: 'Dancer mid-routine',
  alt: 'A dancer performing',
  category: 'events',
  width: 2300,
  height: 1530,
  src: '/images/work/dancer-1600.webp',
  ...overrides,
});

describe('photos', () => {
  beforeEach(() => seedService(agent, csrf));

  it('creates, reads, updates and deletes a photo', async () => {
    const created = await agent.post('/api/photos').set('X-CSRF-Token', csrf).send(photo());
    expect(created.status).toBe(201);
    expect(created.body.data.slug).toMatch(/^dancer-mid-routine-[a-f0-9]{6}$/);
    const id = created.body.data._id;

    const read = await request(createApp()).get(`/api/photos/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.data.title).toBe('Dancer mid-routine');

    const updated = await agent.patch(`/api/photos/${id}`).set('X-CSRF-Token', csrf).send({ title: 'New title', featured: 2 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.title).toBe('New title');
    expect(updated.body.data.featured).toBe(2);

    const removed = await agent.delete(`/api/photos/${id}`).set('X-CSRF-Token', csrf);
    expect(removed.status).toBe(200);
    expect((await request(createApp()).get(`/api/photos/${id}`)).status).toBe(404);
    expect(await ActivityLog.countDocuments({ entity: 'Photo' })).toBe(3);
  });

  it('lists with pagination, search, filter and sort', async () => {
    for (let i = 0; i < 5; i++) await agent.post('/api/photos').set('X-CSRF-Token', csrf).send(photo({ title: `Photo ${i}`, order: 5 - i }));
    await agent.post('/api/photos').set('X-CSRF-Token', csrf).send(photo({ title: 'Sunset beach', order: 99, showInWork: false }));

    const page = await agent.get('/api/photos?limit=2&page=2&sort=order');
    expect(page.body.pagination).toMatchObject({ page: 2, limit: 2, total: 7 });
    expect(page.body.data).toHaveLength(2);

    const search = await agent.get('/api/photos?q=sunset');
    expect(search.body.data.map((p) => p.title)).toEqual(['Sunset beach']);

    const hidden = await agent.get('/api/photos?showInWork=false');
    expect(hidden.body.data.map((p) => p.title)).toEqual(['Sunset beach']);

    const sorted = await agent.get('/api/photos?sort=-order&limit=1');
    expect(sorted.body.data[0].title).toBe('Sunset beach');
  });

  it('treats regex characters in search literally', async () => {
    const res = await agent.get('/api/photos?q=.*');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('rejects invalid ids', async () => {
    expect((await agent.get('/api/photos/not-an-id')).status).toBe(400);
    expect((await agent.patch('/api/photos/123').set('X-CSRF-Token', csrf).send({ title: 'x' })).status).toBe(400);
    expect((await agent.delete('/api/photos/507f1f77bcf86cd799439011').set('X-CSRF-Token', csrf)).status).toBe(404);
  });

  it('rejects invalid data with field details', async () => {
    const res = await agent.post('/api/photos').set('X-CSRF-Token', csrf).send(photo({ title: '', width: -5, src: 'javascript:alert(1)' }));
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['title', 'width', 'src']));
  });

  it('rejects an unknown category', async () => {
    const res = await agent.post('/api/photos').set('X-CSRF-Token', csrf).send(photo({ category: 'nonexistent' }));
    expect(res.status).toBe(400);
  });

  it('ignores fields that are not part of the schema (mass assignment)', async () => {
    const res = await agent.post('/api/photos').set('X-CSRF-Token', csrf).send(photo({ slug: 'chosen-slug', createdAt: '2000-01-01', isAdmin: true }));
    expect(res.status).toBe(201);
    expect(res.body.data.slug).not.toBe('chosen-slug');
    expect(res.body.data.isAdmin).toBeUndefined();
    expect(new Date(res.body.data.createdAt).getFullYear()).toBeGreaterThan(2000);
  });

  it('refuses to delete a photo still used by a service or page', async () => {
    const cover = await Photo.findOne({ slug: 'cover' });
    const res = await agent.delete(`/api/photos/${cover._id}`).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/service "Events"/);

    const created = await agent.post('/api/photos').set('X-CSRF-Token', csrf).send(photo());
    await Page.create({ key: 'home', content: { heroPhoto: created.body.data.slug } });
    const blocked = await agent.delete(`/api/photos/${created.body.data._id}`).set('X-CSRF-Token', csrf);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/home page \(heroPhoto\)/);
  });
});

describe('services', () => {
  it('creates and lists services; hidden ones are admin-only', async () => {
    expect((await seedService(agent, csrf)).status).toBe(201);
    const hidden = await seedService(agent, csrf, { slug: 'sports', title: 'Sports', visible: false });
    expect(hidden.status).toBe(201);

    expect((await agent.get('/api/services')).body.data).toHaveLength(2);
    const publicList = await request(createApp()).get('/api/services');
    expect(publicList.body.data.map((s) => s.slug)).toEqual(['events']);
    expect((await request(createApp()).get(`/api/services/${hidden.body.data._id}`)).status).toBe(404);
  });

  it('rejects duplicate slugs and invalid slugs', async () => {
    await seedService(agent, csrf);
    expect((await seedService(agent, csrf)).status).toBe(409);
    expect((await seedService(agent, csrf, { slug: 'Bad Slug!' })).status).toBe(400);
  });

  it('does not allow the slug to change (photos depend on it)', async () => {
    const { body } = await seedService(agent, csrf);
    const res = await agent.patch(`/api/services/${body.data._id}`).set('X-CSRF-Token', csrf).send({ slug: 'renamed', title: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe('events');
    expect(res.body.data.title).toBe('Renamed');
  });

  it('rejects references to photos or testimonials that do not exist', async () => {
    expect((await seedService(agent, csrf, { image: 'missing-photo' })).status).toBe(400);
    expect((await seedService(agent, csrf, { testimonial: '507f1f77bcf86cd799439011' })).status).toBe(400);
  });

  it('refuses to delete a service that still has photos', async () => {
    const { body } = await seedService(agent, csrf);
    const res = await agent.delete(`/api/services/${body.data._id}`).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(409);
    await Photo.deleteMany({});
    expect((await agent.delete(`/api/services/${body.data._id}`).set('X-CSRF-Token', csrf)).status).toBe(200);
  });
});

describe('testimonials', () => {
  const quote = { quote: 'The photos are great. We loved every one. Thank you!', clientRole: 'A client' };

  it('requires excerpts to be verbatim fragments of the quote', async () => {
    const ok = await agent.post('/api/testimonials').set('X-CSRF-Token', csrf).send({ ...quote, excerpt: 'The photos are great. … Thank you!' });
    expect(ok.status).toBe(201);
    const bad = await agent.post('/api/testimonials').set('X-CSRF-Token', csrf).send({ ...quote, excerpt: 'Best photographer ever!' });
    expect(bad.status).toBe(400);
    const badUpdate = await agent.patch(`/api/testimonials/${ok.body.data._id}`).set('X-CSRF-Token', csrf).send({ quote: 'Something else entirely.' });
    expect(badUpdate.status).toBe(400);
  });

  it('only exposes displayed testimonials publicly', async () => {
    await agent.post('/api/testimonials').set('X-CSRF-Token', csrf).send({ ...quote, showOnPage: true });
    await agent.post('/api/testimonials').set('X-CSRF-Token', csrf).send({ ...quote, clientRole: 'Hidden' });
    const res = await request(createApp()).get('/api/testimonials');
    expect(res.body.data.map((t) => t.clientRole)).toEqual(['A client']);
  });

  it('refuses to delete a testimonial attached to a service', async () => {
    const t = await agent.post('/api/testimonials').set('X-CSRF-Token', csrf).send(quote);
    await seedService(agent, csrf, { testimonial: t.body.data._id });
    expect((await agent.delete(`/api/testimonials/${t.body.data._id}`).set('X-CSRF-Token', csrf)).status).toBe(409);
  });
});

describe('pages', () => {
  it('saves content, SEO and homepage section order', async () => {
    const res = await agent
      .put('/api/pages/home')
      .set('X-CSRF-Token', csrf)
      .send({ seoDescription: 'Desc', content: { heroHeading: 'Hello' }, sections: [{ key: 'clients', visible: true }, { key: 'story', visible: false }] });
    expect(res.status).toBe(200);
    expect(res.body.data.content.heroHeading).toBe('Hello');
    expect(res.body.data.sections[0].key).toBe('clients');
    expect((await request(createApp()).get('/api/pages/home')).body.data.content.heroHeading).toBe('Hello');
  });

  it('hides unpublished pages from the public', async () => {
    await agent.put('/api/pages/testimonials').set('X-CSRF-Token', csrf).send({ published: false, content: { heading: 'Secret draft' } });
    expect((await request(createApp()).get('/api/pages/testimonials')).status).toBe(404);
    expect((await agent.get('/api/pages/testimonials')).status).toBe(200);
    const site = await request(createApp()).get('/api/site');
    expect(site.body.data.pages.testimonials).toEqual({ key: 'testimonials', published: false });
  });

  it('enforces page rules', async () => {
    expect((await agent.put('/api/pages/home').set('X-CSRF-Token', csrf).send({ published: false })).status).toBe(400);
    expect((await agent.put('/api/pages/about').set('X-CSRF-Token', csrf).send({ sections: [] })).status).toBe(400);
    expect((await agent.put('/api/pages/unknown').set('X-CSRF-Token', csrf).send({})).status).toBe(404);
    expect((await agent.put('/api/pages/home').set('X-CSRF-Token', csrf).send({ content: { 'bad key!': 'x' } })).status).toBe(400);
    expect((await agent.put('/api/pages/home').set('X-CSRF-Token', csrf).send({ sections: [{ key: 'story', visible: true }, { key: 'story', visible: true }] })).status).toBe(400);
  });
});

describe('settings', () => {
  it('updates settings and rejects unsafe links', async () => {
    const ok = await agent
      .put('/api/settings')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'Hello@Example.com', socials: [{ label: 'Instagram', url: 'https://instagram.com/x', icon: 'instagram' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.data.email).toBe('hello@example.com');
    expect((await request(createApp()).get('/api/settings')).body.data.socials).toHaveLength(1);

    const bad = await agent.put('/api/settings').set('X-CSRF-Token', csrf).send({ socials: [{ label: 'x', url: 'javascript:alert(1)', icon: 'website' }] });
    expect(bad.status).toBe(400);
  });
});

describe('contact inquiries', () => {
  const inquiry = { name: 'Jane', email: 'jane@example.com', message: 'Wedding in June', service: 'Weddings & engagements', date: '2027-06-12' };

  it('stores a public submission and lets the admin manage it', async () => {
    const sent = await request(createApp()).post('/api/contact').send(inquiry);
    expect(sent.status).toBe(201);
    expect(sent.body).toEqual({ success: true });

    const list = await agent.get('/api/contact?read=false');
    expect(list.body.data).toHaveLength(1);
    const id = list.body.data[0]._id;

    const marked = await agent.patch(`/api/contact/${id}`).set('X-CSRF-Token', csrf).send({ read: true, message: 'tampered' });
    expect(marked.body.data.read).toBe(true);
    expect(marked.body.data.message).toBe('Wedding in June');
    expect((await agent.get('/api/contact?read=false')).body.data).toHaveLength(0);
    expect((await agent.get('/api/contact?q=june')).body.data).toHaveLength(1);

    expect((await agent.delete(`/api/contact/${id}`).set('X-CSRF-Token', csrf)).status).toBe(200);
    expect(await Inquiry.countDocuments()).toBe(0);
  });

  it('validates submissions', async () => {
    const res = await request(createApp()).post('/api/contact').send({ name: '', email: 'not-an-email', message: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toEqual(expect.arrayContaining(['name', 'email', 'message']));
  });

  it('silently drops honeypot submissions', async () => {
    const res = await request(createApp()).post('/api/contact').send({ ...inquiry, website: 'http://spam.example' });
    expect(res.status).toBe(201);
    expect(await Inquiry.countDocuments()).toBe(0);
  });

  it('rate limits the contact form', async () => {
    const app = createApp();
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await request(app).post('/api/contact').send(inquiry)).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });
});

describe('dashboard', () => {
  it('reports real counts', async () => {
    await seedService(agent, csrf);
    await request(createApp()).post('/api/contact').send({ name: 'A', email: 'a@example.com', message: 'Hi' });
    const res = await agent.get('/api/dashboard/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.photos.total).toBe(1);
    expect(res.body.data.services.total).toBe(1);
    expect(res.body.data.inquiries).toMatchObject({ total: 1, unread: 1, last30Days: 1 });
    expect(res.body.data.recentActivity.length).toBeGreaterThan(0);
    expect(res.body.data.recentActivity[0].ip).toBeUndefined();

    const activity = await agent.get('/api/activity?q=signed');
    expect(activity.body.data[0].action).toBe('auth.login');
  });
});
