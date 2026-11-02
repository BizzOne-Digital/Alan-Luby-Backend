import { ActivityLog } from '../models/ActivityLog.js';
import { Inquiry } from '../models/Inquiry.js';
import { Page } from '../models/Page.js';
import { Photo } from '../models/Photo.js';
import { Service } from '../models/Service.js';
import { StoredUpload } from '../models/StoredUpload.js';
import { Testimonial } from '../models/Testimonial.js';
import { escapeRegex, listQuery, paginated } from '../utils/http.js';

/** Real counts only; nothing here is estimated or sampled. */
export async function stats(_req, res) {
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [
    photos, photosInWork, photosFeatured, services, servicesVisible, testimonials, testimonialsShown,
    pages, pagesPublished, inquiries, inquiriesUnread, inquiriesMonth, uploadTotals, recentActivity, recentInquiries,
  ] = await Promise.all([
    Photo.countDocuments(),
    Photo.countDocuments({ showInWork: true }),
    Photo.countDocuments({ featured: { $gt: 0 } }),
    Service.countDocuments(),
    Service.countDocuments({ visible: true }),
    Testimonial.countDocuments(),
    Testimonial.countDocuments({ showOnPage: true }),
    Page.countDocuments(),
    Page.countDocuments({ published: true }),
    Inquiry.countDocuments(),
    Inquiry.countDocuments({ read: false }),
    Inquiry.countDocuments({ createdAt: { $gte: monthAgo } }),
    StoredUpload.aggregate([{ $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$size' } } }]),
    ActivityLog.find({}, { __v: 0, ip: 0 }).sort({ createdAt: -1 }).limit(8).lean(),
    Inquiry.find({}, { name: 1, service: 1, read: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(5).lean(),
  ]);

  res.json({
    success: true,
    data: {
      photos: { total: photos, inWork: photosInWork, featured: photosFeatured },
      services: { total: services, visible: servicesVisible },
      testimonials: { total: testimonials, shown: testimonialsShown },
      pages: { total: pages, published: pagesPublished },
      inquiries: { total: inquiries, unread: inquiriesUnread, last30Days: inquiriesMonth },
      uploads: { total: uploadTotals[0]?.count ?? 0, bytes: uploadTotals[0]?.bytes ?? 0 },
      recentActivity,
      recentInquiries,
    },
  });
}

export async function activity(req, res) {
  const opts = listQuery(req.query, { sortable: ['createdAt'], defaultSort: { createdAt: -1, _id: -1 } });
  const filter = {};
  if (typeof req.query.entity === 'string' && req.query.entity) filter.entity = req.query.entity;
  if (opts.q) filter.$or = ['summary', 'adminEmail', 'action'].map((f) => ({ [f]: { $regex: escapeRegex(opts.q), $options: 'i' } }));
  const [data, total] = await Promise.all([
    ActivityLog.find(filter, { __v: 0 }).sort(opts.sort).skip(opts.skip).limit(opts.limit).lean(),
    ActivityLog.countDocuments(filter),
  ]);
  res.json(paginated(data, total, opts));
}
