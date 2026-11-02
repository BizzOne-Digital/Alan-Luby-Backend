import { randomBytes } from 'node:crypto';
import { Inquiry } from '../models/Inquiry.js';
import { Photo } from '../models/Photo.js';
import { Service } from '../models/Service.js';
import { Testimonial } from '../models/Testimonial.js';
import { photoUsage, testimonialUsage } from '../services/references.js';
import { deleteManagedUpload } from '../services/uploads.js';
import { AppError } from '../utils/http.js';
import * as schemas from '../validators/schemas.js';
import { crudController } from './crud.js';

const inUse = (what, usage) => {
  if (usage.length) throw new AppError(409, `This ${what} is still used by: ${usage.join(', ')}. Remove it there first.`);
};

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'photo';

export const photos = crudController({
  Model: Photo,
  entity: 'Photo',
  label: (d) => `photo "${d.title}"`,
  createSchema: schemas.photoCreateSchema,
  updateSchema: schemas.photoUpdateSchema,
  searchFields: ['title', 'alt', 'slug'],
  sortable: ['order', 'title', 'createdAt', 'featured', 'marquee'],
  defaultSort: { order: 1, _id: 1 },
  filters: {
    category: (v) => ({ category: v }),
    showInWork: (v) => ({ showInWork: v === 'true' }),
    placement: (v) => (v === 'featured' ? { featured: { $gt: 0 } } : v === 'marquee' ? { marquee: { $gt: 0 } } : {}),
  },
  hooks: {
    prepareCreate: (data) => ({ ...data, slug: `${slugify(data.title)}-${randomBytes(3).toString('hex')}` }),
    async beforeSave(data) {
      if (data.category && !(await Service.exists({ slug: data.category }))) throw new AppError(400, 'Unknown category');
    },
    async afterSave(doc, prev) {
      if (prev && prev.src !== doc.src) await deleteManagedUpload(prev.src);
    },
    beforeDelete: async (doc) => inUse('photo', await photoUsage(doc.slug)),
    afterDelete: (doc) => deleteManagedUpload(doc.src),
  },
});

export const services = crudController({
  Model: Service,
  entity: 'Service',
  label: (d) => `service "${d.title}"`,
  createSchema: schemas.serviceCreateSchema,
  updateSchema: schemas.serviceUpdateSchema,
  searchFields: ['title', 'summary'],
  sortable: ['order', 'title', 'createdAt'],
  defaultSort: { order: 1, _id: 1 },
  publicFilter: { visible: true },
  hooks: {
    async beforeSave(data) {
      const slugs = [data.image, ...(data.supporting || [])].filter(Boolean);
      const found = await Photo.countDocuments({ slug: { $in: [...new Set(slugs)] } });
      if (found !== new Set(slugs).size) throw new AppError(400, 'One of the selected photos no longer exists');
      if (data.testimonial && !(await Testimonial.exists({ _id: data.testimonial }))) throw new AppError(400, 'The selected testimonial no longer exists');
    },
    async beforeDelete(doc) {
      const count = await Photo.countDocuments({ category: doc.slug });
      if (count) throw new AppError(409, `${count} photo${count === 1 ? ' is' : 's are'} still in this category. Move or delete them first.`);
    },
  },
});

export const testimonials = crudController({
  Model: Testimonial,
  entity: 'Testimonial',
  label: (d) => `testimonial from ${d.clientRole.split(',')[0]}`,
  createSchema: schemas.testimonialCreateSchema,
  updateSchema: schemas.testimonialUpdateSchema,
  searchFields: ['quote', 'clientRole', 'organization'],
  sortable: ['order', 'createdAt', 'featuredOnHome'],
  defaultSort: { order: 1, _id: 1 },
  filters: { showOnPage: (v) => ({ showOnPage: v === 'true' }) },
  publicFilter: { $or: [{ showOnPage: true }, { featuredOnHome: { $gt: 0 } }] },
  hooks: {
    beforeSave(data, prev) {
      if (!schemas.testimonialVerbatim({ ...prev, ...data })) {
        throw new AppError(400, 'Please check the highlighted fields', [
          { field: 'excerpt', message: 'The excerpt must be a word-for-word part of the quote (mark omissions with " … ")' },
        ]);
      }
    },
    beforeDelete: async (doc) => inUse('testimonial', await testimonialUsage(doc._id)),
  },
});

/** Contact inquiries: created publicly through the contact form (see contact.js), managed by the admin. */
export const inquiries = crudController({
  Model: Inquiry,
  entity: 'Inquiry',
  label: () => 'an inquiry',
  updateSchema: schemas.inquiryUpdateSchema,
  searchFields: ['name', 'email', 'message', 'service', 'location'],
  sortable: ['createdAt', 'name', 'read'],
  defaultSort: { createdAt: -1, _id: -1 },
  filters: { read: (v) => ({ read: v === 'true' }), service: (v) => ({ service: v }) },
});
