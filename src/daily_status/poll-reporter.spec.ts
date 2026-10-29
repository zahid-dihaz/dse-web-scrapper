import { PollReporter } from './poll-reporter';
import { classifyMysqlError } from './mysql-errors';
import { MarketHours } from './market-hours';
import { StatusService } from './status.service';

const at = (utc: string) => new Date(`2026-10-07T${utc}:00Z`); // +6h = Dhaka

function setup(endpoint = '/idx', windowOpen = true) {
  let now = at('06:00');
  const status = {
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordError: jest.fn().mockResolvedValue(undefined),
    recordRecovery: jest.fn().mockResolvedValue(undefined),
  };
  const hours = { inReportingWindow: jest.fn().mockResolvedValue(windowOpen) };
  const reporter = new PollReporter(
    status as unknown as StatusService,
    hours as unknown as MarketHours,
    endpoint,
    () => now,
  );
  return {
    reporter,
    status,
    hours,
    tick: (utc: string) => (now = at(utc)),
  };
}

describe('classifyMysqlError', () => {
  it.each([
    'PROTOCOL_CONNECTION_LOST',
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ER_CON_COUNT_ERROR',
  ])('%s is connection loss', (code) => {
    expect(classifyMysqlError({ code })).toEqual({
      label: 'MySQL connection lost',
      detail: code,
    });
  });

  it('treats an acquire/connect timeout without a code as connection loss', () => {
    expect(classifyMysqlError({ message: 'connect timed out' }).label).toBe(
      'MySQL connection lost',
    );
  });

  it('other errors are query failures; unknown connect errors say connect', () => {
    expect(classifyMysqlError({ code: 'ER_PARSE_ERROR' })).toEqual({
      label: 'MySQL query failed',
      detail: 'ER_PARSE_ERROR',
    });
    expect(
      classifyMysqlError({ code: 'ER_ACCESS_DENIED_ERROR' }, 'connect').label,
    ).toBe('MySQL connect failed');
  });
});

describe('PollReporter', () => {
  it('records success with the row count', async () => {
    const { reporter, status } = setup();
    await reporter.success(12);
    expect(status.recordSuccess).toHaveBeenCalledWith('/idx', 12);
  });

  it('reports nothing outside the reporting window', async () => {
    const { reporter, status } = setup('/idx', false);
    await reporter.success(5);
    await reporter.error({
      label: 'MySQL connection lost',
      detail: 'ECONNRESET',
    });
    expect(status.recordSuccess).not.toHaveBeenCalled();
    expect(status.recordError).not.toHaveBeenCalled();
  });

  it('forwards the classified error', async () => {
    const { reporter, status } = setup('/trd');
    await reporter.error(
      classifyMysqlError({ code: 'PROTOCOL_CONNECTION_LOST' }),
    );
    expect(status.recordError).toHaveBeenCalledWith(
      '/trd',
      'MySQL connection lost',
      'PROTOCOL_CONNECTION_LOST',
    );
  });

  it('writes the recovery note on the first successful poll after an error', async () => {
    const { reporter, status } = setup();
    await reporter.success(3); // startup: needsRecovery is true, then cleared
    status.recordRecovery.mockClear();

    await reporter.success(3);
    expect(status.recordRecovery).not.toHaveBeenCalled();

    await reporter.error({
      label: 'MySQL connection lost',
      detail: 'ECONNRESET',
    });
    await reporter.success(4);
    expect(status.recordRecovery).toHaveBeenCalledTimes(1);
    await reporter.success(4);
    expect(status.recordRecovery).toHaveBeenCalledTimes(1);
  });

  describe('empty polls', () => {
    it('stay quiet below the limit but still count as a heartbeat', async () => {
      const { reporter, status } = setup();
      await reporter.success(0);
      await reporter.success(0);
      expect(status.recordSuccess).toHaveBeenCalledTimes(2);
      expect(status.recordError).not.toHaveBeenCalled();
    });

    it('flag "since <first empty poll>" once the limit is reached', async () => {
      const { reporter, status, tick } = setup();
      tick('06:14');
      await reporter.success(0);
      tick('06:19');
      await reporter.success(0);
      tick('06:24');
      await reporter.success(0);
      expect(status.recordError).toHaveBeenCalledWith(
        '/idx',
        'source returned no rows',
        undefined,
        { since: at('06:14') },
      );
    });

    it('a non-empty poll resets the count and triggers recovery', async () => {
      const { reporter, status, tick } = setup();
      for (const t of ['06:00', '06:05', '06:10']) {
        tick(t);
        await reporter.success(0);
      }
      status.recordRecovery.mockClear();
      tick('06:15');
      await reporter.success(7);
      expect(status.recordRecovery).toHaveBeenCalledTimes(1);

      status.recordError.mockClear();
      await reporter.success(0);
      await reporter.success(0);
      expect(status.recordError).not.toHaveBeenCalled(); // count restarted
    });

    it('are never flagged for endpoints where zero rows is legitimate', async () => {
      const { reporter, status } = setup('/man');
      for (let i = 0; i < 10; i++) await reporter.success(0);
      expect(status.recordError).not.toHaveBeenCalled();
    });
  });
});
