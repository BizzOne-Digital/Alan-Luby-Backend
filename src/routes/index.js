import { Router } from 'express';
import * as auth from '../controllers/auth.js';
import * as content from '../controllers/content.js';
import * as dashboard from '../controllers/dashboard.js';
import { inquiries, photos, services, testimonials } from '../controllers/resources.js';
import * as uploads from '../controllers/uploads.js';
import { requireAdmin, requireCsrf } from '../middleware/auth.js';
import { contactLimiter, loginLimiter } from '../middleware/security.js';

/** Built per app instance so rate-limit counters are not shared between instances (e.g. in tests). */
export function buildRoutes() {
  const router = Router();
  const admin = [requireAdmin, requireCsrf];

  router.get('/auth/csrf', auth.csrf);
  router.post('/auth/login', loginLimiter(), requireCsrf, auth.login);
  router.post('/auth/logout', requireCsrf, auth.logout);
  router.get('/auth/me', requireAdmin, auth.me);

  router.get('/site', content.siteBundle);

  router.get('/settings', content.readSettings);
  router.put('/settings', ...admin, content.updateSettings);

  router.get('/pages', content.listPages);
  router.get('/pages/:key', content.readPage);
  router.put('/pages/:key', ...admin, content.updatePage);

  for (const [path, c] of Object.entries({ photos, services, testimonials })) {
    router.get(`/${path}`, c.list);
    router.get(`/${path}/:id`, c.get);
    router.post(`/${path}`, ...admin, c.create);
    router.patch(`/${path}/:id`, ...admin, c.update);
    router.delete(`/${path}/:id`, ...admin, c.remove);
  }

  router.post('/contact', contactLimiter(), content.createInquiry);
  router.get('/contact', ...admin, inquiries.list);
  router.get('/contact/:id', ...admin, inquiries.get);
  router.patch('/contact/:id', ...admin, inquiries.update);
  router.delete('/contact/:id', ...admin, inquiries.remove);

  router.post('/upload', ...admin, ...uploads.upload);
  router.delete('/uploads/:folder/:filename', ...admin, uploads.remove);

  router.get('/dashboard/stats', ...admin, dashboard.stats);
  router.get('/activity', ...admin, dashboard.activity);

  return router;
}
