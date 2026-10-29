import { Connection } from 'mongoose';
import { bootstrapStatusCollections } from './bootstrap';
import { StatusService } from './status.service';
import { STATUS_COLLECTION, STATUS_CONFIG } from './status.config';

// Integration tests run against a local mongod in a throwaway database
// (never MONGO_URI). Set MONGO_TEST_URI to override; if Mongo is unreachable
// the DB-backed tests are skipped with a warning.
const TEST_URI =
  process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/dse_status_test';
const DAY = '2026-10-07';
const clockAt = (utc: string) => new Date(`${DAY}T${utc}:00Z`); // 06:14Z = 12:14 Dhaka

let conn: Connection | undefined;

beforeAll(async () => {
  try {
    const { createConnection } = await import('mongoose');
    conn = await createConnection(TEST_URI, {
      serverSelectionTimeoutMS: 1500,
    }).asPromise();
    await bootstrapStatusCollections(conn);
  } catch (err) {
    console.warn(`Mongo unavailable at ${TEST_URI}; skipping DB tests: ${err}`);
    conn = undefined;
  }
});

afterAll(async () => {
  await conn?.close();
});

beforeEach(async () => {
  await conn?.db.collection(STATUS_COLLECTION).deleteMany({});
});

const dbTest = (name: string, fn: (c: Connection) => Promise<void>) =>
  it(name, async () => {
    if (!conn) return;
    await fn(conn);
  });

const load = (c: Connection) =>
  c.db.collection<any>(STATUS_COLLECTION).findOne({ _id: DAY });
const entry = (doc: any, endpoint: string) =>
  doc.endpoints.find((e: any) => e.endpoint === endpoint);

describe('StatusService (mongo)', () => {
  dbTest(
    'initDay creates all seven endpoints once and is idempotent',
    async (c) => {
      const svc = new StatusService(c, () => clockAt('04:00'));
      expect(await svc.initDay(DAY)).toBe(true);
      const first = await load(c);
      const later = new StatusService(c, () => clockAt('05:00'));
      expect(await later.initDay(DAY)).toBe(true);
      const second = await load(c);

      expect(first.endpoints).toHaveLength(7);
      expect(first).toMatchObject({
        exchange_open: true,
        overall_status: 'failed',
      });
      expect(second.generated_at).toEqual(first.generated_at);
      expect(second.updated_at).toEqual(first.updated_at);
      expect(await c.db.collection(STATUS_COLLECTION).countDocuments()).toBe(1);
    },
  );

  dbTest('first write lazily creates the day', async (c) => {
    const svc = new StatusService(c, () => clockAt('06:14'));
    await svc.recordSuccess('/idx', 5);
    const doc = await load(c);
    expect(entry(doc, '/idx')).toMatchObject({ status: 'ok', rows: 5 });
    expect(doc.endpoints).toHaveLength(7);
  });

  dbTest('success accumulates rows and sets last_success_at', async (c) => {
    let now = clockAt('06:14');
    const svc = new StatusService(c, () => now);
    await svc.recordSuccess('/trd', 300);
    now = clockAt('06:19');
    await svc.recordSuccess('/trd', 301);
    const e = entry(await load(c), '/trd');
    expect(e.rows).toBe(601);
    expect(e.last_success_at).toEqual(clockAt('06:19'));
  });

  dbTest(
    'error, repeated error and recovery produce the expected notes',
    async (c) => {
      let now = clockAt('06:10');
      const svc = new StatusService(c, () => now);
      await svc.recordSuccess('/idx', 5);

      now = clockAt('06:14');
      await svc.recordError(
        '/idx',
        'MySQL connection lost',
        'PROTOCOL_CONNECTION_LOST',
      );
      expect(entry(await load(c), '/idx')).toMatchObject({
        status: 'partial',
        note: 'MySQL connection lost at 12:14 (PROTOCOL_CONNECTION_LOST)',
      });

      now = clockAt('06:20');
      await svc.recordError('/idx', 'MySQL connection lost', 'ECONNRESET');
      expect(entry(await load(c), '/idx').note).toContain('at 12:14');

      now = clockAt('06:41');
      await svc.recordSuccess('/idx', 5);
      await svc.recordRecovery('/idx');
      expect(entry(await load(c), '/idx')).toMatchObject({
        status: 'partial',
        note: 'MySQL connection lost 12:14–12:41, recovered',
      });
    },
  );

  dbTest('an error before any capture is failed', async (c) => {
    const svc = new StatusService(c, () => clockAt('06:14'));
    await svc.recordError('/companies', 'page unreachable');
    expect(entry(await load(c), '/companies')).toMatchObject({
      status: 'failed',
      note: 'page unreachable at 12:14',
    });
  });

  dbTest('overall_status follows the endpoints', async (c) => {
    const svc = new StatusService(c, () => clockAt('06:14'));
    await svc.initDay(DAY);
    expect((await load(c)).overall_status).toBe('failed');
    await svc.recordSuccess('/idx', 1);
    expect((await load(c)).overall_status).toBe('partial');
    for (const ep of [
      '/companies',
      '/circuit-breaks',
      '/price-earnings',
      '/trd',
      '/man',
      '/mkistat',
    ]) {
      await svc.recordSuccess(ep, 1);
    }
    expect((await load(c)).overall_status).toBe('ok');
    await svc.recordError('/man', 'MySQL query failed', 'ER_X');
    expect((await load(c)).overall_status).toBe('partial');
  });

  dbTest('updated_at is set on every write', async (c) => {
    let now = clockAt('06:00');
    const svc = new StatusService(c, () => now);
    await svc.initDay(DAY);
    const seen = [(await load(c)).updated_at.getTime()];

    const writes: Array<() => Promise<void>> = [
      () => svc.recordSuccess('/idx', 1),
      () => svc.recordError('/idx', 'MySQL connection lost', 'ECONNRESET'),
      () => svc.recordRecovery('/idx'),
    ];
    for (const write of writes) {
      now = new Date(now.getTime() + 60_000);
      await write();
      seen.push((await load(c)).updated_at.getTime());
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);
  });

  dbTest('concurrent writers do not lose updates', async (c) => {
    const svc = new StatusService(c, () => clockAt('06:14'));
    await svc.initDay(DAY);
    await Promise.all([1, 2, 3].map(() => svc.recordSuccess('/idx', 10)));
    expect(entry(await load(c), '/idx').rows).toBe(30);
  });

  dbTest('an unknown endpoint is logged and never throws', async (c) => {
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const svc = new StatusService(c, () => clockAt('06:14'));
    await expect(svc.recordSuccess('/nope', 1)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('StatusService resilience (no database)', () => {
  let spy: jest.SpyInstance;
  beforeEach(() => {
    spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  it('does not throw when the connection is not ready', async () => {
    const svc = new StatusService({ readyState: 0 } as unknown as Connection);
    await expect(svc.recordError('/idx', 'x')).resolves.toBeUndefined();
    expect(await svc.initDay(DAY)).toBe(false);
  });

  it('gives up after the write timeout instead of blocking the collector', async () => {
    const original = STATUS_CONFIG.writeTimeoutMs;
    STATUS_CONFIG.writeTimeoutMs = 50;
    const hanging = {
      readyState: 1,
      db: {
        collection: () => ({ findOne: () => new Promise(() => undefined) }),
      },
    } as unknown as Connection;
    try {
      const started = Date.now();
      await new StatusService(hanging).recordSuccess('/idx', 1);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    } finally {
      STATUS_CONFIG.writeTimeoutMs = original;
    }
  });
});
