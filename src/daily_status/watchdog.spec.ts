import { Connection, createConnection } from 'mongoose';
import { bootstrapStatusCollections } from './bootstrap';
import { MarketHours } from './market-hours';
import { MarketSession } from './market-session';
import { STATUS_COLLECTION, SESSION_COLLECTION } from './status.config';
import { StatusService } from './status.service';
import { findStale, runWatchdog } from './watchdog';

const TEST_URI =
  process.env.MONGO_TEST_URI ??
  'mongodb://localhost:27017/dse_status_test_watchdog';
const DAY = '2026-10-07'; // Wednesday
const at = (dhaka: string) => new Date(`${DAY}T${dhaka}:00+06:00`);
const OPEN = '10:00';

const site = (over: Partial<MarketSession> = {}): MarketSession => ({
  date: DAY,
  tradingDay: true,
  isOpen: true,
  phase: 'open',
  times: {
    preOpening: '09:55',
    opening: '10:00',
    closing: '14:00',
    postClosing: '14:10',
  },
  fetchedAt: at('09:00'),
  ...over,
});

describe('findStale (pure)', () => {
  const entry = (endpoint: string, last: Date | null) => ({
    endpoint,
    last_success_at: last,
  });
  const all = (last: Date | null) =>
    [
      '/companies',
      '/circuit-breaks',
      '/price-earnings',
      '/idx',
      '/trd',
      '/man',
      '/mkistat',
    ].map((e) => entry(e, e === '/companies' ? at('10:25') : last));

  it('nothing is stale while every endpoint is within its threshold', () => {
    expect(
      findStale({ endpoints: all(at('11:55')) as any }, DAY, OPEN, at('12:05')),
    ).toEqual([]);
  });

  it('flags interval endpoints older than the threshold', () => {
    const doc = { endpoints: all(at('11:55')) as any };
    const stale = findStale(doc, DAY, OPEN, at('12:20')); // 25 min > 15
    expect(stale.map((s) => s.endpoint)).toContain('/idx');
    expect(stale.find((s) => s.endpoint === '/idx')!.since).toEqual(
      at('11:55'),
    );
  });

  it('with no captures at all, measures from the session opening', () => {
    expect(
      findStale(null, DAY, OPEN, at('10:10')).map((s) => s.endpoint),
    ).not.toContain('/idx');
    const stale = findStale(null, DAY, OPEN, at('10:16'));
    expect(stale.find((s) => s.endpoint === '/idx')!.since).toEqual(
      at('10:00'),
    );
  });

  it('once-a-day /companies is only stale after its deadline', () => {
    const noCompanies = {
      endpoints: all(at('10:55')).map((e) =>
        e.endpoint === '/companies' ? { ...e, last_success_at: null } : e,
      ) as any,
    };
    expect(
      findStale(noCompanies, DAY, OPEN, at('10:59')).map((s) => s.endpoint),
    ).not.toContain('/companies');
    expect(
      findStale(noCompanies, DAY, OPEN, at('11:00')).map((s) => s.endpoint),
    ).toContain('/companies');
  });

  it('/companies captured early is never stale however old', () => {
    const doc = { endpoints: all(at('13:55')) as any };
    expect(
      findStale(doc, DAY, OPEN, at('13:59')).map((s) => s.endpoint),
    ).not.toContain('/companies');
  });
});

let conn: Connection | undefined;

beforeAll(async () => {
  try {
    conn = await createConnection(TEST_URI, {
      serverSelectionTimeoutMS: 1500,
    }).asPromise();
    await bootstrapStatusCollections(conn);
  } catch (err) {
    console.warn(`Mongo unavailable at ${TEST_URI}; skipping DB tests: ${err}`);
  }
});
afterAll(async () => conn?.close());
beforeEach(async () => {
  await conn?.db.collection(STATUS_COLLECTION).deleteMany({});
  await conn?.db.collection(SESSION_COLLECTION).deleteMany({});
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const dbTest = (name: string, fn: (c: Connection) => Promise<void>) =>
  it(name, async () => {
    if (conn) await fn(conn);
  });

const hoursFor = (c: Connection, now: Date, session = site()) =>
  new MarketHours(
    c,
    () => now,
    async () => session,
  );
const load = (c: Connection) =>
  c.db.collection<any>(STATUS_COLLECTION).findOne({ _id: DAY });
const entry = (doc: any, ep: string) =>
  doc.endpoints.find((e: any) => e.endpoint === ep);

describe('runWatchdog (mongo)', () => {
  dbTest(
    'flags a poller that stopped capturing, with a note, as partial',
    async (c) => {
      let now = at('10:00');
      const svc = new StatusService(c, () => now);
      for (const ep of [
        '/companies',
        '/circuit-breaks',
        '/price-earnings',
        '/idx',
        '/trd',
        '/man',
        '/mkistat',
      ]) {
        await svc.recordSuccess(ep, 10);
      }
      // everything keeps reporting except /idx, which died after 10:00
      now = at('12:10');
      for (const ep of [
        '/circuit-breaks',
        '/price-earnings',
        '/trd',
        '/man',
        '/mkistat',
      ]) {
        await svc.recordSuccess(ep, 10);
      }

      const result = await runWatchdog(
        c,
        at('12:14'),
        hoursFor(c, at('12:14')),
      );
      expect(result.flagged).toEqual(['/idx']);
      const doc = await load(c);
      expect(entry(doc, '/idx')).toMatchObject({
        status: 'partial',
        note: 'no captures since 10:00, collector not responding',
      });
      expect(entry(doc, '/trd').status).toBe('ok');
      expect(doc.overall_status).toBe('partial');
    },
  );

  dbTest(
    'collection stopped after pre-open: everything flagged failed, day created',
    async (c) => {
      // nothing ever wrote today
      const result = await runWatchdog(
        c,
        at('10:20'),
        hoursFor(c, at('10:20')),
      );
      expect(result.flagged).toEqual([
        '/circuit-breaks',
        '/price-earnings',
        '/idx',
        '/trd',
        '/man',
        '/mkistat',
      ]);
      const doc = await load(c);
      expect(entry(doc, '/idx')).toMatchObject({ status: 'failed', rows: 0 });
      expect(entry(doc, '/idx').note).toMatch(
        /no captures since 10:00, collector not responding/,
      );
      expect(entry(doc, '/companies').note).toBeNull(); // deadline 11:00 not reached
      expect(doc.overall_status).toBe('failed');
    },
  );

  dbTest(
    'appends to an existing collector note and is idempotent',
    async (c) => {
      let now = at('10:00');
      const svc = new StatusService(c, () => now);
      await svc.recordSuccess('/trd', 10);
      now = at('12:14');
      await svc.recordError('/trd', 'MySQL connection lost', 'ECONNRESET');

      await runWatchdog(c, at('12:30'), hoursFor(c, at('12:30')));
      const first = entry(await load(c), '/trd');
      expect(first.note).toBe(
        'MySQL connection lost at 12:14 (ECONNRESET); no captures since 10:00, collector not responding',
      );

      const before = (await load(c)).updated_at;
      await runWatchdog(c, at('12:40'), hoursFor(c, at('12:40')));
      const after = await load(c);
      expect(entry(after, '/trd').note).toBe(first.note); // not appended twice
      expect(after.updated_at.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
    },
  );

  dbTest(
    'a collector that resumes resolves the watchdog note itself',
    async (c) => {
      let now = at('10:00');
      const svc = new StatusService(c, () => now);
      await svc.recordSuccess('/idx', 10);
      await runWatchdog(c, at('12:14'), hoursFor(c, at('12:14')));
      now = at('12:41');
      await svc.recordSuccess('/idx', 5);
      expect(entry(await load(c), '/idx')).toMatchObject({
        status: 'partial',
        note: 'no captures 10:00–12:41, recovered',
      });
    },
  );

  dbTest('is silent outside market hours', async (c) => {
    for (const when of ['09:30', '14:30', '20:00']) {
      const result = await runWatchdog(c, at(when), hoursFor(c, at(when)));
      expect(result).toEqual({ skipped: 'market closed', flagged: [] });
    }
    expect(await load(c)).toBeNull(); // not even a day record
  });

  dbTest('is silent on a day the exchange is closed', async (c) => {
    const holiday = hoursFor(
      c,
      at('12:14'),
      site({ tradingDay: false, isOpen: false }),
    );
    const result = await runWatchdog(c, at('12:14'), holiday);
    expect(result).toEqual({ skipped: 'market closed', flagged: [] });
    expect(await load(c)).toBeNull();
  });
});
