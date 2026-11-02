import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../scripts/seed.js';
import { createApp } from '../src/app.js';
import { Admin } from '../src/models/Admin.js';
import { Page } from '../src/models/Page.js';
import { Photo } from '../src/models/Photo.js';
import { Service } from '../src/models/Service.js';
import { Setting } from '../src/models/Setting.js';
import { Testimonial } from '../src/models/Testimonial.js';
import { clearDb, startDb, stopDb } from './helpers.js';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(clearDb);

const creds = { adminEmail: 'Owner@Example.com', adminPassword: 'a-long-enough-password', log: () => {} };

describe('seed script', () => {
  it('creates the admin and the starting content', async () => {
    await seed(creds);
    const admin = await Admin.findOne({ email: 'owner@example.com' }).select('+passwordHash');
    expect(await bcrypt.compare('a-long-enough-password', admin.passwordHash)).toBe(true);
    expect(await Photo.countDocuments()).toBe(61);
    expect(await Service.countDocuments()).toBe(5);
    expect(await Testimonial.countDocuments()).toBe(21);
    expect(await Page.countDocuments()).toBe(6);
    expect((await Setting.findOne({ key: 'site' })).email).toBe('aluby1441@aol.com');
  });

  it('links testimonials to their new ids', async () => {
    await seed(creds);
    const home = await Page.findOne({ key: 'home' });
    const storyId = home.content.get('storyTestimonial');
    expect(await Testimonial.exists({ _id: storyId })).not.toBeNull();
    const events = await Service.findOne({ slug: 'events' });
    expect(events.testimonial).not.toBeNull();
  });

  it('is safe to run again and never overwrites edited content or the password', async () => {
    await seed(creds);
    await Setting.updateOne({ key: 'site' }, { email: 'edited@example.com' });
    await Page.updateOne({ key: 'about' }, { 'content.heading': 'Edited heading' });
    await Photo.deleteOne({ slug: 'dsc-1563' });

    await seed({ ...creds, adminPassword: 'a-different-password-123' });

    expect(await Admin.countDocuments()).toBe(1);
    const admin = await Admin.findOne().select('+passwordHash');
    expect(await bcrypt.compare('a-long-enough-password', admin.passwordHash)).toBe(true);
    expect((await Setting.findOne({ key: 'site' })).email).toBe('edited@example.com');
    expect((await Page.findOne({ key: 'about' })).content.get('heading')).toBe('Edited heading');
    expect(await Photo.countDocuments()).toBe(60);
    expect(await Testimonial.countDocuments()).toBe(21);
  });

  it('resets the password only when asked to', async () => {
    await seed(creds);
    await seed({ ...creds, adminPassword: 'brand-new-password-456', resetPassword: true });
    const admin = await Admin.findOne().select('+passwordHash');
    expect(await bcrypt.compare('brand-new-password-456', admin.passwordHash)).toBe(true);
  });

  it('refuses weak or missing credentials', async () => {
    await expect(seed({ ...creds, adminPassword: 'short' })).rejects.toThrow(/at least 12/);
    await expect(seed({ ...creds, adminEmail: '' })).rejects.toThrow(/ADMIN_EMAIL/);
    expect(await Admin.countDocuments()).toBe(0);
  });

  it('produces a complete public site bundle', async () => {
    await seed(creds);
    const res = await request(createApp()).get('/api/site');
    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(data.services.map((s) => s.slug)).toEqual(['events', 'weddings', 'portraits', 'sports', 'performance']);
    expect(data.photos.filter((p) => p.featured > 0)).toHaveLength(8);
    expect(data.pages.home.content.heroHeading).toBe('Event & portrait photography with personality.');
    // 6 on the Testimonials page plus the ones referenced by services and the homepage story
    expect(data.testimonials.length).toBeGreaterThanOrEqual(6);
    expect(data.testimonials.some((t) => t._id === data.pages.home.content.storyTestimonial)).toBe(true);
  });
});
