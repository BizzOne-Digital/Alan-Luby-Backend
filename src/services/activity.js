import { ActivityLog } from '../models/ActivityLog.js';

/** Records an admin action. Never pass passwords, tokens or cookies in `summary`. Failures never break the request. */
export async function logActivity(req, action, { entity = '', entityId = '', summary = '', admin = req.admin } = {}) {
  try {
    await ActivityLog.create({
      admin: admin?._id ?? null,
      adminEmail: admin?.email ?? '',
      action,
      entity,
      entityId: String(entityId),
      summary: String(summary).slice(0, 300),
      ip: req.ip || '',
    });
  } catch (err) {
    console.error('Activity log write failed:', err.message);
  }
}
