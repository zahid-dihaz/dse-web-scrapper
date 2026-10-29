import {
  applyError,
  applyRecovery,
  applyStale,
  applySuccess,
  computeOverall,
  EndpointEntry,
  MAX_NOTE_LENGTH,
  newEndpointEntries,
} from './status.logic';

// 12:14 Asia/Dhaka == 06:14 UTC
const at = (hhmmUtc: string) => new Date(`2026-10-07T${hhmmUtc}:00Z`);
const T1214 = at('06:14');
const T1241 = at('06:41');

const fresh = (over: Partial<EndpointEntry> = {}): EndpointEntry => ({
  endpoint: '/idx',
  collection: 'idx_mds',
  source: 'mysql',
  status: 'failed',
  last_success_at: null,
  rows: 0,
  note: null,
  ...over,
});

describe('newEndpointEntries', () => {
  it('creates all seven endpoints as failed with zero rows', () => {
    const entries = newEndpointEntries();
    expect(entries).toHaveLength(7);
    expect(entries.map((e) => e.collection)).toContain('circuitbreaks_dses');
    for (const e of entries) {
      expect(e).toMatchObject({
        status: 'failed',
        rows: 0,
        last_success_at: null,
        note: null,
      });
    }
  });
});

describe('applySuccess', () => {
  it('marks ok, adds rows and sets last_success_at', () => {
    const next = applySuccess(fresh(), 5, T1214);
    expect(next).toMatchObject({
      status: 'ok',
      rows: 5,
      last_success_at: T1214,
    });
    expect(applySuccess(next, 3, T1241).rows).toBe(8);
  });

  it('stays partial once partial earlier that day', () => {
    const partial = fresh({ status: 'partial', rows: 5, note: 'x at 12:14' });
    const next = applySuccess(partial, 5, T1241);
    expect(next.status).toBe('partial');
    expect(next.note).toBe('x at 12:14');
  });

  it('a failed endpoint with an outage note recovers to partial, note kept', () => {
    const failed = fresh({ note: 'page unreachable at 12:14' });
    const next = applySuccess(failed, 1, T1241);
    expect(next.status).toBe('partial');
    expect(next.note).toBe('page unreachable at 12:14');
  });

  it('a failed endpoint that never errored simply becomes ok', () => {
    expect(applySuccess(fresh(), 1, T1241)).toMatchObject({
      status: 'ok',
      note: null,
    });
  });

  it('uses a provided informational note, e.g. zero circuit breaks', () => {
    const next = applySuccess(fresh(), 0, T1214, 'no circuit breaks triggered');
    expect(next).toMatchObject({
      status: 'ok',
      rows: 0,
      note: 'no circuit breaks triggered',
    });
  });

  it('records whole non-negative row counts only', () => {
    expect(applySuccess(fresh(), 2.9, T1214).rows).toBe(2);
    expect(applySuccess(fresh(), -4, T1214).rows).toBe(0);
  });

  it('does not mutate its input', () => {
    const input = fresh();
    applySuccess(input, 5, T1214);
    expect(input.rows).toBe(0);
  });
});

describe('applyError', () => {
  it('is failed when nothing was captured yet', () => {
    const next = applyError(
      fresh(),
      'MySQL connection lost',
      'ECONNRESET',
      T1214,
    );
    expect(next.status).toBe('failed');
    expect(next.note).toBe('MySQL connection lost at 12:14 (ECONNRESET)');
  });

  it('is partial once rows were captured', () => {
    const next = applyError(
      fresh({ status: 'ok', rows: 10 }),
      'page unreachable',
      undefined,
      T1214,
    );
    expect(next.status).toBe('partial');
    expect(next.note).toBe('page unreachable at 12:14');
  });

  it('writes "since" notes for sustained conditions', () => {
    const next = applyError(
      fresh({ status: 'ok', rows: 4 }),
      'source returned no rows',
      undefined,
      T1241,
      { since: T1214 },
    );
    expect(next.note).toBe('source returned no rows since 12:14');
  });

  it('keeps the first note while the outage is ongoing', () => {
    const first = applyError(
      fresh({ status: 'ok', rows: 5 }),
      'lost',
      'A',
      T1214,
    );
    const again = applyError(first, 'lost', 'B', T1241);
    expect(again.note).toBe('lost at 12:14 (A)');
  });

  it('appends a new error after an earlier one was recovered', () => {
    const recovered = fresh({
      status: 'partial',
      rows: 5,
      note: 'lost 12:14–12:41, recovered',
    });
    const next = applyError(recovered, 'lost', undefined, at('08:00'));
    expect(next.note).toBe('lost 12:14–12:41, recovered; lost at 14:00');
  });

  it('replaces an informational note on an ok endpoint', () => {
    const ok = fresh({
      status: 'ok',
      rows: 3,
      note: 'no circuit breaks triggered',
    });
    expect(applyError(ok, 'boom', undefined, T1214).note).toBe('boom at 12:14');
  });

  it('never exceeds the 500 character note limit', () => {
    const next = applyError(fresh(), 'x'.repeat(900), undefined, T1214);
    expect(next.note?.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH);
  });
});

describe('applyRecovery', () => {
  it('shows the gap and stays partial', () => {
    const partial = fresh({
      status: 'partial',
      rows: 5,
      note: 'MySQL connection lost at 12:14 (PROTOCOL_CONNECTION_LOST)',
    });
    const next = applyRecovery(partial, T1241);
    expect(next.status).toBe('partial');
    expect(next.note).toBe('MySQL connection lost 12:14–12:41, recovered');
  });

  it('understands "since" notes', () => {
    const partial = fresh({
      status: 'partial',
      rows: 5,
      note: 'source returned no rows since 12:14',
    });
    expect(applyRecovery(partial, T1241).note).toBe(
      'source returned no rows 12:14–12:41, recovered',
    );
  });

  it('falls back when the note has no time', () => {
    const partial = fresh({ status: 'partial', rows: 5, note: 'weird' });
    expect(applyRecovery(partial, T1241).note).toBe('recovered at 12:41');
  });

  it('is idempotent', () => {
    const once = applyRecovery(
      fresh({ status: 'partial', rows: 5, note: 'lost at 12:14' }),
      T1241,
    );
    expect(applyRecovery(once, at('07:00'))).toBe(once);
  });

  it('leaves ok and failed endpoints untouched', () => {
    const ok = fresh({ status: 'ok', rows: 5 });
    const failed = fresh({ note: 'x at 12:14' });
    expect(applyRecovery(ok, T1241)).toBe(ok);
    expect(applyRecovery(failed, T1241)).toBe(failed);
  });
});

describe('computeOverall', () => {
  const s = (...statuses: EndpointEntry['status'][]) =>
    statuses.map((status) => ({ status }));

  it('is ok only when every endpoint is ok', () => {
    expect(computeOverall(s('ok', 'ok', 'ok'))).toBe('ok');
    expect(computeOverall(s('ok', 'ok', 'partial'))).toBe('partial');
  });

  it('is failed when every endpoint failed', () => {
    expect(computeOverall(s('failed', 'failed'))).toBe('failed');
  });

  it('is partial for any mix', () => {
    expect(computeOverall(s('ok', 'failed'))).toBe('partial');
  });
});

describe('applyStale (watchdog)', () => {
  it('flags an endpoint with no captures as failed', () => {
    const next = applyStale(fresh(), T1214);
    expect(next.status).toBe('failed');
    expect(next.note).toBe('no captures since 12:14, collector not responding');
  });

  it('flags an endpoint that captured earlier as partial', () => {
    const next = applyStale(
      fresh({ status: 'ok', rows: 40, last_success_at: T1214 }),
      T1241,
    );
    expect(next.status).toBe('partial');
  });

  it('a legitimate zero-row capture still counts as a capture (partial, not failed)', () => {
    const entry = fresh({
      endpoint: '/circuit-breaks',
      status: 'ok',
      rows: 0,
      last_success_at: T1214,
    });
    expect(applyStale(entry, T1241).status).toBe('partial');
    expect(applyError(entry, 'page unreachable', undefined, T1241).status).toBe(
      'partial',
    );
  });

  it('empty polls on an endpoint that needs rows are not a capture (failed)', () => {
    const entry = fresh({ status: 'ok', rows: 0, last_success_at: T1214 });
    expect(applyStale(entry, T1241).status).toBe('failed');
    expect(
      applyError(entry, 'source returned no rows', undefined, T1241).status,
    ).toBe('failed');
  });

  it('appends to a more specific collector note, never replaces it', () => {
    const entry = fresh({
      status: 'partial',
      rows: 40,
      note: 'MySQL connection lost at 12:14 (ECONNRESET)',
    });
    expect(applyStale(entry, T1241).note).toBe(
      'MySQL connection lost at 12:14 (ECONNRESET); no captures since 12:41, collector not responding',
    );
  });

  it('is a no-op while its own note is unresolved', () => {
    const once = applyStale(fresh({ status: 'ok', rows: 40 }), T1214);
    expect(applyStale(once, T1241)).toBe(once);
  });

  it('flags again after the previous outage was recovered', () => {
    const recovered = fresh({
      status: 'partial',
      rows: 40,
      note: 'no captures 12:14–12:41, recovered',
    });
    expect(applyStale(recovered, at('08:00')).note).toBe(
      'no captures 12:14–12:41, recovered; no captures since 14:00, collector not responding',
    );
  });
});

describe('applySuccess after a watchdog flag', () => {
  it('resolves the watchdog note into a gap note', () => {
    const flagged = applyStale(fresh({ status: 'ok', rows: 40 }), T1214);
    const next = applySuccess(flagged, 5, T1241);
    expect(next.status).toBe('partial');
    expect(next.note).toBe('no captures 12:14–12:41, recovered');
  });

  it('also works for an endpoint that never captured (failed -> partial)', () => {
    const flagged = applyStale(fresh(), T1214);
    const next = applySuccess(flagged, 5, T1241);
    expect(next).toMatchObject({
      status: 'partial',
      rows: 5,
      note: 'no captures 12:14–12:41, recovered',
    });
  });
});

describe('companies schedule from COMPANIES_SCRAPE_TIME', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cfg = require('./status.config');

  it('defaults to 10:20, cron and 11:00 deadline', () => {
    expect(cfg.companiesScrapeTime(undefined)).toBe('10:20');
    expect(cfg.companiesCron('10:20')).toBe('20 10 * * 0-4');
    expect(cfg.companiesDeadline('10:20')).toBe('11:00');
  });

  it('derives cron and deadline from a custom time', () => {
    expect(cfg.companiesScrapeTime('12:05')).toBe('12:05');
    expect(cfg.companiesCron('12:05')).toBe('5 12 * * 0-4');
    expect(cfg.companiesDeadline('12:05')).toBe('12:45');
  });

  it('falls back on malformed values', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(cfg.companiesScrapeTime('25:99')).toBe('10:20');
    expect(cfg.companiesScrapeTime('abc')).toBe('10:20');
  });
});
