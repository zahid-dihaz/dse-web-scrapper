// company.service.ts
import { Injectable } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
import { CreateCompanyDto } from '../dto/company.dto';

import { Companies, CompaniesDocument } from '../entities/company.entities';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { trimDeep } from '../utils/trim.util';

@Injectable()
export class CompanyService {
  constructor(
    @InjectModel('Companies')
    private companiesModel: Model<CompaniesDocument>,
  ) {}

  async upsertCompanyEntity(createCompanyDto: CreateCompanyDto): Promise<void> {
    const trimmedCompanyDto = trimDeep(createCompanyDto);
    const {
      code,
      name,
      last_agm,
      market_capitalization_mn,
      authorized_capital_mn,
      paidup_capital_mn,
      type_of_instrument,
      total_outstanding_share_mn,
      face_par_value,
      sector,
      cash_dividend,
      dividend_yield_percentage,
      bonus_issued_stock_dividend,
      pe,
      eps,
      listing_since,
      category,
      sponsor_director,
      govt,
      institute,
      _foreign,
      _public,
      address,
      phone,
      email,
      eps_share,
      diluted_eps_share,
      eps_continuing_ops_share,
      diluted_eps_continuing_ops_share,
      market_price_per_share_quarterly,
      pe_diluted,
      pe_unaudited,
      pe_diluted_unaudited,
      trailing_pe_ratio,
      yearly_financial_performance,
      yearly_pe_dividend,
      scrip_code,
      last_trading_price,
      last_update_time,
      closing_price,
      opening_price,
      adjusted_opening_price,
      yesterdays_closing_price,
      change_percentage,
      days_range,
      week_52_range,
      days_trade_nos,
      days_volume_nos,
      days_value_mn,
      free_float_market_cap_mn,
      debut_trading_date,
      market_lot,
      right_issue,
      year_end,
      reserve_surplus_without_oci_mn,
      other_comprehensive_income_mn,
      financial_statement_link,
      price_sensitive_info_link,
      electronic_share,
      remarks,
      present_operational_status,
      short_term_loan_mn,
      long_term_loan_mn,
      short_term_credit_rating,
      long_term_credit_rating,
      otc_delisting_relisting,
      factory,
      fax,
      web_address,
      company_secretary_name,
      cell_no,
      company_secretary_email,
      // created_at
    } = trimmedCompanyDto;

    // console.log('_public', _public);

    const company = new Companies();

    company.code = code;
    company.name = name;
    company.last_agm = last_agm;
    company.market_capitalization_mn = market_capitalization_mn;
    company.authorized_capital_mn = authorized_capital_mn;
    company.paidup_capital_mn = paidup_capital_mn;
    company.type_of_instrument = type_of_instrument;
    company.total_outstanding_share_mn = total_outstanding_share_mn;
    company.face_par_value = face_par_value;
    company.sector = sector;
    company.cash_dividend = cash_dividend;
    company.dividend_yield_percentage = dividend_yield_percentage;
    company.bonus_issued_stock_dividend = bonus_issued_stock_dividend;
    company.pe = pe;
    company.eps = eps;
    company.listing_since = listing_since;
    company.category = category;
    company.sponsor_director = sponsor_director;
    company.govt = govt;
    company.institute = institute;
    company._foreign = _foreign;
    company.public = _public;
    company.address = address;
    company.phone = phone;
    company.email = email;
    company.eps_share = eps_share;
    company.diluted_eps_share = diluted_eps_share;
    company.eps_continuing_ops_share = eps_continuing_ops_share;
    company.diluted_eps_continuing_ops_share = diluted_eps_continuing_ops_share;
    company.market_price_per_share_quarterly = market_price_per_share_quarterly;
    company.pe_diluted = pe_diluted;
    company.pe_unaudited = pe_unaudited;
    company.pe_diluted_unaudited = pe_diluted_unaudited;
    company.trailing_pe_ratio = trailing_pe_ratio;
    company.yearly_financial_performance = yearly_financial_performance;
    company.yearly_pe_dividend = yearly_pe_dividend;
    company.scrip_code = scrip_code;
    company.last_trading_price = last_trading_price;
    company.last_update_time = last_update_time;
    company.closing_price = closing_price;
    company.opening_price = opening_price;
    company.adjusted_opening_price = adjusted_opening_price;
    company.yesterdays_closing_price = yesterdays_closing_price;
    company.change_percentage = change_percentage;
    company.days_range = days_range;
    company.week_52_range = week_52_range;
    company.days_trade_nos = days_trade_nos;
    company.days_volume_nos = days_volume_nos;
    company.days_value_mn = days_value_mn;
    company.free_float_market_cap_mn = free_float_market_cap_mn;
    company.debut_trading_date = debut_trading_date;
    company.market_lot = market_lot;
    company.right_issue = right_issue;
    company.year_end = year_end;
    company.reserve_surplus_without_oci_mn = reserve_surplus_without_oci_mn;
    company.other_comprehensive_income_mn = other_comprehensive_income_mn;
    company.financial_statement_link = financial_statement_link;
    company.price_sensitive_info_link = price_sensitive_info_link;
    company.electronic_share = electronic_share;
    company.remarks = remarks;
    company.present_operational_status = present_operational_status;
    company.short_term_loan_mn = short_term_loan_mn;
    company.long_term_loan_mn = long_term_loan_mn;
    company.short_term_credit_rating = short_term_credit_rating;
    company.long_term_credit_rating = long_term_credit_rating;
    company.otc_delisting_relisting = otc_delisting_relisting;
    company.factory = factory;
    company.fax = fax;
    company.web_address = web_address;
    company.company_secretary_name = company_secretary_name;
    company.cell_no = cell_no;
    company.company_secretary_email = company_secretary_email;
    // company.created_at = date;

    //!==================================

    try {
      // await this.companiesModel.insertMany(company, {
      //   ordered: false,
      // });

      const recordDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

      const response = await this.companiesModel.updateOne(
        {
          code: company.code,
          recordDate,
        },
        {
          $set: {
            ...company,
            recordDate,
          },
        },
        {
          upsert: true,
        },
      );
    } catch (error) {
      console.log('Error in company_service');
    }
    //!==================================

    // const queryBuilder = this.companyRepository
    //   .createQueryBuilder()
    //   .insert()
    //   .into(Companies)
    //   .values(company)
    //   .orUpdate([
    //     'name',
    //     'last_agm',
    //     'market_capitalization_mn',
    //     'authorized_capital_mn',
    //     'paidup_capital_mn',
    //     'type_of_instrument',
    //     'total_outstanding_share_mn',
    //     'face_par_value',
    //     'sector',
    //     'cash_dividend',
    //     'dividend_yield_percentage',
    //     'bonus_issued_stock_dividend',
    //     'pe',
    //     'eps',
    //     'listing_since',
    //     'category',
    //     'sponsor_director',
    //     'govt',
    //     'institute',
    //     '_foreign',
    //     'public',
    //     'address',
    //     'phone',
    //     'email',
    //     'eps_share',
    //     'updated_at',
    //   ]);

    // await queryBuilder.execute();

    // const upsertedEntity = await this.companyRepository.findOneOrFail({
    //   where: { code: code },
    // });

    // return upsertedEntity;
  }
}
