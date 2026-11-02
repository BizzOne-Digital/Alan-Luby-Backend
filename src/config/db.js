import mongoose from 'mongoose';

mongoose.set('strictQuery', true);
//
// Reused across hot reloads and serverless invocations so each request does not open a new pool.
let pending = null;

export function connectDB(uri) {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);
  pending ??= mongoose
    .connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 10 })
    .then(() => mongoose.connection)
    .catch((err) => {
      pending = null;
      throw err;
    });
  return pending;
}

export async function disconnectDB() {
  pending = null;
  await mongoose.disconnect();
}
