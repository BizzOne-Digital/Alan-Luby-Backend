import { logActivity } from '../services/activity.js';
import { assertObjectId, escapeRegex, listQuery, notFound, paginated } from '../utils/http.js';

/**
 * List/get/create/update/delete handlers for a collection.
 * Writes are admin-only (enforced in routes); anonymous reads only see documents matching `publicFilter`.
 * Hooks: prepareCreate(data), beforeSave(data, prev), afterSave(doc, prev), beforeDelete(doc), afterDelete(doc).
 */
export function crudController({
  Model,
  entity,
  label,
  createSchema,
  updateSchema,
  searchFields = [],
  sortable = [],
  defaultSort,
  filters = {},
  publicFilter,
  hooks = {},
}) {
  const visibility = (req) => (!req.admin && publicFilter ? publicFilter : {});

  return {
    async list(req, res) {
      const opts = listQuery(req.query, { sortable, defaultSort });
      const filter = { ...visibility(req) };
      for (const [param, toFilter] of Object.entries(filters)) {
        const value = req.query[param];
        if (typeof value === 'string' && value !== '') Object.assign(filter, toFilter(value));
      }
      if (opts.q && searchFields.length) {
        // $and so the search cannot replace an $or already in the visibility filter
        filter.$and = [{ $or: searchFields.map((f) => ({ [f]: { $regex: escapeRegex(opts.q), $options: 'i' } })) }];
      }
      const [data, total] = await Promise.all([
        Model.find(filter, { __v: 0 }).sort(opts.sort).skip(opts.skip).limit(opts.limit).lean(),
        Model.countDocuments(filter),
      ]);
      res.json(paginated(data, total, opts));
    },

    async get(req, res) {
      assertObjectId(req.params.id);
      const doc = await Model.findOne({ _id: req.params.id, ...visibility(req) }, { __v: 0 }).lean();
      if (!doc) throw notFound(entity);
      res.json({ success: true, data: doc });
    },

    async create(req, res) {
      let data = createSchema.parse(req.body);
      if (hooks.prepareCreate) data = await hooks.prepareCreate(data);
      await hooks.beforeSave?.(data, null);
      const doc = await Model.create(data);
      await hooks.afterSave?.(doc, null);
      await logActivity(req, `${entity.toLowerCase()}.create`, { entity, entityId: doc._id, summary: `Created ${label(doc)}` });
      res.status(201).json({ success: true, data: doc });
    },

    async update(req, res) {
      assertObjectId(req.params.id);
      const data = updateSchema.parse(req.body);
      const doc = await Model.findById(req.params.id);
      if (!doc) throw notFound(entity);
      const prev = doc.toObject();
      await hooks.beforeSave?.(data, prev);
      doc.set(data);
      await doc.save();
      await hooks.afterSave?.(doc, prev);
      await logActivity(req, `${entity.toLowerCase()}.update`, { entity, entityId: doc._id, summary: `Updated ${label(doc)}` });
      res.json({ success: true, data: doc });
    },

    async remove(req, res) {
      assertObjectId(req.params.id);
      const doc = await Model.findById(req.params.id);
      if (!doc) throw notFound(entity);
      await hooks.beforeDelete?.(doc);
      await doc.deleteOne();
      await hooks.afterDelete?.(doc);
      await logActivity(req, `${entity.toLowerCase()}.delete`, { entity, entityId: doc._id, summary: `Deleted ${label(doc)}` });
      res.json({ success: true });
    },
  };
}
