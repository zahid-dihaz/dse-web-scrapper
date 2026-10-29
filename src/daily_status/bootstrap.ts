import { Connection } from 'mongoose';
import {
  COLLECTION_NAMES,
  ENDPOINT_PATHS,
  ENDPOINT_STATUSES,
  OVERALL_STATUSES,
  SESSION_COLLECTION,
  SOURCES,
  STATUS_COLLECTION,
} from './status.config';
import { connectMongo } from './mongo';

// Creates (or updates via collMod) the daily_status and market_sessions
// collections with their validators and indexes. Idempotent; touches no
// other collection.

const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const HHMM_PATTERN = '^\\d{2}:\\d{2}$';

export const dailyStatusValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      '_id',
      'exchange_open',
      'overall_status',
      'generated_at',
      'updated_at',
      'endpoints',
    ],
    properties: {
      _id: { bsonType: 'string', pattern: DATE_PATTERN },
      exchange_open: { bsonType: 'bool' },
      overall_status: { enum: [...OVERALL_STATUSES] },
      generated_at: { bsonType: 'date' },
      updated_at: { bsonType: 'date' },
      endpoints: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: [
            'endpoint',
            'collection',
            'source',
            'status',
            'last_success_at',
            'rows',
            'note',
          ],
          properties: {
            endpoint: { enum: ENDPOINT_PATHS },
            collection: { enum: COLLECTION_NAMES },
            source: { enum: SOURCES },
            status: { enum: [...ENDPOINT_STATUSES] },
            last_success_at: { bsonType: ['date', 'null'] },
            rows: { bsonType: ['int', 'long'], minimum: 0 },
            note: { bsonType: ['string', 'null'], maxLength: 500 },
          },
        },
      },
    },
  },
};

// One document per Dhaka date: the market status as published by the DSE site.
export const marketSessionValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id', 'trading_day', 'fetched_at'],
    properties: {
      _id: { bsonType: 'string', pattern: DATE_PATTERN },
      trading_day: { bsonType: 'bool' },
      is_open: { bsonType: 'bool' },
      phase: { bsonType: 'string' },
      pre_opening: { bsonType: ['string', 'null'], pattern: HHMM_PATTERN },
      opening: { bsonType: ['string', 'null'], pattern: HHMM_PATTERN },
      closing: { bsonType: ['string', 'null'], pattern: HHMM_PATTERN },
      post_closing: { bsonType: ['string', 'null'], pattern: HHMM_PATTERN },
      fetched_at: { bsonType: 'date' },
    },
  },
};

async function ensureCollection(
  conn: Connection,
  name: string,
  validator: object,
): Promise<void> {
  const db = conn.db;
  const exists = (await db.listCollections({ name }).toArray()).length > 0;
  if (exists) {
    await db.command({
      collMod: name,
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  } else {
    await db.createCollection(name, {
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
  }
}

export async function bootstrapStatusCollections(
  conn: Connection,
): Promise<void> {
  await ensureCollection(conn, STATUS_COLLECTION, dailyStatusValidator);
  const status = conn.db.collection(STATUS_COLLECTION);
  await status.createIndex({ overall_status: 1, _id: -1 });
  await status.createIndex({ 'endpoints.status': 1 });

  await ensureCollection(conn, SESSION_COLLECTION, marketSessionValidator);
}

// CLI: node dist/daily_status/bootstrap
if (require.main === module) {
  (async () => {
    const conn = await connectMongo();
    try {
      await bootstrapStatusCollections(conn);
      console.log(
        `Bootstrapped ${STATUS_COLLECTION} and ${SESSION_COLLECTION}`,
      );
    } finally {
      await conn.close();
    }
  })().catch((err) => {
    console.error(`daily_status bootstrap failed: ${err}`);
    process.exit(1);
  });
}
