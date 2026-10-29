import { Connection, createConnection } from 'mongoose';
import { MarketHours } from './market-hours';
import { MarketSession } from './market-session';
import { SESSION_COLLECTION } from './status.config';

const TEST_URI =
  process.env.MONGO_TEST_URI ??
  'mongodb://localhost:27017/dse_status_test_hours';
const DAY = '2026-10-07'; // a Wednesday
const at = (utc: string) => new Date(`${DAY}T${utc}:00Z`); // +6h = Dhaka

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
  fetchedAt: at('04:00'),
  ...over,
});

let conn: Connection | undefined;

beforeAll(async () => {
  try {
    conn = await createConnection(TEST_URI, {
      serverSelectionTimeoutMS: 1500,
    }).asPromise();
  } catch (err) {
    console.warn(`Mongo unavailable at ${TEST_URI}; skipping DB tests: ${err}`);
  }
});
afterAll(async () => conn?.close());
beforeEach(async () => {
  await conn?.db.collection(SESSION_COLLECTION).deleteMany({});
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const dbTest = (name: string, fn: (c: Connection) => Promise<void>) =>
  it(name, async () => {
    if (conn) await fn(conn);
  });

describe('MarketHours', () => {
  dbTest(
    'fetches once, stores the day, then reuses the stored doc',
    async (c) => {
      const fetcher = jest.fn().mockResolvedValue(site());
      const hours = new MarketHours(c, () => at('05:00'), fetcher);
      const [a, b] = await Promise.all([
        hours.getSession(),
        hours.getSession(),
      ]);
      expect(a).toMatchObject({
        tradingDay: true,
        closing: '14:00',
        source: 'site',
      });
      expect(b).toEqual(a);
      expect(fetcher).toHaveBeenCalledTimes(1); // concurrent callers share one fetch

      const stored = await c.db
        .collection<any>(SESSION_COLLECTION)
        .findOne({ _id: DAY });
      expect(stored).toMatchObject({ trading_day: true, opening: '10:00' });

      // a fresh process (new instance) reads the stored doc, no site call
      const again = new MarketHours(c, () => at('05:00'), fetcher);
      expect((await again.getSession()).source).toBe('db');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  dbTest('a holiday reported by the site is a closed day', async (c) => {
    const hours = new MarketHours(
      c,
      () => at('05:00'),
      async () => site({ tradingDay: false }),
    );
    expect(await hours.isTradingDay()).toBe(false);
    expect(await hours.isMarketOpen(at('06:00'))).toBe(false);
    expect(await hours.inReportingWindow(at('06:00'))).toBe(false);
  });

  dbTest('market-open and reporting windows use the site hours', async (c) => {
    const hours = new MarketHours(
      c,
      () => at('05:00'),
      async () => site(),
    );
    // Dhaka 09:56 = 03:56Z, 10:00 = 04:00Z, 14:00 = 08:00Z, 14:10 = 08:10Z
    expect(await hours.isMarketOpen(at('03:56'))).toBe(false);
    expect(await hours.inReportingWindow(at('03:56'))).toBe(true);
    expect(await hours.isMarketOpen(at('04:00'))).toBe(true);
    expect(await hours.isMarketOpen(at('08:00'))).toBe(true);
    expect(await hours.isMarketOpen(at('08:01'))).toBe(false);
    expect(await hours.inReportingWindow(at('08:10'))).toBe(true);
    expect(await hours.inReportingWindow(at('08:11'))).toBe(false);
  });

  dbTest(
    'site unreachable: weekday fallback, not stored, retried later',
    async (c) => {
      let now = at('05:00');
      const fetcher = jest.fn().mockRejectedValue(new Error('timeout'));
      const hours = new MarketHours(c, () => now, fetcher);
      const first = await hours.getSession();
      expect(first).toMatchObject({ source: 'fallback', tradingDay: true });
      expect(await c.db.collection(SESSION_COLLECTION).countDocuments()).toBe(
        0,
      );

      await hours.getSession(); // inside the retry throttle: no extra call
      expect(fetcher).toHaveBeenCalledTimes(1);

      now = at('05:05');
      fetcher.mockResolvedValue(site());
      expect((await hours.getSession()).source).toBe('site');
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  dbTest('fallback treats Friday as closed', async (c) => {
    const friday = new Date('2026-10-09T05:00:00Z');
    const hours = new MarketHours(
      c,
      () => friday,
      async () => {
        throw new Error('down');
      },
    );
    expect(await hours.isTradingDay()).toBe(false);
  });

  dbTest('rejects a payload for a different date', async (c) => {
    const hours = new MarketHours(
      c,
      () => at('05:00'),
      async () => site({ date: '2026-10-08' }),
    );
    expect((await hours.getSession()).source).toBe('fallback');
    expect(await c.db.collection(SESSION_COLLECTION).countDocuments()).toBe(0);
  });
});
