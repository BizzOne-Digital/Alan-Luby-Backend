import { Page, PAGE_KEYS } from '../models/Page.js';
import { Photo } from '../models/Photo.js';
import { Service } from '../models/Service.js';
import { Setting } from '../models/Setting.js';
import { Testimonial } from '../models/Testimonial.js';
import { logActivity } from '../services/activity.js';
import { deleteManagedUpload, parseManagedUrl } from '../services/uploads.js';
import { AppError, notFound } from '../utils/http.js';
import { inquirySchema, pageSchema, settingsSchema } from '../validators/schemas.js';
import { Inquiry } from '../models/Inquiry.js';

const SETTINGS_FIELDS = { _id: 0, key: 0, __v: 0, createdAt: 0 };
const PAGE_FIELDS = { _id: 0, __v: 0, createdAt: 0 };

const getSettings = () => Setting.findOne({ key: 'site' }, SETTINGS_FIELDS).lean();

// ---- Settings ----

export async function readSettings(_req, res) {
  res.json({ success: true, data: (await getSettings()) ?? {} });
}

export async function updateSettings(req, res) {
  const data = settingsSchema.parse(req.body);
  await Setting.findOneAndUpdate({ key: 'site' }, { $set: data }, { upsert: true, runValidators: true, setDefaultsOnInsert: true });
  await logActivity(req, 'settings.update', { entity: 'Settings', summary: `Updated site settings (${Object.keys(data).join(', ') || 'no changes'})` });
  res.json({ success: true, data: await getSettings() });
}

// ---- Pages ----

const assertPageKey = (key) => {
  if (!PAGE_KEYS.includes(key)) throw notFound('Page');
};

export async function listPages(req, res) {
  const filter = req.admin ? {} : { published: true };
  res.json({ success: true, data: await Page.find(filter, PAGE_FIELDS).sort({ key: 1 }).lean() });
}

export async function readPage(req, res) {
  assertPageKey(req.params.key);
  const page = await Page.findOne({ key: req.params.key, ...(!req.admin && { published: true }) }, PAGE_FIELDS).lean();
  if (!page) throw notFound('Page');
  res.json({ success: true, data: page });
}

export async function updatePage(req, res) {
  const { key } = req.params;
  assertPageKey(key);
  const data = pageSchema.parse(req.body);
  if (key === 'home' && data.published === false) throw new AppError(400, 'The homepage cannot be unpublished');
  if (key !== 'home' && data.sections) throw new AppError(400, 'Only the homepage has configurable sections');

  const page = (await Page.findOne({ key })) ?? new Page({ key });
  const oldUploads = [...(page.content?.values() ?? [])].filter((v) => parseManagedUrl(v));
  page.set(data);
  await page.save();

  // Images removed from this page's content are deleted unless something else still uses them.
  const kept = new Set(page.content.values());
  await Promise.all(oldUploads.filter((url) => !kept.has(url)).map((url) => deleteManagedUpload(url)));

  await logActivity(req, 'page.update', { entity: 'Page', entityId: key, summary: `Updated the ${key} page` });
  res.json({ success: true, data: await Page.findOne({ key }, PAGE_FIELDS).lean() });
}

// ---- Public site bundle ----

/** Everything the public site renders, in one request. Only published/visible content is included. */
export async function siteBundle(_req, res) {
  const [settings, pages, services, photos, testimonials] = await Promise.all([
    getSettings(),
    Page.find({}, PAGE_FIELDS).lean(),
    Service.find({ visible: true }, { __v: 0, createdAt: 0, updatedAt: 0, visible: 0 }).sort({ order: 1, _id: 1 }).lean(),
    Photo.find({}, { __v: 0, createdAt: 0, updatedAt: 0 }).sort({ order: 1, _id: 1 }).lean(),
    Testimonial.find({}, { __v: 0, createdAt: 0, updatedAt: 0 }).sort({ order: 1, _id: 1 }).lean(),
  ]);

  const pageMap = Object.fromEntries(
    pages.map((p) => [p.key, p.published ? p : { key: p.key, published: false }]),
  );
  // Testimonials are public when shown on a page, on the homepage, or attached to a visible service or page field.
  const referenced = new Set([
    ...services.map((s) => String(s.testimonial)),
    ...Object.values(pageMap).flatMap((p) => Object.values(p.content || {})),
  ]);
  const publicTestimonials = testimonials.filter((t) => t.showOnPage || t.featuredOnHome > 0 || referenced.has(String(t._id)));

  res.set('Cache-Control', 'no-cache');
  res.json({ success: true, data: { settings: settings ?? {}, pages: pageMap, services, photos, testimonials: publicTestimonials } });
}

// ---- Contact form ----

export async function createInquiry(req, res) {
  const { website, ...data } = inquirySchema.parse(req.body);
  // Honeypot filled in: answer like a success so bots learn nothing, but store nothing.
  if (website) return res.status(201).json({ success: true });
  await Inquiry.create(data);
  res.status(201).json({ success: true });
}
