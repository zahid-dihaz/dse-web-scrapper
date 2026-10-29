import { TimeoutError } from 'puppeteer';
import ScrapeRunner from './scrape-runner';

function setup(windowOpen = true) {
  const status = {
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    recordError: jest.fn().mockResolvedValue(undefined),
    recordRecovery: jest.fn().mockResolvedValue(undefined),
  };
  const hours = { inReportingWindow: jest.fn().mockResolvedValue(windowOpen) };
  const runner = new ScrapeRunner(status as any, hours as any);
  const browser = { close: jest.fn().mockResolvedValue(undefined) };
  return { runner, status, browser };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('ScrapeRunner', () => {
  it('reports success with the row count and closes the browser', async () => {
    const { runner, status, browser } = setup();
    await runner.run('/price-earnings', Promise.resolve(browser), async () => ({
      rows: 396,
    }));
    expect(status.recordSuccess).toHaveBeenCalledWith('/price-earnings', 396);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('passes an informational note through', async () => {
    const { runner, status, browser } = setup();
    await runner.run('/circuit-breaks', Promise.resolve(browser), async () => ({
      rows: 0,
      note: 'no circuit breaks triggered',
    }));
    expect(status.recordSuccess).toHaveBeenCalledWith(
      '/circuit-breaks',
      0,
      'no circuit breaks triggered',
    );
    expect(status.recordError).not.toHaveBeenCalled();
  });

  it('a navigation timeout is reported as unreachable; browser still closed', async () => {
    const { runner, status, browser } = setup();
    await runner.run('/companies', Promise.resolve(browser), async () => {
      throw new TimeoutError('Navigation timeout of 30000 ms exceeded');
    });
    expect(status.recordError).toHaveBeenCalledWith(
      '/companies',
      'page unreachable',
      '',
    );
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('a missing selector is reported as a structure change', async () => {
    const { runner, status, browser } = setup();
    await runner.run('/circuit-breaks', Promise.resolve(browser), async () => {
      throw new TimeoutError(
        'Waiting for selector `table.x > tbody > tr` failed: 30000ms',
      );
    });
    expect(status.recordError).toHaveBeenCalledWith(
      '/circuit-breaks',
      'page structure changed',
      'selector table.x > tbody > tr not found',
    );
  });

  it('a browser crash mid-scrape is reported; a failing close() does not throw', async () => {
    const { runner, status, browser } = setup();
    browser.close.mockRejectedValue(new Error('already dead'));
    await expect(
      runner.run('/price-earnings', Promise.resolve(browser), async () => {
        throw new Error('Protocol error (Page.navigate): Target closed.');
      }),
    ).resolves.toBeUndefined();
    expect(status.recordError).toHaveBeenCalledWith(
      '/price-earnings',
      'browser crashed',
      '',
    );
  });

  it('an undefined browser (launch failed) is reported, not thrown', async () => {
    const { runner, status } = setup();
    const scrape = jest.fn();
    await expect(
      runner.run('/companies', Promise.resolve(undefined), scrape),
    ).resolves.toBeUndefined();
    expect(scrape).not.toHaveBeenCalled();
    expect(status.recordError).toHaveBeenCalledWith(
      '/companies',
      'browser crashed',
      '',
    );
  });

  it('a rejected browser promise is reported, not thrown', async () => {
    const { runner, status } = setup();
    await runner.run(
      '/companies',
      Promise.reject(new Error('launch exploded')),
      jest.fn(),
    );
    expect(status.recordError).toHaveBeenCalled();
  });

  it('reports nothing outside the reporting window but still closes the browser', async () => {
    const { runner, status, browser } = setup(false);
    await runner.run('/companies', Promise.resolve(browser), async () => ({
      rows: 5,
    }));
    expect(status.recordSuccess).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });
});
