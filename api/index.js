// Vercel Function entry point: every request is rewritten here (see vercel.json).
// The app and its MongoDB connection are created on the first request and reused while the instance stays warm.
import { createApp } from '../src/app.js';
import { connectDB } from '../src/config/db.js';
import { assertEnv, env } from '../src/config/env.js';

let ready = null;

async function init() {
  assertEnv();
  await connectDB(env.mongoUri);
  return createApp();
}

export default async function handler(req, res) {
  // One shared promise, so simultaneous cold-start requests build a single app; a failed start is retried next time.
  ready ??= init().catch((err) => {
    ready = null;
    throw err;
  });
  const app = await ready;
  return app(req, res);
}
