import 'dotenv/config';
import { Connection, createConnection } from 'mongoose';

// Standalone connection for the watchdog, finalizer and bootstrap entrypoints.
// Deliberately independent of Nest and of the scrapers/pollers.
export async function connectMongo(): Promise<Connection> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not defined');
  return createConnection(uri, {
    serverSelectionTimeoutMS: 5000,
  }).asPromise();
}
