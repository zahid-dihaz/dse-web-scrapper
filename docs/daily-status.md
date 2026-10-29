# daily_status heartbeat

One status document per Asia/Dhaka calendar date in the `daily_status`
collection, so a consumer can tell **"exchange closed"** from **"collection
failed"**. This service owns every write, plus creating the collection, its
validator and its indexes. A separate read-only provider serves it at
`GET /status`.

## Document

```jsonc
{
  "_id": "2026-10-07",              // Dhaka date
  "exchange_open": true,
  "overall_status": "partial",      // ok | partial | failed | closed
  "generated_at": ISODate(),        // UTC
  "updated_at": ISODate(),          // UTC, set on every write
  "endpoints": [                    // empty on closed days
    {
      "endpoint": "/idx",
      "collection": "idx_mds",
      "source": "mysql",            // mysql | puppeteer
      "status": "partial",          // ok | partial | failed
      "last_success_at": ISODate(), // or null
      "rows": 168,                  // int >= 0, rows captured today
      "note": "MySQL connection lost 12:14–12:41, recovered" // or null, max 500
    }
  ]
}
```

| API endpoint | MongoDB collection | Source |
|---|---|---|
| /companies | companies_dses | puppeteer |
| /circuit-breaks | circuitbreaks_dses | puppeteer |
| /price-earnings | price_earnings_dses | puppeteer |
| /idx | idx_mds | mysql |
| /trd | trd_mds | mysql |
| /man | man_mds | mysql |
| /mkistat | mkistat_mds | mysql |

Collection names are the ones the code already wrote; none were renamed. The
circuit-break collection is `circuitbreaks_dses` (not `circuit_breaker_dses`),
which the provider must use.

Indexes: `{overall_status: 1, _id: -1}` and `{"endpoints.status": 1}`. A
`$jsonSchema` validator enforces the shape and the enums.

A second small collection, `market_sessions`, stores the day's market status as
published by the DSE site (one document per date: `trading_day`, `is_open`,
`phase`, `pre_opening`, `opening`, `closing`, `post_closing`, `fetched_at`). It
replaces a holiday calendar: closed days and session hours come from
`https://new.dsebd.org/api/live/market` (the JSON the site's own front end
polls), fetched once per day and stored.

## Nightly check

The one query:

```js
db.daily_status.find({ overall_status: { $in: ["partial", "failed"] } }).sort({ _id: -1 })
```

Closed days (`overall_status: "closed"`) are deliberately excluded.

## Setup (once per deploy)

```bash
yarn build                          # nest build
node dist/daily_status/bootstrap    # creates/updates daily_status + market_sessions
```

`bootstrap` is idempotent (creates the collection with its validator, or
applies it with `collMod` if it exists) and touches no other collection.
Everything reads `MONGO_URI` from `.env` in the working directory, so run the
commands below from the repository root.

Check `node -v` on the VPS: the Docker image installs Node 14; the code is
compiled to ES2017 and uses only `https` (no global `fetch`).

## Scheduling (system crontab, not Docker)

The watchdog and finalizer are standalone processes, separate from the Nest app
and from the collectors, so they keep working when a collector is dead. Nothing
here is installed automatically.

```cron
# crontab -e   (replace /opt/dsedatamigration with the checkout path)
CRON_TZ=Asia/Dhaka

# Watchdog: every 10 minutes Sun-Thu. It exits immediately outside the DSE
# session (and on closed days), so the hour range only needs to cover it.
*/10 10-14 * * 0-4  cd /opt/dsedatamigration && node dist/daily_status/watchdog >> /var/log/dse-status.log 2>&1

# Finalizer: every calendar day after the close, including Fri/Sat and holidays.
5 15 * * *          cd /opt/dsedatamigration && node dist/daily_status/finalizer >> /var/log/dse-status.log 2>&1
```

If the cron implementation ignores `CRON_TZ` and the server clock is not
Asia/Dhaka, shift the hours accordingly, or use systemd timers, which take the
zone explicitly:

```ini
# dse-watchdog.timer
[Timer]
OnCalendar=Sun..Thu *-*-* 10..14:00/10:00 Asia/Dhaka
# dse-finalizer.timer
[Timer]
OnCalendar=*-*-* 15:05:00 Asia/Dhaka
```

(each timer pairs with a oneshot `.service` running the same `node ...` command
with `WorkingDirectory=/opt/dsedatamigration`.)

The finalizer time (15:05) and other settings live in
`src/daily_status/status.config.ts`; keep the crontab in step with it.

## /companies schedule

Set `COMPANIES_SCRAPE_TIME=HH:mm` (Dhaka, default `10:20`) in `.env`. The
scraper's cron and the watchdog/finalizer deadline (scrape time + 40 min) are
both derived from it. Restart the app after changing it.

## Manual runs

```bash
node dist/daily_status/watchdog                       # now
node dist/daily_status/watchdog --now 2026-10-07T06:30:00Z   # simulate another instant
node dist/daily_status/finalizer                      # today
node dist/daily_status/finalizer 2026-10-08           # re-run a past day (idempotent)
```

A past day uses its stored `market_sessions` document; if none exists it uses
the day's own status record, then the Sunday-Thursday rule (the site publishes
only today's status, so a past holiday that was never stored cannot be
recovered automatically).

## How a day is built

1. **Collectors** report through one module (`StatusService`):
   `recordSuccess(endpoint, rows)`, `recordError(endpoint, type, detail)`,
   `recordRecovery(endpoint)`, `initDay(date)`. Calls never throw and give up
   after 3 s; every write sets `updated_at`. Reporting happens only between
   pre-open and post-close on a trading day.
2. **MySQL pollers** (`idx`, `trd`, `man`, `mkistat`) report per table:
   "MySQL connection lost at 12:14 (PROTOCOL_CONNECTION_LOST)", "MySQL query
   failed at 12:14 (<code>)", and "source returned no rows since 12:14" after 3
   consecutive empty polls (never for `/man`, where silence is normal). The
   first success afterwards rewrites the note to "… 12:14–12:41, recovered".
3. **Puppeteer scrapers** report per run: "page unreachable at 12:14", "page
   structure changed at 12:14 (selector x not found)", "browser crashed at
   12:14", "could not parse page at 12:14". Zero circuit breaks is `ok` with
   "no circuit breaks triggered" only if the table header parsed.
4. **Watchdog** (every 10 min in session): an endpoint with no capture for
   longer than its threshold (15 min; `/companies`: none by 11:00) becomes
   `partial` (or `failed` if nothing was captured today) and gets "no captures
   since 12:14, collector not responding" appended; existing notes are never
   replaced. A later success resolves that note by itself.
5. **Finalizer** (15:05): closed day => `exchange_open:false`,
   `overall_status:"closed"`, `endpoints:[]`. Open day => checks every endpoint
   captured through the 14:00 close, checks `trd_mds` (one market-wide document
   per day: present, non-zero totals, last updated no earlier than the close),
   gives every non-ok endpoint a note, and sets `overall_status` (`ok` only if
   all seven are `ok`).

## Tests

```bash
yarn test
```

Unit tests need nothing. The database-backed specs use a local `mongod` at
`mongodb://localhost:27017` in throwaway `dse_status_test_*` databases (set
`MONGO_TEST_URI` to change it; they skip with a warning if Mongo is
unreachable). They include replays of the real incidents: the 12:14 MySQL
connection drop, repeated empty results, and collection stopping after pre-open.

## Other tools

`node dist/mdsdata/seed-last-data` derives the MySQL `lastdatas` marks from the
data already in Mongo (dry run by default, `--write` to apply), so a database
that has data but an empty `lastdatas` does not re-read every table from `'0'`.

## Known limits

- `LastData` advances after each batch even if a non-duplicate Mongo write
  failed (existing behaviour; the failure is now visible in the status note).
- No MySQL overlap guard or query timeouts; the price-earnings scraper still
  retries a non-200 response forever.
- Failure alerts (email/Telegram) are not implemented.
