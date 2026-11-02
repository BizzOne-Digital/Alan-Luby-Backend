import mongoose from 'mongoose';
import multer from 'multer';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../utils/http.js';

export function notFoundHandler(_req, _res, next) {
  next(new AppError(404, 'Endpoint not found'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let message = 'Something went wrong. Please try again.';
  let details;

  if (err instanceof AppError) {
    ({ status, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    message = 'Please check the highlighted fields';
    details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    message = 'Please check the highlighted fields';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    message = 'Invalid value';
  } else if (err?.code === 11000) {
    status = 409;
    message = `A record with this ${Object.keys(err.keyPattern || {}).join(', ') || 'value'} already exists`;
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large. The maximum size is 8MB.' : 'Invalid upload';
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    message = 'Request is too large';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON';
  }

  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);

  res.status(status).json({
    success: false,
    error: { message, ...(details && { details }), ...(!env.isProd && status >= 500 && { stack: err?.stack }) },
  });
}
