import { Injectable } from '@nestjs/common';
import { CompanyService } from '../services/company.service';
import { CreateCompanyDto } from '../dto/company.dto';
import { ScrapeStructureError } from '../../daily_status/scrape-errors';
import { ScrapeResult } from '../utils/scrape-runner';

@Injectable()
export default class PageService {
  // scraperObject: any;
  constructor(private readonly companyService: CompanyService) {
    // this.scraperObject = {
    //   companyService: this.companyService,
    // };
  }

  // scraperObject = {
  count = 0;
  // url = 'https://www.dsebd.org/company_listing.php';
  url = 'https://old.dsebd.org/company_listing.php';
  async scraper(browser): Promise<ScrapeResult> {
    const page = await browser.newPage();
    console.log(`Navigating to ${this.url}...`);
    // Navigate to the selected page
    await page.goto(this.url);
    // const scrapedData = [];
    // Wait for the required DOM to be rendered
    const scrapeCurrentPage = async (): Promise<ScrapeResult> => {
      await page.waitForSelector('.content');
      const companies = [];
      for (let id = 65; id <= 91; id++) {
        //for id A-Z
        // console.log("ID", String.fromCharCode(id));
        let div_ID: string;
        if (id < 90) {
          div_ID = String.fromCharCode(id);
        } else {
          div_ID = 'Additional';
        }

        const company_code_name = await page.$$eval(
          `div#${div_ID} > div.BodyContent > a.ab1`,
          (company_code_name) => {
            company_code_name = company_code_name.map((el) => {
              return {
                Code: el.textContent,
                Name: el.nextElementSibling.textContent.replace(/[\(\)]/gm, ''),
              };
            });
            return company_code_name;
          },
        );
        if (id == 90) {
          console.log('TradingCode Scraping Done...!!!');
        }
        companies.push(...company_code_name);
      }
      // console.log("companies", companies);

      if (companies.length === 0) {
        throw new ScrapeStructureError('div#A > div.BodyContent > a.ab1');
      }

      //!========================================== Company Detail Scraping =========================

      // Loop through each of those links, open a new page instance and get the relevant data from them

      let link = '';

      console.log('**Scraping company info**');
      const pagePromise = async (code): Promise<CreateCompanyDto> => {
        const newPage = await browser.newPage();
        try {
          // let dataObj: CreateCompanyDto = {};

          let dataObj = new CreateCompanyDto();
          // console.log("code", code);
          link = `https://old.dsebd.org/displayCompany.php?name=${code}`;
          await newPage.goto(link);
          // await newPage.waitForSelector('h2.BodyHead.topBodyHead');
          dataObj['code'] = code;
          // console.log('Code : ', code);

          dataObj['name'] = await newPage.$eval(
            'div#section-to-print > h2 > i',
            (text) => text.textContent,
          );

          dataObj['last_agm'] = await newPage.$eval(
            'div.col-sm-6.pull-left > i',
            (text) => text.textContent,
          );

          // console.log("last_agm'"); //!..............................................
          try {
            dataObj = await newPage.$$eval(
              'table#company',
              async (table, obj) => {
                //---------------shared helpers: label/value row extraction---------------
                let baseElement: any;
                const clean = (el: any) =>
                  (el.textContent || '').replace(/\s+/g, ' ').trim();

                // Reads a table's direct <tr> rows and pairs up label/value cells.
                // Handles 2-cell (label,value), 3-cell (blank,label,value) and
                // 4-cell (label,value,label,value) row shapes seen on this page.
                // Single-cell rows (section headers) are skipped.
                const extractPairs = (tbl: any) => {
                  const trs: any[] = Array.from(
                    tbl.querySelectorAll(':scope > tbody > tr, :scope > tr'),
                  );
                  const pairs = [];
                  trs.forEach((tr) => {
                    const cells: any[] = Array.from(tr.children).filter(
                      (el: any) => el.tagName === 'TD' || el.tagName === 'TH',
                    );
                    if (cells.length === 2) {
                      pairs.push([clean(cells[0]), clean(cells[1])]);
                    } else if (cells.length === 3) {
                      pairs.push([clean(cells[1]), clean(cells[2])]);
                    } else if (cells.length === 4) {
                      pairs.push([clean(cells[0]), clean(cells[1])]);
                      pairs.push([clean(cells[2]), clean(cells[3])]);
                    }
                  });
                  return pairs;
                };

                const pairsToMap = (pairs) => {
                  const map = {};
                  pairs.forEach(([key, value]) => {
                    if (key && !(key in map)) {
                      map[key] = value;
                    }
                  });
                  return map;
                };

                // Reads a table's direct <tr> rows into [{ colSpan, rowSpan, text }]
                // cell descriptors, used by the rowSpan/colSpan-aware helpers below.
                const tableToRows = (tbl: any) => {
                  const trs: any[] = Array.from(
                    tbl.querySelectorAll(':scope > tbody > tr, :scope > tr'),
                  );
                  return trs.map((tr) =>
                    Array.from(tr.children)
                      .filter(
                        (el: any) => el.tagName === 'TD' || el.tagName === 'TH',
                      )
                      .map((el: any) => ({
                        colSpan: el.colSpan || 1,
                        rowSpan: el.rowSpan || 1,
                        text: clean(el),
                      })),
                  );
                };

                // Finds a data row by its first cell's label (e.g. a quarterly
                // "Basic"/"Diluted*" row) and returns its period values in the
                // fixed column order [Q1, Q2, Half Yearly, Q3, 9 Months, Annual]
                // — matching the shape of the existing eps_share field.
                const periodRowByLabel = (rows: any[], label: string) => {
                  const row = rows.find((r) => r.length && r[0].text === label);
                  if (!row || row.length < 7) return null;
                  return [
                    { q1: row[1].text },
                    { q2: row[2].text },
                    { half_yearly: row[3].text },
                    { q3: row[4].text },
                    { nine_months: row[5].text },
                    { q4: row[6].text },
                  ];
                };

                // Returns the row whose first cell starts with `prefix`
                // (case-insensitive — DSE is inconsistent about "P/E Ratio"
                // vs "P/E ratio" casing), and its last column's value (the
                // most recent trading day for tables 5/6).
                const lastColumnByPrefix = (rows: any[], prefix: string) => {
                  const p = prefix.toLowerCase();
                  const row = rows.find(
                    (r) => r.length && r[0].text.toLowerCase().startsWith(p),
                  );
                  if (!row || row.length < 2) return null;
                  return row[row.length - 1].text;
                };

                // Places each header/data cell into a virtual grid honouring
                // colSpan/rowSpan, so merged header cells are correctly
                // attributed to every column they visually cover.
                const buildGrid = (rows: any[]) => {
                  const grid: any[] = [];
                  for (let r = 0; r < rows.length; r++) grid.push([]);
                  for (let r = 0; r < rows.length; r++) {
                    let c = 0;
                    for (const cell of rows[r]) {
                      while (grid[r][c] !== undefined) c++;
                      for (let rr = r; rr < r + cell.rowSpan; rr++) {
                        for (let cc = c; cc < c + cell.colSpan; cc++) {
                          if (!grid[rr]) grid[rr] = [];
                          grid[rr][cc] = {
                            text: cell.text,
                            originRow: r,
                            originCol: c,
                          };
                        }
                      }
                      c += cell.colSpan;
                    }
                  }
                  return grid;
                };

                // Builds one record per year for tables 7/8, whose headers
                // span multiple merged rows (Year/EPS/NAV/Profit breakdown).
                // `keyNames` maps a grid column index to the DB field name;
                // columns are resolved via buildGrid so the mapping is exact
                // regardless of how the colSpan/rowSpan header is laid out.
                const buildYearlyRecords = (
                  tbl: any,
                  keyNames: Record<number, string>,
                ) => {
                  const rows = tableToRows(tbl);
                  const headerRowCount = rows.findIndex(
                    (row) => row.length && /^\d{4}$/.test(row[0].text),
                  );
                  if (headerRowCount === -1) return null;
                  const grid = buildGrid(rows);
                  const records = [];
                  for (let r = headerRowCount; r < rows.length; r++) {
                    const dataRow = rows[r];
                    if (!dataRow.length || !/^\d{4}$/.test(dataRow[0].text)) {
                      continue;
                    }
                    const record: Record<string, string> = {
                      year: dataRow[0].text,
                    };
                    const yearColspan = dataRow[0].colSpan || 1;
                    let valIdx = 1;
                    for (
                      let c = yearColspan;
                      c < (grid[headerRowCount - 1]?.length ?? 0);
                      c++
                    ) {
                      const key = keyNames[c];
                      if (key) {
                        record[key] = dataRow[valIdx]
                          ? dataRow[valIdx].text
                          : null;
                      }
                      valIdx++;
                    }
                    records.push(record);
                  }
                  return records;
                };

                //---------------table-0-Trading Code / Scrip Code---------------
                const table0Text = clean(table[0]);
                const scripCodeMatch = table0Text.match(/Scrip Code:\s*(\S+)/);
                obj['scrip_code'] = scripCodeMatch ? scripCodeMatch[1] : null;

                //---------------table-1-Market Information---------------
                const marketInfo = pairsToMap(extractPairs(table[1]));

                obj['market_capitalization_mn'] =
                  marketInfo['Market Capitalization (mn)'] ?? null;
                obj['free_float_market_cap_mn'] =
                  marketInfo['Free Float Market Cap. (mn)'] ?? null;
                obj['last_trading_price'] =
                  marketInfo['Last Trading Price'] ?? null;
                obj['last_update_time'] = marketInfo['Last Update'] ?? null;
                obj['change_percentage'] = marketInfo['Change*'] ?? null;
                obj['yesterdays_closing_price'] =
                  marketInfo["Yesterday's Closing Price"] ?? null;
                obj['adjusted_opening_price'] =
                  marketInfo['Adjusted Opening Price'] ?? null;
                obj['opening_price'] = marketInfo['Opening Price'] ?? null;
                obj['closing_price'] = marketInfo['Closing Price'] ?? null;
                obj['days_range'] = marketInfo["Day's Range"] ?? null;
                obj['week_52_range'] =
                  marketInfo["52 Weeks' Moving Range"] ?? null;
                obj['days_trade_nos'] =
                  marketInfo["Day's Trade (Nos.)"] ?? null;
                obj['days_volume_nos'] =
                  marketInfo["Day's Volume (Nos.)"] ?? null;
                obj['days_value_mn'] = marketInfo["Day's Value (mn)"] ?? null;

                // console.log('market_capitalization_mn'); //!.............................

                //---------------table-2-Basic Information---------------

                baseElement = table[2].querySelector('tbody > tr');

                obj['authorized_capital_mn'] =
                  baseElement.querySelector('td').textContent;

                obj['paidup_capital_mn'] =
                  baseElement.nextElementSibling.querySelector(
                    'td',
                  ).textContent;

                obj['type_of_instrument'] =
                  baseElement.nextElementSibling.querySelector(
                    'td',
                  ).nextElementSibling.nextElementSibling.textContent;

                obj['total_outstanding_share_mn'] =
                  baseElement.nextElementSibling.nextElementSibling.nextElementSibling.querySelector(
                    'td',
                  ).textContent;
                // console.log('_mn'); //!.............................

                obj['face_par_value'] =
                  baseElement.nextElementSibling.nextElementSibling.querySelector(
                    'td',
                  ).textContent;

                obj['sector'] =
                  baseElement.nextElementSibling.nextElementSibling.nextElementSibling.querySelector(
                    'td',
                  ).nextElementSibling.nextElementSibling.textContent;

                const basicInfo = pairsToMap(extractPairs(table[2]));
                obj['debut_trading_date'] =
                  basicInfo['Debut Trading Date'] ?? null;
                obj['market_lot'] = basicInfo['Market Lot'] ?? null;

                //---------------table-3-Last AGM---------------

                baseElement = table[3].querySelector('tbody > tr');

                obj['cash_dividend'] =
                  baseElement.querySelector('td').textContent;

                obj['bonus_issued_stock_dividend'] =
                  baseElement.nextElementSibling.querySelector(
                    'td',
                  ).textContent;

                const agmInfo = pairsToMap(extractPairs(table[3]));
                obj['right_issue'] = agmInfo['Right Issue'] ?? null;
                obj['year_end'] = agmInfo['Year End'] ?? null;
                obj['reserve_surplus_without_oci_mn'] =
                  agmInfo['Reserve & Surplus without OCI (mn)'] ?? null;
                obj['other_comprehensive_income_mn'] =
                  agmInfo['Other Comprehensive Income (OCI) (mn)'] ?? null;

                // console.log('bonus_issued_stock_dividend'); //!.............................

                //!---------------table-4-Interim Financial Performance:---------------
                baseElement = table[4].querySelector('tbody > tr');
                console.log('baseElement_table[9]', baseElement);

                //!=========================
                // let round_eps = 0;
                const eps_share = (base_element) => {
                  // round_eps++;
                  const eps_share_row = base_element;
                  const content = eps_share_row.querySelector('td').textContent;
                  console.log('content......', content);

                  if (
                    eps_share_row.nextElementSibling !== null &&
                    content !== 'Basic'
                  ) {
                    console.log(
                      'Not null.......obj[`eps_share`]',
                      eps_share_row.querySelector('td'),
                    );

                    eps_share(eps_share_row.nextElementSibling); //!-----------> Recursive Call
                  } else {
                    if (content == 'Basic') {
                      const array = [];
                      array.push(
                        {
                          q1: eps_share_row.querySelector('td')
                            .nextElementSibling.textContent,
                        },
                        {
                          q2: eps_share_row.querySelector('td')
                            .nextElementSibling.nextElementSibling.textContent,
                        },
                        {
                          half_yearly:
                            eps_share_row.querySelector('td').nextElementSibling
                              .nextElementSibling.nextElementSibling
                              .textContent,
                        },
                        {
                          q3: eps_share_row.querySelector('td')
                            .nextElementSibling.nextElementSibling
                            .nextElementSibling.nextElementSibling.textContent,
                        },
                        {
                          nine_months:
                            eps_share_row.querySelector('td').nextElementSibling
                              .nextElementSibling.nextElementSibling
                              .nextElementSibling.nextElementSibling
                              .textContent,
                        },
                        {
                          q4: eps_share_row.querySelector('td')
                            .nextElementSibling.nextElementSibling
                            .nextElementSibling.nextElementSibling
                            .nextElementSibling.nextElementSibling.textContent,
                        },
                      );
                      obj['eps_share'] = array;
                      console.log("**obj['eps_share']**", obj['eps_share']);
                    } else {
                      obj['eps_share'] = null;
                      console.log('Output', obj['eps_share']);
                    }
                  }
                };

                eps_share(baseElement); //!-----------> Function Call

                const table4Rows = tableToRows(table[4]);
                obj['diluted_eps_share'] = periodRowByLabel(
                  table4Rows,
                  'Diluted*',
                );
                // The 2nd "Basic"/"Diluted*" pair (after the 1st EPS
                // section) belongs to the "EPS - continuing operations"
                // section further down the same table.
                const basicRows4 = table4Rows.filter(
                  (r) => r.length && r[0].text === 'Basic',
                );
                const dilutedRows4 = table4Rows.filter(
                  (r) => r.length && r[0].text === 'Diluted*',
                );
                obj['eps_continuing_ops_share'] = basicRows4[1]
                  ? [
                      { q1: basicRows4[1][1].text },
                      { q2: basicRows4[1][2].text },
                      { half_yearly: basicRows4[1][3].text },
                      { q3: basicRows4[1][4].text },
                      { nine_months: basicRows4[1][5].text },
                      { q4: basicRows4[1][6].text },
                    ]
                  : null;
                obj['diluted_eps_continuing_ops_share'] = dilutedRows4[1]
                  ? [
                      { q1: dilutedRows4[1][1].text },
                      { q2: dilutedRows4[1][2].text },
                      { half_yearly: dilutedRows4[1][3].text },
                      { q3: dilutedRows4[1][4].text },
                      { nine_months: dilutedRows4[1][5].text },
                      { q4: dilutedRows4[1][6].text },
                    ]
                  : null;
                obj['market_price_per_share_quarterly'] = periodRowByLabel(
                  table4Rows,
                  'Market price per share at period end',
                );

                //---------------table-5-P/E Ratio based on latest Un-audited Financial Statements---------------
                const table5Rows = tableToRows(table[5]);
                obj['pe_unaudited'] = lastColumnByPrefix(
                  table5Rows,
                  'Current P/E Ratio using Basic EPS',
                );
                obj['pe_diluted_unaudited'] = lastColumnByPrefix(
                  table5Rows,
                  'Current P/E ratio using Diluted EPS',
                );
                obj['trailing_pe_ratio'] = lastColumnByPrefix(
                  table5Rows,
                  'Trailing P/E Ratio',
                );

                //---------------table-6-Price Earnings (P/E) Ratio Based on latest Audited Financial Statements---------------

                baseElement = table[6]
                  .querySelector('tbody > tr')
                  .nextElementSibling.querySelector('td');

                let round = 0;
                const row = (base_element) => {
                  round++;
                  const year_row = base_element;
                  if (year_row.nextElementSibling !== null) {
                    row(year_row.nextElementSibling); //!-----------> Recursive Call
                  } else {
                    if (round > 1) {
                      obj['pe'] = year_row.textContent;
                      console.log("obj['pe']", obj['pe']);
                    } else {
                      obj['pe'] = null;
                      console.log("obj['pe']", obj['pe']);
                    }
                  }
                };

                row(baseElement); //!-----------> Function Call

                const table6Rows = tableToRows(table[6]);
                obj['pe_diluted'] = lastColumnByPrefix(
                  table6Rows,
                  'Current P/E ratio using Diluted EPS',
                );

                //---------------table-7-Price Earnings (P/E) Ratio Based on latest Audited Financial Statements---------------

                baseElement =
                  table[7].querySelector('tbody > tr').nextElementSibling
                    .nextElementSibling;
                //!===================================
                let round_1 = 0;
                const row_year = (base_element) => {
                  round_1++;
                  const year_row = base_element;
                  if (year_row.nextElementSibling !== null) {
                    console.log(
                      'Not null.......',
                      year_row.querySelector('td'),
                    );

                    row_year(year_row.nextElementSibling); //!-----------> Recursive Call
                  } else {
                    if (round_1 > 1) {
                      obj['eps'] =
                        year_row.querySelector(
                          'td',
                        ).nextElementSibling.nextElementSibling.nextElementSibling.nextElementSibling.textContent;
                      console.log("obj['eps']", obj['eps']);
                    } else {
                      obj['eps'] = null;
                      console.log("obj['eps']", obj['eps']);
                    }
                  }
                };

                row_year(baseElement); //!-----------> Function Call

                // console.log('eps'); //!.............................

                // Column indices below were derived by reconstructing
                // table[7]'s merged header grid (rowSpan/colSpan), not
                // guessed — see the buildYearlyRecords/buildGrid helpers.
                obj['yearly_financial_performance'] = buildYearlyRecords(
                  table[7],
                  {
                    2: 'eps_basic_original',
                    3: 'eps_basic_restated',
                    4: 'eps_diluted',
                    5: 'eps_continuing_basic_original',
                    6: 'eps_continuing_basic_restated',
                    7: 'eps_continuing_diluted',
                    8: 'nav_per_share_original',
                    9: 'nav_per_share_restated',
                    10: 'nav_per_share_diluted',
                    11: 'pco',
                    12: 'profit_for_the_year_mn',
                    13: 'tci',
                  },
                );

                //---------------table-8-Financial Performance... (Continued)---------------
                baseElement = table[8].querySelector('tbody > tr');
                console.log('baseElement_table[9]', baseElement);

                //!=========================
                let round_2 = 0;
                const dividend_yield = (base_element) => {
                  round_2++;
                  const dividend_yield_row = base_element;
                  if (dividend_yield_row.nextElementSibling !== null) {
                    console.log(
                      'Not null.......obj[`dividend_yield_percentage`]',
                      dividend_yield_row.querySelector('td'),
                    );

                    dividend_yield(dividend_yield_row.nextElementSibling); //!-----------> Recursive Call
                  } else {
                    // console.log('round_2', round_2);

                    if (round_2 > 4) {
                      console.log(
                        '.......obj[`dividend_yield_percentage`]',
                        dividend_yield_row.querySelector('td'),
                      );
                      obj['dividend_yield_percentage'] =
                        dividend_yield_row.querySelector(
                          'td',
                        ).nextElementSibling.nextElementSibling.nextElementSibling.nextElementSibling.nextElementSibling.nextElementSibling.nextElementSibling.nextElementSibling.textContent;
                      console.log(
                        "obj['dividend_yield_percentage']",
                        obj['dividend_yield_percentage'],
                      );
                    } else {
                      obj['dividend_yield_percentage'] = null;
                      console.log('Output', obj['dividend_yield_percentage']);
                    }
                  }
                };

                dividend_yield(baseElement); //!-----------> Function Call
                //!=========================

                // Column indices below were derived the same way, from
                // table[8]'s own merged header grid.
                obj['yearly_pe_dividend'] = buildYearlyRecords(table[8], {
                  2: 'pe_basic_original',
                  3: 'pe_basic_restated',
                  4: 'pe_diluted',
                  5: 'pe_continuing_basic_original',
                  6: 'pe_continuing_basic_restated',
                  7: 'pe_continuing_diluted',
                  8: 'dividend_percentage',
                  9: 'dividend_yield_percentage',
                });

                //---------------table-10-Other Information of the Company---------------
                baseElement = table[10].querySelector('tbody > tr');

                obj['listing_since'] =
                  baseElement.querySelector(
                    'td',
                  ).nextElementSibling.textContent;

                obj['category'] =
                  baseElement.nextElementSibling.querySelector(
                    'td',
                  ).nextElementSibling.textContent;

                // console.log('category'); //!.............................

                const otherInfo = pairsToMap(extractPairs(table[10]));
                obj['electronic_share'] = otherInfo['Electronic Share'] ?? null;
                obj['remarks'] = otherInfo['Remarks'] ?? null;

                //---------------table-9-Financial Statement / PSI links---------------
                const links = pairsToMap(extractPairs(table[9]));
                obj['financial_statement_link'] =
                  links['Details of Financial Statement'] ?? null;
                obj['price_sensitive_info_link'] =
                  links['Price Sensitive Information'] ?? null;

                //---------------table-11-Operational / Loan / Credit Rating Status---------------
                const statusInfo = pairsToMap(extractPairs(table[11]));
                obj['present_operational_status'] =
                  statusInfo['Present Operational Status'] ?? null;
                obj['short_term_loan_mn'] =
                  statusInfo['Short-term loan (mn)'] ?? null;
                obj['long_term_loan_mn'] =
                  statusInfo['Long-term loan (mn)'] ?? null;
                obj['short_term_credit_rating'] =
                  statusInfo['Short-term'] ?? null;
                obj['long_term_credit_rating'] =
                  statusInfo['Long-term'] ?? null;
                obj['otc_delisting_relisting'] =
                  statusInfo['OTC/Delisting/Relisting'] ?? null;

                //-----------------------------Shareholding pattern--------------------------

                const ShareHolding_row = (base_element) => {
                  if (
                    base_element.nextElementSibling.querySelector('td')
                      .textContent != 'Remarks'
                  ) {
                    console.log(
                      'base_element.nextElementSibling.textContent',
                      base_element.nextElementSibling.textContent,
                    );

                    return ShareHolding_row(base_element.nextElementSibling);
                  } else {
                    console.log('base_element__return', base_element);
                    return base_element;
                  }
                };

                const Shareholding = ShareHolding_row(
                  baseElement.nextElementSibling.nextElementSibling,
                )
                  .querySelector('td')
                  .nextElementSibling.querySelector('table > tbody > tr');

                console.log('Shareholding.........', Shareholding);

                const ShareholdingArray = Shareholding.textContent
                  .replace(/\s+/g, ' ')
                  .trim()
                  .split(' ');

                obj['sponsor_director'] = ShareholdingArray[1];
                obj['govt'] = ShareholdingArray[3];
                obj['institute'] = ShareholdingArray[5];
                obj['_foreign'] = ShareholdingArray[7];
                obj['_public'] = ShareholdingArray[9];

                // console.log('public....'); //!.............................
                //---------------Shareholding Pattern----------------------

                //---------------------table-12-Address of the Company------------------
                baseElement = table[12].querySelector('tbody > tr');

                const addressArray = baseElement.textContent.trim().split('\n');
                // console.log('addressArray', addressArray.length); //!.............................

                if (addressArray.length > 2) {
                  obj['address'] = addressArray[2].replace(/\s+/g, ' ');

                  // console.log('address'); //!.............................

                  obj['phone'] =
                    baseElement.nextElementSibling.nextElementSibling.querySelector(
                      'td',
                    ).nextElementSibling.textContent;

                  obj['email'] =
                    baseElement.nextElementSibling.nextElementSibling.nextElementSibling.nextElementSibling.querySelector(
                      'td',
                    ).nextElementSibling.textContent;
                } else {
                  obj['address'] = null;
                  obj['phone'] = null;
                  obj['email'] = null;
                }

                // Positional walk of table-12's rows: [Head Office, Factory,
                // Contact Phone, Fax, E-mail, Web Address, Company Secretary
                // Name, Cell No., Telephone No., E-mail (secretary)]. The two
                // "E-mail" labels collide in a map, so this stays positional.
                // "Telephone No." (index 8) is skipped: it duplicates the
                // "Contact Phone" number already captured in obj['phone'].
                const addressPairs = extractPairs(table[12]);
                obj['factory'] = addressPairs[1]?.[1] ?? null;
                obj['fax'] = addressPairs[3]?.[1] ?? null;
                obj['web_address'] = addressPairs[5]?.[1] ?? null;
                obj['company_secretary_name'] = addressPairs[6]?.[1] ?? null;
                obj['cell_no'] = addressPairs[7]?.[1] ?? null;
                obj['company_secretary_email'] = addressPairs[9]?.[1] ?? null;

                return obj;
              },
              dataObj,
            );
          } catch {
            this.count += 1;
            console.log('error........!!!');
          }

          return dataObj;
        } finally {
          await newPage.close().catch(() => undefined);
        }
      };

      // const com = ['ACMEPL', 'AGRANINS', 'SJIBLPBOND', 'AAMRANET']; //TB10Y0126 TB10Y0126

      let stored = 0;
      for (link in companies) {
        // for (link in com) {
        let currentPageData = new CreateCompanyDto();
        const regex = /TB[0-9]+Y[0-9]+/i;
        const is_true = regex.test(companies[link].Code);
        // const is_true = regex.test(com[link]);
        if (is_true) {
          continue;
        }
        currentPageData = await pagePromise(companies[link].Code);
        // currentPageData = await pagePromise(com[link]);
        //! ============================================= Database Insertion====================
        const result = await this.companyService.upsertCompanyEntity(
          currentPageData,
        ); // inserting into the database.
        stored++;
        //! ============================================= Database Insertion====================

        // console.log('result', result);
        // console.log('Count', this.count);

        // =============================================
        // scrapedData.push(currentPageData);
      }
      console.log('Scraping company info done...!!!');
      return { rows: stored };
    };
    try {
      return await scrapeCurrentPage();
    } finally {
      await page.close().catch(() => undefined); // the browser is closed by the runner
    }
    // console.log('data...', data);
    // return data;
    // },
  }
}
