import { get } from 'https';
import { STATUS_CONFIG } from './status.config';

// Market open/closed status as published by the DSE site (the same JSON its
// own front end polls: `session` inside /api/live/market). Uses `https`
// rather than fetch because the Docker image runs Node 14.

export interface SessionTimes {
  preOpening: string; // Dhaka HH:mm
  opening: string;
  closing: string;
  postClosing: string;
}

export interface MarketSession {
  /** Dhaka date the session info belongs to, "YYYY-MM-DD". */
  date: string;
  /** DSE says this date is a trading day (false on weekends and holidays). */
  tradingDay: boolean;
  /** Live flag at fetch time. */
  isOpen: boolean;
  /** e.g. "closed", as reported by the site. */
  phase: string;
  times: SessionTimes;
  fetchedAt: Date;
}

const HHMM = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Pure parser: throws if the payload does not have the expected shape. */
export function parseMarketSession(
  payload: any,
  fetchedAt: Date = new Date(),
): MarketSession {
  const s = payload?.session;
  const today = s?.today;
  const date = today?.date ?? s?.date;
  if (
    !s ||
    typeof s.isOpen !== 'boolean' ||
    typeof s.tradingDay !== 'boolean' ||
    typeof date !== 'string' ||
    !DATE.test(date)
  ) {
    throw new Error('unexpected market session payload');
  }
  const times: SessionTimes = {
    preOpening: today?.preOpening,
    opening: today?.opening ?? s.opening,
    closing: today?.closing ?? s.closing,
    postClosing: today?.postClosing,
  };
  if (s.tradingDay && !(HHMM.test(times.opening) && HHMM.test(times.closing))) {
    throw new Error('market session payload has no opening/closing times');
  }
  return {
    date,
    tradingDay: s.tradingDay,
    isOpen: s.isOpen,
    phase: String(s.phase ?? ''),
    times,
    fetchedAt,
  };
}

function getJson(url: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = get(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** Fetch today's market status from the DSE site. Rejects on any failure. */
export async function fetchMarketSession(): Promise<MarketSession> {
  const { url, timeoutMs } = STATUS_CONFIG.marketStatus;
  return parseMarketSession(await getJson(url, timeoutMs));
}
