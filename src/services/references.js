import { Page } from '../models/Page.js';
import { Photo } from '../models/Photo.js';
import { Service } from '../models/Service.js';

/** Page content is a handful of small documents, so scanning their values in memory is simplest. */
async function pageValues() {
  const pages = await Page.find({}, { key: 1, content: 1 }).lean();
  return pages.flatMap((p) => Object.entries(p.content || {}).map(([field, value]) => ({ page: p.key, field, value: String(value) })));
}

const listIncludes = (value, item) => value.split(',').map((s) => s.trim()).includes(item);

export async function isUrlReferenced(url, { exceptPhotoId, exceptPage } = {}) {
  const photo = await Photo.exists({ src: url, ...(exceptPhotoId && { _id: { $ne: exceptPhotoId } }) });
  if (photo) return true;
  return (await pageValues()).some((v) => v.page !== exceptPage && v.value === url);
}

/** Where a photo is used outside the Work gallery. Empty when it is safe to delete. */
export async function photoUsage(slug) {
  const services = await Service.find({ $or: [{ image: slug }, { supporting: slug }] }, { title: 1 }).lean();
  const pages = (await pageValues()).filter((v) => listIncludes(v.value, slug));
  return [...services.map((s) => `service "${s.title}"`), ...pages.map((v) => `${v.page} page (${v.field})`)];
}

export async function testimonialUsage(id) {
  const services = await Service.find({ testimonial: id }, { title: 1 }).lean();
  const pages = (await pageValues()).filter((v) => v.value === String(id));
  return [...services.map((s) => `service "${s.title}"`), ...pages.map((v) => `${v.page} page (${v.field})`)];
}
