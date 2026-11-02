import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { sessionMiddleware } from './config/session.js';
import * as uploads from './controllers/uploads.js';
import { loadAdmin } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiLimiter, rejectOperatorKeys } from './middleware/security.js';
import { buildRoutes } from './routes/index.js';

/** Builds the Express app. The database connection must already be open (sessions are stored in it). */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy);

  if (!env.isTest) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`));
      next();
    });
  }

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.frontendUrls.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      maxAge: 600,
    }),
  );

  // No session needed for these, so they skip the session store lookup.
  app.get('/api/health', (_req, res) => {
    const up = mongoose.connection.readyState === 1;
    res.status(up ? 200 : 503).json({ success: up, status: up ? 'ok' : 'degraded', database: up ? 'connected' : 'disconnected' });
  });
  app.get('/api/uploads/:folder/:filename', uploads.serve);

  app.use('/api', apiLimiter());
  app.use(express.json({ limit: '100kb' }));
  app.use(rejectOperatorKeys);
  app.use(sessionMiddleware(mongoose.connection.getClient()));
  app.use(loadAdmin);
  app.use('/api', buildRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
