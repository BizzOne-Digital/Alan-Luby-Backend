export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = 'Resource') => new AppError(404, `${what} not found`);

export const OBJECT_ID = /^[a-f0-9]{24}$/i;

export function assertObjectId(id) {
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) throw new AppError(400, 'Invalid id');
}

/** Pagination, search and sort for admin list endpoints. */
export function listQuery(query, { sortable, defaultSort }) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
  let sort = defaultSort;
  if (typeof query.sort === 'string') {
    const field = query.sort.replace(/^-/, '');
    if (sortable.includes(field)) sort = { [field]: query.sort.startsWith('-') ? -1 : 1, _id: 1 };
  }
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
  return { page, limit, sort, q, skip: (page - 1) * limit };
}

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const paginated = (data, total, { page, limit }) => ({
  success: true,
  data,
  pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
});
