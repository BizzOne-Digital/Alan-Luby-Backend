import { z } from 'zod';
import { HOME_SECTIONS } from '../models/Page.js';
import { SOCIAL_ICONS } from '../models/Setting.js';
import { OBJECT_ID } from '../utils/http.js';

const text = (max) => z.string().trim().max(max);
const required = (max) => text(max).min(1, 'Required');
const position = z.number().int().min(0).max(10000);

/** Only http(s) links: anything else (javascript:, data:) could run script when rendered as a link. */
const httpUrl = text(500).refine((v) => /^https?:\/\/[^\s]+$/i.test(v), 'Must start with http:// or https://');

/** Site-relative paths (/images/..., /api/uploads/...) or https URLs. */
const imageSrc = required(500).refine((v) => /^\/(?!\/)[^\s\\]*$/.test(v) || /^https:\/\/[^\s]+$/.test(v), 'Invalid image URL');

const slug = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes').max(40);
const photoSlug = z.string().trim().regex(/^[a-z0-9-]{1,80}$/, 'Invalid photo reference');
const objectId = z.string().regex(OBJECT_ID, 'Invalid id');

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  password: z.string().min(1, 'Password is required').max(200),
});

export const settingsSchema = z.object({
  siteName: text(100),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email())]),
  phone: text(40),
  phone2: text(40),
  socials: z.array(z.object({ label: required(40), url: httpUrl, icon: z.enum(SOCIAL_ICONS) })).max(12),
  footerText: text(500),
  inquiryTitle: text(200),
  inquiryText: text(500),
  seoTitle: text(120),
  seoDescription: text(300),
}).partial();

export const pageSchema = z.object({
  published: z.boolean(),
  seoTitle: text(120),
  seoDescription: text(300),
  content: z
    .record(z.string().regex(/^[a-zA-Z0-9]{1,40}$/, 'Invalid field name'), text(5000))
    .refine((c) => Object.keys(c).length <= 80, 'Too many fields'),
  sections: z
    .array(z.object({ key: z.enum(HOME_SECTIONS), visible: z.boolean() }))
    .max(HOME_SECTIONS.length)
    .refine((s) => new Set(s.map((x) => x.key)).size === s.length, 'Duplicate section'),
}).partial();

const photoFields = {
  title: required(150),
  alt: required(300),
  category: slug,
  width: z.number().int().min(1).max(20000),
  height: z.number().int().min(1).max(20000),
  src: imageSrc,
  srcSet: text(2000).regex(/^[\w\-./:%, ]*$/, 'Invalid srcset'),
  focus: text(20).regex(/^\d{1,3}% \d{1,3}%$/, 'Use the form "50% 30%"'),
  order: z.number().int().min(-100000).max(100000),
  showInWork: z.boolean(),
  featured: position,
  marquee: position,
};
export const photoCreateSchema = z.object(photoFields).partial({ srcSet: true, focus: true, order: true, showInWork: true, featured: true, marquee: true });
export const photoUpdateSchema = z.object(photoFields).partial();

const serviceFields = {
  title: required(100),
  shortTitle: required(60),
  categoryLabel: required(60),
  inquiryValue: required(100),
  summary: required(1000),
  whoFor: text(1000),
  photographs: z.array(required(200)).max(20),
  image: photoSlug,
  supporting: z.array(photoSlug).max(6),
  testimonial: objectId.nullable(),
  order: z.number().int().min(-100000).max(100000),
  visible: z.boolean(),
};
export const serviceCreateSchema = z
  .object({ slug, ...serviceFields })
  .partial({ whoFor: true, photographs: true, supporting: true, testimonial: true, order: true, visible: true });
// slug is immutable: photos use it as their category
export const serviceUpdateSchema = z.object(serviceFields).partial();

/** Every fragment of an excerpt (split on " … ") must appear word for word in the quote. */
const verbatim = (t) => !t.excerpt || !t.quote || t.excerpt.split(' … ').every((part) => t.quote.includes(part));
const testimonialFields = {
  quote: required(3000),
  excerpt: text(1000),
  clientRole: required(200),
  organization: text(200),
  location: text(200),
  showOnPage: z.boolean(),
  order: z.number().int().min(-100000).max(100000),
  featuredOnHome: position,
};
export const testimonialCreateSchema = z
  .object(testimonialFields)
  .partial({ excerpt: true, organization: true, location: true, showOnPage: true, order: true, featuredOnHome: true })
  .refine(verbatim, { message: 'The excerpt must be a word-for-word part of the quote (mark omissions with " … ")', path: ['excerpt'] });
export const testimonialUpdateSchema = z.object(testimonialFields).partial();
export const testimonialVerbatim = verbatim;

export const inquirySchema = z.object({
  name: required(120),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  phone: text(40).optional(),
  service: text(100).optional(),
  date: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')]).optional(),
  location: text(200).optional(),
  message: required(5000),
  /** Honeypot: real visitors never fill it in */
  website: z.string().max(200).optional(),
});

export const inquiryUpdateSchema = z.object({ read: z.boolean() });
