# Newly Added Fields

Covers fields added across the last few commits on `scrapper_update`:
`a747954` (man entity + date formatting), `7cfb9b6` (timestamps for MDS
collections), `2747cf9` (company info scraper), `dca695f` (price/earnings
scraper).

## Company (`src/dse_data_scraping/entities/company.entities.ts`)

Scraped from the DSE company info page (`codeNameScraper.ts`), which was
rewritten to parse tables by label instead of fixed DOM position (more
resilient to markup changes upstream).

### Market information (table 1)
| Field | Purpose |
|---|---|
| `scrip_code` | Numeric scrip code shown next to the trading code on the page header. |
| `last_trading_price` | Most recent traded price. |
| `last_update_time` | Timestamp DSE last refreshed the market data block. |
| `closing_price` / `opening_price` / `adjusted_opening_price` | Day's closing/opening prices; adjusted opening accounts for corporate actions. |
| `yesterdays_closing_price` | Previous session's close, for day-over-day comparison. |
| `change_percentage` | Percentage price change vs. previous close. |
| `days_range` | Intraday high–low range. |
| `week_52_range` | 52-week high–low range. |
| `days_trade_nos` | Number of trades executed during the day. |
| `days_volume_nos` | Number of shares traded during the day. |
| `days_value_mn` | Total traded value (in millions BDT). |
| `free_float_market_cap_mn` | Market cap of freely tradable (non-locked-in) shares. |

### Basic info / AGM (tables 2–3)
| Field | Purpose |
|---|---|
| `debut_trading_date` | Date the security first traded on DSE. |
| `market_lot` | Minimum tradable share lot size. |
| `right_issue` | Right share issue status/ratio declared at last AGM. |
| `year_end` | Company's fiscal year-end month. |
| `reserve_surplus_without_oci_mn` | Reserve & surplus excluding other comprehensive income (mn BDT). |
| `other_comprehensive_income_mn` | Other comprehensive income (OCI) for the period (mn BDT). |

### EPS / market price detail (table 4)
| Field | Purpose |
|---|---|
| `diluted_eps_share` | Diluted EPS by period (Q1/Q2/half-yearly/Q3/9-months/annual), alongside the existing `eps_share` (basic). |
| `eps_continuing_ops_share` | Basic EPS from continuing operations only, by period. |
| `diluted_eps_continuing_ops_share` | Diluted EPS from continuing operations only, by period. |
| `market_price_per_share_quarterly` | Market price per share at the end of each reporting period. |

### P/E ratios (tables 5–6)
| Field | Purpose |
|---|---|
| `pe_unaudited` | Current P/E ratio (basic EPS) per latest **un**audited financials. |
| `pe_diluted_unaudited` | Current P/E ratio (diluted EPS) per latest **un**audited financials. |
| `trailing_pe_ratio` | Trailing twelve-month P/E ratio. |
| `pe_diluted` | Current P/E ratio (diluted EPS) per latest **audited** financials. |

### Yearly performance history (tables 7–8)
| Field | Purpose |
|---|---|
| `yearly_financial_performance` | Per-year record: basic/restated/diluted EPS (overall and continuing-ops), NAV per share (original/restated/diluted), profit for the year, PCO, TCI — reconstructed from the merged-header grid so columns are mapped exactly. |
| `yearly_pe_dividend` | Per-year record: basic/restated/diluted P/E (overall and continuing-ops), dividend %, dividend yield %. |

### Links, status, contact (tables 9–12)
| Field | Purpose |
|---|---|
| `financial_statement_link` | URL to the company's detailed financial statement. |
| `price_sensitive_info_link` | URL to price-sensitive information disclosures. |
| `electronic_share` | Percentage/status of shares held in dematerialized (electronic) form. |
| `remarks` | Free-text remarks DSE attaches to the listing. |
| `present_operational_status` | Current operational status (e.g. active, closed, under liquidation). |
| `short_term_loan_mn` / `long_term_loan_mn` | Outstanding short/long-term loan (mn BDT). |
| `short_term_credit_rating` / `long_term_credit_rating` | Latest credit ratings. |
| `otc_delisting_relisting` | OTC market / delisting / relisting status. |
| `factory` | Factory address. |
| `fax` | Fax number. |
| `web_address` | Company website. |
| `company_secretary_name` | Company secretary's name. |
| `cell_no` | Company secretary's cell number. |
| `company_secretary_email` | Company secretary's email. |

## Price/Earnings (`src/dse_data_scraping/entities/pe.entities.ts`)

| Field | Purpose |
|---|---|
| `trailing_pe` | Trailing P/E ratio scraped from the DSE P/E page, alongside the existing `pe_1`–`pe_6` columns. |

## MAN — corporate announcements (`src/mdsdata/entities/man.entities.ts`)

| Field | Purpose |
|---|---|
| `MAN_ANNOUNCEMENT_DATE_TIME` (type changed `string` → `Date`) | Announcement timestamp, now parsed into a real `Date` (stripping the `"(Coordinated Universal Time)"` suffix DSE sends) so it can be queried/sorted properly instead of as free text. |
| `MAN_ANNOUNCEMENT_DATE_TIME_SOURCE` | Raw, unparsed value as received from DSE — kept for traceability in case a source string fails to parse into a valid `Date`. |

Parsing logic lives in `mdsdata.service.ts`: rows for the `MAN` table are
run through a formatter that converts the source string to a `Date` before
insert; other MDS tables (`IDX`, `TRD`, `MKISTAT`, etc.) are unaffected.

## Timestamps on MDS collections

`timestamps: true` was added to the Mongoose schemas for `man_mds`,
`idx_mds`, `mkistat_mds`, and `trd_mds`
(`src/mdsdata/entities/{man,idx,mkistat,trd}.entities.ts`). This makes
Mongoose auto-manage `createdAt` / `updatedAt` on every document, giving
visibility into when each record was ingested/modified — useful for
auditing scrape runs and debugging duplicate/missing data.

Related: `src/main.ts` now sets `process.env.TZ = 'Asia/Dhaka'` before any
other import, so these auto-generated timestamps (and any other `Date`
created in the app) are anchored to Bangladesh time regardless of the host
server's local timezone.

## Utility: `trimDeep` (`src/dse_data_scraping/utils/trim.util.ts`)

Not a data field, but supports the fields above: recursively trims
whitespace from every string value in an object/array (including nested
JSON fields like `eps_share`, `yearly_financial_performance`, etc.) so
scraped values are normalized once, right before persistence.
