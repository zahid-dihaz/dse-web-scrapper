# dse-scraper

Puppeteer scraping service: `/companies` (daily, `COMPANIES_SCRAPE_TIME`), `/price-earnings` and
`/circuit-breaks` (every 5 min, Sun-Thu 09-16 Dhaka). Writes to the shared MongoDB and reports
into `daily_status` (see docs/daily-status.md). Sibling service: dse-poller (same database).

    cp .env.example .env   # or use the provided .env
    yarn install && yarn build && yarn start:prod

Needs Chrome/Chromium installed on the host. Does NOT need MySQL. The watchdog, finalizer and bootstrap
are run from dse-poller (run them in ONE place only; `src/daily_status` is identical in both).
