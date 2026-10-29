import { TimeoutError } from 'puppeteer';
import CircuitBreakerScraper from './circuitBreakerScrapper';

const HEADER = [
  '#',
  'Trade Code',
  'Breaker %',
  'Tick Size',
  'Open Adj. Price',
  'Lower Limit',
  'Upper Limit',
];
const ROWS = [
  { rowIndex: 0, cellCount: 0, cells: [] },
  { rowIndex: 1, cellCount: 0, cells: [] },
  {
    rowIndex: 2,
    cellCount: 7,
    cells: ['1', '1STPRIMFMF', '10.00', '0.10', '25.90', '23.40', '28.40'],
  },
];

function fakePage(opts: {
  rows?: any[];
  headers?: string[];
  waitError?: Error;
}) {
  const page: any = {
    on: jest.fn(),
    goto: jest.fn().mockResolvedValue({ status: () => 200 }),
    waitForSelector: opts.waitError
      ? jest.fn().mockRejectedValue(opts.waitError)
      : jest.fn().mockResolvedValue(undefined),
    $$eval: jest.fn(async (selector: string) =>
      selector.endsWith(' th') ? opts.headers ?? HEADER : opts.rows ?? ROWS,
    ),
    screenshot: jest.fn().mockRejectedValue(new Error('Target closed')),
    content: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return page;
}

const build = () => {
  const service = {
    upsertCircuitBreakerEntity: jest.fn().mockResolvedValue(undefined),
  };
  return { service, scraper: new CircuitBreakerScraper(service as any) };
};

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('CircuitBreakerScraper', () => {
  it('stores rows and returns the count', async () => {
    const { scraper, service } = build();
    const page = fakePage({});
    const result = await scraper.scraper({ newPage: async () => page });
    expect(result).toEqual({ rows: 1 });
    expect(service.upsertCircuitBreakerEntity).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalled();
  });

  it('zero data rows with the table header present is ok: "no circuit breaks triggered"', async () => {
    const { scraper, service } = build();
    const page = fakePage({ rows: ROWS.slice(0, 2) });
    const result = await scraper.scraper({ newPage: async () => page });
    expect(result).toEqual({ rows: 0, note: 'no circuit breaks triggered' });
    expect(service.upsertCircuitBreakerEntity).not.toHaveBeenCalled();
  });

  it('zero rows and no table header is a structure failure, not "no breaks"', async () => {
    const { scraper } = build();
    const page = fakePage({ rows: [], headers: [] });
    await expect(
      scraper.scraper({ newPage: async () => page }),
    ).rejects.toThrow(/Trade Code/);
    expect(page.close).toHaveBeenCalled();
  });

  it('a missing table (selector wait timeout) propagates and the page is closed', async () => {
    const { scraper } = build();
    const err = new TimeoutError('Waiting for selector `table` failed');
    const page = fakePage({ waitError: err });
    await expect(scraper.scraper({ newPage: async () => page })).rejects.toBe(
      err,
    );
    expect(page.close).toHaveBeenCalled(); // and diagnostics failing did not mask err
  });
});
