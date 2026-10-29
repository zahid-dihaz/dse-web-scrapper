// import {
//   Entity,
//   Column,
//   // PrimaryGeneratedColumn,
//   PrimaryColumn,
//   // CreateDateColumn,
// } from 'typeorm';

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CompaniesDocument = Companies & Document;

// @Entity()
@Schema({
  collection: 'companies_dses',
  timestamps: true, // Enables createdAt and updatedAt fields
})
export class Companies {
  // @Prop({ type: String, index: true, unique: true })
  @Prop({ type: String, required: true, index: true })
  // @Column()
  // @PrimaryColumn()
  code: string;

  @Prop({ type: String, required: true, index: true })
  recordDate: string;

  @Prop({ type: String })
  // @Column({ length: 100 })
  name: string;

  @Prop({ type: String })
  // @Column()
  last_agm: string;

  @Prop({ type: String })
  // @Column()
  market_capitalization_mn: string;

  @Prop({ type: String })
  // @Column()
  authorized_capital_mn: string; //!=========

  @Prop({ type: String })
  // @Column()
  paidup_capital_mn: string;

  @Prop({ type: String })
  // @Column()
  type_of_instrument: string;

  @Prop({ type: String })
  // @Column()
  total_outstanding_share_mn: string;

  @Prop({ type: String })
  // @Column()
  face_par_value: string;

  @Prop({ type: String })
  // @Column()
  sector: string;

  @Prop({ type: String })
  // @Column()
  cash_dividend: string;

  @Prop({ type: String })
  // @Column({ nullable: true })
  dividend_yield_percentage: string;

  @Prop({ type: String })
  // @Column()
  bonus_issued_stock_dividend: string;

  @Prop({ type: String })
  // @Column({ nullable: true })
  pe: string;

  @Prop({ type: String })
  // @Column({ nullable: true })
  eps: string;

  @Prop({ type: String })
  // @Column()
  listing_since: string;

  @Prop({ type: String })
  // @Column()
  category: string;

  @Prop({ type: String })
  // @Column()
  sponsor_director: string; //!-================

  @Prop({ type: String })
  // @Column({ nullable: true })
  govt: string;

  @Prop({ type: String })
  // @Column({ nullable: true })
  institute: string;

  @Prop({ type: String })
  // @Column({ nullable: true })
  _foreign: string;

  @Prop({ type: String })
  // @Column({ nullable: true })
  public: string;

  @Prop({ type: String })
  // @Column({ nullable: true })
  address: string;

  @Prop({ type: String })
  // @Column({ nullable: true })
  phone: string;

  @Prop({ type: String })
  // @Column({ nullable: true })
  email: string;

  // @Column('json', { nullable: true })
  @Prop({ type: JSON, nullable: true })
  eps_share: JSON;

  @Prop({ type: JSON, nullable: true })
  diluted_eps_share: JSON;

  @Prop({ type: JSON, nullable: true })
  eps_continuing_ops_share: JSON;

  @Prop({ type: JSON, nullable: true })
  diluted_eps_continuing_ops_share: JSON;

  @Prop({ type: JSON, nullable: true })
  market_price_per_share_quarterly: JSON;

  @Prop({ type: String })
  pe_diluted: string;

  @Prop({ type: String })
  pe_unaudited: string;

  @Prop({ type: String })
  pe_diluted_unaudited: string;

  @Prop({ type: String })
  trailing_pe_ratio: string;

  @Prop({ type: JSON, nullable: true })
  yearly_financial_performance: JSON;

  @Prop({ type: JSON, nullable: true })
  yearly_pe_dividend: JSON;

  @Prop({ type: String })
  scrip_code: string;

  @Prop({ type: String })
  last_trading_price: string;

  @Prop({ type: String })
  last_update_time: string;

  @Prop({ type: String })
  closing_price: string;

  @Prop({ type: String })
  opening_price: string;

  @Prop({ type: String })
  adjusted_opening_price: string;

  @Prop({ type: String })
  yesterdays_closing_price: string;

  @Prop({ type: String })
  change_percentage: string;

  @Prop({ type: String })
  days_range: string;

  @Prop({ type: String })
  week_52_range: string;

  @Prop({ type: String })
  days_trade_nos: string;

  @Prop({ type: String })
  days_volume_nos: string;

  @Prop({ type: String })
  days_value_mn: string;

  @Prop({ type: String })
  free_float_market_cap_mn: string;

  @Prop({ type: String })
  debut_trading_date: string;

  @Prop({ type: String })
  market_lot: string;

  @Prop({ type: String })
  right_issue: string;

  @Prop({ type: String })
  year_end: string;

  @Prop({ type: String })
  reserve_surplus_without_oci_mn: string;

  @Prop({ type: String })
  other_comprehensive_income_mn: string;

  @Prop({ type: String })
  financial_statement_link: string;

  @Prop({ type: String })
  price_sensitive_info_link: string;

  @Prop({ type: String })
  electronic_share: string;

  @Prop({ type: String })
  remarks: string;

  @Prop({ type: String })
  present_operational_status: string;

  @Prop({ type: String })
  short_term_loan_mn: string;

  @Prop({ type: String })
  long_term_loan_mn: string;

  @Prop({ type: String })
  short_term_credit_rating: string;

  @Prop({ type: String })
  long_term_credit_rating: string;

  @Prop({ type: String })
  otc_delisting_relisting: string;

  @Prop({ type: String })
  factory: string;

  @Prop({ type: String })
  fax: string;

  @Prop({ type: String })
  web_address: string;

  @Prop({ type: String })
  company_secretary_name: string;

  @Prop({ type: String })
  cell_no: string;

  @Prop({ type: String })
  company_secretary_email: string;

  // // @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  // @Prop({ type: Date })
  // updated_at: Date;

  // // @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  // @Prop({ type: Date })
  // created_at: Date;
}

export const CompaniesSchema = SchemaFactory.createForClass(Companies);

CompaniesSchema.index(
  {
    code: 1,
    recordDate: 1,
  },
  {
    unique: true,
  },
);
