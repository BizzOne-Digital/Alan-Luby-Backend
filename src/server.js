import { createApp } from './app.js';
import { connectDB, disconnectDB } from './config/db.js';
import { assertEnv, env } from './config/env.js';

assertEnv();
await connectDB(env.mongoUri);

const server = createApp().listen(env.port, () => {
  console.log(`API listening on port ${env.port} (${env.nodeEnv})`);
});

function shutdown(signal) {
  console.log(`${signal} received: closing server`);
  server.close(async () => {
    await disconnectDB();
    process.exit(0);
  });
  // Force exit if open connections keep the server from closing.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
