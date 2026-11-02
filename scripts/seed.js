/**
 * Creates the first admin account and the site's starting content. Safe to run more than once:
 * - the admin is created only if no admin with ADMIN_EMAIL exists (the password is never overwritten,
 *   unless you pass --reset-admin-password);
 * - settings, pages, photos, services and testimonials are inserted only where nothing exists yet,
 *   so content edited in the admin is never replaced.
 *
 * Usage: npm run seed                         (reads backend/.env)
 *        npm run seed -- --reset-admin-password
 *
 * The content comes from seed-content.json: the text and photos the website shipped with
 * (exported from the frontend's built-in content, src/site/fallback.ts).
 */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { BCRYPT_ROUNDS } from '../src/controllers/auth.js';
import { Admin } from '../src/models/Admin.js';
import { Page } from '../src/models/Page.js';
import { Photo } from '../src/models/Photo.js';
import { Service } from '../src/models/Service.js';
import { Setting } from '../src/models/Setting.js';
import { Testimonial } from '../src/models/Testimonial.js';

const MIN_PASSWORD = 12;

export async function seed({ adminEmail, adminPassword, resetPassword = false, log = console.log } = {}) {
  const content = JSON.parse(await readFile(new URL('./seed-content.json', import.meta.url), 'utf8'));
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

  // ---- Admin ----
  const email = String(adminEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_EMAIL must be a valid email address');
  const existing = await Admin.findOne({ email });
  if (!existing || resetPassword) {
    if (!adminPassword || adminPassword.length < MIN_PASSWORD) throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters`);
    const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_ROUNDS);
    if (existing) {
      await Admin.updateOne({ _id: existing._id }, { passwordHash, failedLogins: 0, lockUntil: null });
      log(`Admin ${email}: password reset`);
    } else {
      await Admin.create({ email, passwordHash });
      log(`Admin ${email}: created`);
    }
  } else {
    log(`Admin ${email}: already exists (password unchanged)`);
  }

  // ---- Settings ----
  const settings = await Setting.updateOne({ key: 'site' }, { $setOnInsert: { key: 'site', ...content.settings } }, { upsert: true });
  log(`Settings: ${settings.upsertedCount ? 'created' : 'already exist (unchanged)'}`);

  // ---- Testimonials (first, so services and pages can point at them) ----
  const testimonialIds = new Map();
  if ((await Testimonial.estimatedDocumentCount()) === 0) {
    for (const { _id: legacyId, ...t } of content.testimonials) {
      const doc = await Testimonial.create(t);
      testimonialIds.set(legacyId, String(doc._id));
    }
    log(`Testimonials: ${testimonialIds.size} created`);
  } else {
    log('Testimonials: already exist (unchanged)');
  }
  const mapTestimonial = (value) => testimonialIds.get(value) ?? value;

  // ---- Services ----
  if ((await Service.estimatedDocumentCount()) === 0) {
    await Service.insertMany(
      content.services.map((s) => ({ ...s, testimonial: s.testimonial && testimonialIds.has(s.testimonial) ? testimonialIds.get(s.testimonial) : null })),
    );
    log(`Services: ${content.services.length} created`);
  } else {
    log('Services: already exist (unchanged)');
  }

  // ---- Photos ----
  if ((await Photo.estimatedDocumentCount()) === 0) {
    await Photo.insertMany(content.photos);
    log(`Photos: ${content.photos.length} created`);
  } else {
    log('Photos: already exist (unchanged)');
  }

  // ---- Pages (each one only if missing) ----
  let createdPages = 0;
  for (const page of Object.values(content.pages)) {
    const pageContent = Object.fromEntries(Object.entries(page.content).map(([k, v]) => [k, mapTestimonial(v)]));
    const res = await Page.updateOne({ key: page.key }, { $setOnInsert: { ...page, content: pageContent } }, { upsert: true });
    createdPages += res.upsertedCount;
  }
  log(`Pages: ${createdPages} created, ${Object.keys(content.pages).length - createdPages} already existed (unchanged)`);
}

// Run directly (npm run seed), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Add it to backend/.env or the environment.');
    process.exit(1);
  }
  try {
    await connectDB(uri);
    await seed({
      adminEmail: process.env.ADMIN_EMAIL,
      adminPassword: process.env.ADMIN_PASSWORD,
      resetPassword: process.argv.includes('--reset-admin-password'),
    });
    console.log('Seed complete.');
  } catch (err) {
    console.error(`Seed failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
}
