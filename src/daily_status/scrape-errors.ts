import { ClassifiedError } from './mysql-errors';

// Turns whatever a Puppeteer scrape threw into one of the status notes:
//   page unreachable / page structure changed (selector x not found) /
//   browser crashed / could not parse page.

/** The page loaded but an expected selector/table/header was not there. */
export class ScrapeStructureError extends Error {
  constructor(public readonly selector: string) {
    super(`selector ${selector} not found`);
    this.name = 'ScrapeStructureError';
  }
}

/** puppeteer.launch() failed (the browser starter swallows it and returns undefined). */
export class BrowserLaunchError extends Error {
  constructor(message = 'browser could not be launched') {
    super(message);
    this.name = 'BrowserLaunchError';
  }
}

const SELECTOR_WAIT = /Waiting for selector [`'"](.+?)[`'"] failed/;
const SELECTOR_EVAL =
  /failed to find element matching selector ["'`](.+?)["'`]/i;
const BROWSER_GONE =
  /Target closed|Session closed|Protocol error|Browser has disconnected|Connection closed|browser has been closed|Navigating frame was detached|Execution context was destroyed|Page crashed/i;
const UNREACHABLE =
  /Navigation timeout|net::ERR_|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|getaddrinfo|socket hang up/i;

export function classifyScrapeError(err: unknown): ClassifiedError {
  const e = err as { name?: string; message?: string };
  const message = String(e?.message ?? err);

  if (err instanceof ScrapeStructureError) {
    return { label: 'page structure changed', detail: message };
  }
  const selector =
    message.match(SELECTOR_WAIT)?.[1] ?? message.match(SELECTOR_EVAL)?.[1];
  if (selector) {
    return {
      label: 'page structure changed',
      detail: `selector ${selector} not found`,
    };
  }
  if (err instanceof BrowserLaunchError || BROWSER_GONE.test(message)) {
    return { label: 'browser crashed', detail: '' };
  }
  if (e?.name === 'TimeoutError' || UNREACHABLE.test(message)) {
    const code = message.match(/net::ERR_[A-Z_]+|E[A-Z]{4,}/)?.[0];
    return { label: 'page unreachable', detail: code ?? '' };
  }
  if (
    err instanceof TypeError ||
    err instanceof SyntaxError ||
    /Cannot read propert|is not a function|Unexpected token|parse/i.test(
      message,
    )
  ) {
    return { label: 'could not parse page', detail: '' };
  }
  return { label: 'scrape failed', detail: message.slice(0, 120) };
}
