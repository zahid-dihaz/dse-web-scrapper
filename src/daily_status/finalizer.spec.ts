import { Connection, createConnection } from 'mongoose';
import { bootstrapStatusCollections } from './bootstrap';
import { finalizeEndpoints, runFinalizer } from './finalizer';
import { MarketHours } from './market-hours';
import { MarketSession } from './market-session';
import { EndpointEntry, newEndpointEntries } from './status.logic';
import { SESSION_COLLECTION, STATUS_COLLECTION } from './status.config';
import { StatusService } from './status.service';

const TEST_URI =
  process.env.MONGO_TEST_URI ??
  'mongodb://localhost:27017/dse_status_test_finalizer';
const DAY = '2026-10-07'; // Wednesday
const dhaka = (hhmm: string, day = DAY) => new Date(`${day}T${hhmm}:00+06:00`);
const ALL = [
  '/companies',
  '/circuit-breaks',
  '/price-earnings',
  '/idx',
  '/trd',
  '/man',
  '/mkistat',
];

const site = (over: Partial<MarketSession> = {}): MarketSession => ({
  date: DAY,
  tradingDay: true,
  isOpen: false,
  phase: 'closed',
  times: {
    preOpening: '09:55',
    opening: '10:00',
    closing: '14:00',
    postClosing: '14:10',
  },
  fetchedAt: dhaka('15:00'),
  ...over,
});

const trdOk = {
  lastUpdate: dhaka('14:40'),
  totalTrades: 172590,
  totalVolume: 174532023,
};
const ctx = (over: object = {}) => ({
  date: DAY,
  opening: '10:00',
  closing: '14:00',
  trd: trdOk,
  ...over,
});
const healthy = (): EndpointEntry[] =>
  newEndpointEntries().map((e) => ({
    ...e,
    status: 'ok' as const,
    rows: 100,
    last_success_at:
      e.endpoint === '/companies' ? dhaka('10:25') : dhaka('13:58'),
  }));

describe('finalizeEndpoints (pure)', () => {
  it('leaves a healthy day untouched', () => {
    const entries = healthy();
    expect(finalizeEndpoints(entries, ctx())).toEqual(entries);
  });

  it('flags an endpoint that stopped well before the close', () => {
    const entries = healthy().map((e) =>
      e.endpoint === '/idx' ? { ...e, last_success_at: dhaka('12:30') } : e,
    );
    const idx = finalizeEndpoints(entries, ctx()).find(
      (e) => e.endpoint === '/idx',
    )!;
    expect(idx.status).toBe('partial');
    expect(idx.note).toBe('no captures since 12:30, collector not responding');
  });

  it('flags /companies if it never captured', () => {
    const entries = healthy().map((e) =>
      e.endpoint === '/companies'
        ? { ...e, status: 'failed' as const, last_success_at: null, rows: 0 }
        : e,
    );
    const c = finalizeEndpoints(entries, ctx()).find(
      (e) => e.endpoint === '/companies',
    )!;
    expect(c.status).toBe('failed');
    expect(c.note).toMatch(/no captures since 10:00/);
  });

  it('adds a note to a non-ok endpoint that lacks one', () => {
    const entries = healthy().map((e) =>
      e.endpoint === '/man'
        ? { ...e, status: 'partial' as const }
        : e.endpoint === '/mkistat'
        ? { ...e, status: 'failed' as const, last_success_at: null, rows: 0 }
        : e,
    );
    const out = finalizeEndpoints(entries, ctx());
    expect(out.find((e) => e.endpoint === '/man')!.note).toBe(
      'incomplete capture, no detail recorded',
    );
    // mkistat never captured: the stale check explains it
    expect(out.find((e) => e.endpoint === '/mkistat')!.note).toMatch(
      /no captures since/,
    );
  });

  it('keeps a specific collector note and appends rather than replaces', () => {
    const entries = healthy().map((e) =>
      e.endpoint === '/idx'
        ? {
            ...e,
            status: 'partial' as const,
            note: 'MySQL connection lost 12:14–12:41, recovered',
          }
        : e,
    );
    const idx = finalizeEndpoints(entries, ctx()).find(
      (e) => e.endpoint === '/idx',
    )!;
    expect(idx.note).toBe('MySQL connection lost 12:14–12:41, recovered');
  });

  describe('trd_mds sanity (one market-wide document per day)', () => {
    const trd = (entries: EndpointEntry[]) =>
      entries.find((e) => e.endpoint === '/trd')!;

    it('missing document', () => {
      const t = trd(finalizeEndpoints(healthy(), ctx({ trd: null })));
      expect(t.status).toBe('partial');
      expect(t.note).toBe(`trd_mds has no document for ${DAY}`);
    });

    it('zero totals', () => {
      const t = trd(
        finalizeEndpoints(
          healthy(),
          ctx({ trd: { ...trdOk, totalTrades: 0 } }),
        ),
      );
      expect(t.note).toBe('trd_mds totals are zero');
    });

    it('last updated before the close', () => {
      const t = trd(
        finalizeEndpoints(
          healthy(),
          ctx({ trd: { ...trdOk, lastUpdate: dhaka('13:20') } }),
        ),
      );
      expect(t.note).toBe('trd_mds last updated 13:20, before the 14:00 close');
    });

    it('accepts an update shortly before the close and any time after it', () => {
      for (const at of ['13:51', '14:00', '14:40']) {
        const t = trd(
          finalizeEndpoints(
            healthy(),
            ctx({ trd: { ...trdOk, lastUpdate: dhaka(at) } }),
          ),
        );
        expect(t.status).toBe('ok');
      }
    });
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
  for (const c of [STATUS_COLLECTION, SESSION_COLLECTION, 'trd_mds']) {
    await conn?.db.collection(c).deleteMany({});
  }
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const dbTest = (name: string, fn: (c: Connection) => Promise<void>) =>
  it(name, async () => {
    if (conn) await fn(conn);
  });

const hoursFor = (c: Connection, session: MarketSession | Error) =>
  new MarketHours(
    c,
    () => dhaka('15:05'),
    async () => {
      if (session instanceof Error) throw session;
      return session;
    },
  );
const load = (c: Connection, date = DAY) =>
  c.db.collection<any>(STATUS_COLLECTION).findOne({ _id: date });
const entry = (doc: any, ep: string) =>
  doc.endpoints.find((e: any) => e.endpoint === ep);
const putTrd = (c: Connection, over: object = {}) =>
  c.db.collection('trd_mds').insertOne({
    TRD_SNO: 1,
    TRD_TOTAL_TRADES: 172590,
    TRD_TOTAL_VOLUME: 174532023,
    TRD_TOTAL_VALUE: 5332.06,
    TRD_LM_DATE_TIME: dhaka('14:40'),
    ...over,
  });
async function healthyDay(c: Connection) {
  let now = dhaka('10:25');
  const svc = new StatusService(c, () => now);
  await svc.recordSuccess('/companies', 400);
  now = dhaka('13:58');
  for (const ep of ALL.filter((e) => e !== '/companies'))
    await svc.recordSuccess(ep, 10);
}

describe('runFinalizer (mongo)', () => {
  dbTest(
    'open day where all seven endpoints are ok finalizes as ok, unchanged',
    async (c) => {
      await healthyDay(c);
      await putTrd(c);
      const r = await runFinalizer(c, DAY, dhaka('15:05'), hoursFor(c, site()));
      expect(r).toMatchObject({
        exchange_open: true,
        overall_status: 'ok',
        changed: false, // collectors already left it fully ok: nothing to rewrite
      });
      const doc = await load(c);
      expect(doc).toMatchObject({ exchange_open: true, overall_status: 'ok' });
      expect(doc.endpoints.every((e: any) => e.status === 'ok')).toBe(true);
    },
  );

  dbTest(
    'open day with a dead endpoint and a missing trd doc is partial with notes',
    async (c) => {
      let now = dhaka('10:25');
      const svc = new StatusService(c, () => now);
      await svc.recordSuccess('/companies', 400);
      now = dhaka('13:58');
      for (const ep of [
        '/circuit-breaks',
        '/price-earnings',
        '/idx',
        '/trd',
        '/man',
      ]) {
        await svc.recordSuccess(ep, 10);
      } // /mkistat never wrote; no trd_mds document

      const r = await runFinalizer(c, DAY, dhaka('15:05'), hoursFor(c, site()));
      expect(r.overall_status).toBe('partial');
      const doc = await load(c);
      expect(entry(doc, '/mkistat')).toMatchObject({ status: 'failed' });
      expect(entry(doc, '/mkistat').note).toMatch(/no captures since 10:00/);
      expect(entry(doc, '/trd')).toMatchObject({
        status: 'partial',
        note: `trd_mds has no document for ${DAY}`,
      });
      for (const e of doc.endpoints.filter((x: any) => x.status !== 'ok'))
        expect(e.note).toBeTruthy();
    },
  );

  dbTest('is idempotent: a second run rewrites nothing', async (c) => {
    await healthyDay(c);
    await putTrd(c, { TRD_LM_DATE_TIME: dhaka('13:20') });
    await runFinalizer(c, DAY, dhaka('15:05'), hoursFor(c, site()));
    const first = await load(c);

    const again = await runFinalizer(
      c,
      DAY,
      dhaka('16:00'),
      hoursFor(c, site()),
    );
    expect(again.changed).toBe(false);
    expect(await load(c)).toEqual(first); // including updated_at
  });

  dbTest(
    'a closed day gets exchange_open=false, "closed" and no endpoints',
    async (c) => {
      const closed = site({ tradingDay: false });
      const r = await runFinalizer(c, DAY, dhaka('15:05'), hoursFor(c, closed));
      expect(r).toMatchObject({
        exchange_open: false,
        overall_status: 'closed',
      });
      expect(await load(c)).toMatchObject({
        exchange_open: false,
        overall_status: 'closed',
        endpoints: [],
      });
      expect(await c.db.collection(STATUS_COLLECTION).countDocuments()).toBe(1);
    },
  );

  dbTest(
    'closed day is idempotent and replaces a wrongly-open record',
    async (c) => {
      const svc = new StatusService(c, () => dhaka('10:00'));
      await svc.initDay(DAY); // e.g. created while the site was unreachable
      const closed = site({ tradingDay: false });
      const first = await runFinalizer(
        c,
        DAY,
        dhaka('15:05'),
        hoursFor(c, closed),
      );
      expect(first.changed).toBe(true);
      const doc1 = await load(c);
      expect(doc1).toMatchObject({ exchange_open: false, endpoints: [] });
      expect(doc1.generated_at).toEqual(dhaka('10:00')); // original creation time kept

      const second = await runFinalizer(
        c,
        DAY,
        dhaka('15:30'),
        hoursFor(c, closed),
      );
      expect(second.changed).toBe(false);
      expect(await load(c)).toEqual(doc1);
    },
  );

  dbTest(
    'manual re-run of a past day uses its stored session and corrects the record',
    async (c) => {
      const past = '2026-10-04'; // Sunday
      await c.db.collection<any>(SESSION_COLLECTION).insertOne({
        _id: past,
        trading_day: true,
        is_open: false,
        phase: 'closed',
        pre_opening: '09:55',
        opening: '10:00',
        closing: '14:00',
        post_closing: '14:10',
        fetched_at: dhaka('09:00', past),
      });
      // finalizer never ran that day, collectors left a half-finished record
      const svc = new StatusService(c, () => dhaka('11:00', past));
      await svc.recordSuccess('/idx', 5);

      const r = await runFinalizer(
        c,
        past,
        dhaka('15:05'),
        hoursFor(c, new Error('site only has today')),
      );
      expect(r).toMatchObject({
        date: past,
        exchange_open: true,
        overall_status: 'partial',
      });
      const doc = await load(c, past);
      expect(entry(doc, '/idx').note).toMatch(/no captures since 11:00/);
      expect(entry(doc, '/mkistat').status).toBe('failed');
    },
  );

  dbTest(
    'a past day with no stored session falls back to the weekday rule',
    async (c) => {
      const friday = '2026-10-02';
      const r = await runFinalizer(
        c,
        friday,
        dhaka('15:05'),
        hoursFor(c, new Error('down')),
      );
      expect(r).toMatchObject({
        exchange_open: false,
        overall_status: 'closed',
      });
      expect(await load(c, friday)).toMatchObject({ endpoints: [] });
    },
  );

  dbTest(
    'with the site down it trusts the existing record over the weekday guess',
    async (c) => {
      await healthyDay(c);
      await putTrd(c);
      const r = await runFinalizer(
        c,
        DAY,
        dhaka('15:05'),
        hoursFor(c, new Error('down')),
      );
      expect(r.exchange_open).toBe(true); // collectors wrote today, so it was open
    },
  );
});
