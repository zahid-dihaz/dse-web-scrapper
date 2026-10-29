import { TimeoutError } from 'puppeteer';
import {
  BrowserLaunchError,
  classifyScrapeError,
  ScrapeStructureError,
} from './scrape-errors';

describe('classifyScrapeError', () => {
  it('navigation timeout is "page unreachable"', () => {
    expect(
      classifyScrapeError(
        new TimeoutError('Navigation timeout of 60000 ms exceeded'),
      ),
    ).toEqual({ label: 'page unreachable', detail: '' });
  });

  it.each([
    'net::ERR_NAME_NOT_RESOLVED at https://old.dsebd.org/cbul.php',
    'net::ERR_INTERNET_DISCONNECTED at https://old.dsebd.org/cbul.php',
    'net::ERR_CONNECTION_REFUSED at https://old.dsebd.org/cbul.php',
  ])('network error %s is "page unreachable"', (message) => {
    const result = classifyScrapeError(new Error(message));
    expect(result.label).toBe('page unreachable');
    expect(result.detail).toMatch(/^net::ERR_/);
  });

  it('a selector wait timeout is "page structure changed" with the selector', () => {
    const err = new TimeoutError(
      'Waiting for selector `table.table.table-bordered > tbody > tr` failed: Waiting failed: 30000ms exceeded',
    );
    expect(classifyScrapeError(err)).toEqual({
      label: 'page structure changed',
      detail: 'selector table.table.table-bordered > tbody > tr not found',
    });
  });

  it('a $eval on a missing element is "page structure changed"', () => {
    const err = new Error(
      'Error: failed to find element matching selector "div#section-to-print > h2 > i"',
    );
    expect(classifyScrapeError(err)).toEqual({
      label: 'page structure changed',
      detail: 'selector div#section-to-print > h2 > i not found',
    });
  });

  it('an explicit ScrapeStructureError carries its selector', () => {
    expect(
      classifyScrapeError(new ScrapeStructureError('div#A a.ab1')),
    ).toEqual({
      label: 'page structure changed',
      detail: 'selector div#A a.ab1 not found',
    });
  });

  it.each([
    'Protocol error (Runtime.callFunctionOn): Target closed.',
    'Protocol error: Connection closed. Most likely the page has been closed.',
    'Browser has disconnected',
    'Execution context was destroyed, most likely because of a navigation',
  ])('browser failure "%s" is "browser crashed"', (message) => {
    expect(classifyScrapeError(new Error(message)).label).toBe(
      'browser crashed',
    );
  });

  it('a launch failure (undefined browser) is "browser crashed"', () => {
    expect(classifyScrapeError(new BrowserLaunchError()).label).toBe(
      'browser crashed',
    );
  });

  it('a TypeError from page parsing is "could not parse page"', () => {
    const err = new TypeError(
      "Cannot read properties of null (reading 'nextElementSibling')",
    );
    expect(classifyScrapeError(err).label).toBe('could not parse page');
  });

  it('anything else is kept, truncated', () => {
    const result = classifyScrapeError(new Error('x'.repeat(500)));
    expect(result.label).toBe('scrape failed');
    expect(result.detail).toHaveLength(120);
  });
});
