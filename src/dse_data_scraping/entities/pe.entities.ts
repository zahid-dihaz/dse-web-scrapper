// import {
//   Entity,
//   Column,
//   // PrimaryGeneratedColumn,
//   PrimaryColumn,
//   BeforeInsert,
//   // CreateDateColumn,
// } from 'typeorm';

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type Price_earningsDocument = Price_earnings & Document;

// @Entity()
@Schema({
  collection: 'price_earnings_dses',
  timestamps: true, // Enables createdAt and updatedAt fields
})
export class Price_earnings {
  @Prop({ type: String })
  // @Column()
  // @PrimaryColumn()
  company_code: string; //!==============

  @Prop({ type: String })
  // @Column({ length: 100 })
  close_price: string;

  @Prop({ type: String })
  // @Column()
  // @PrimaryColumn()
  ycp: string;

  @Prop({ type: String })
  // @Column({ nullable: true })
  pe_1: string;

  @Prop({ type: String })
  // @Column({ nullable: true }) //, default: null
  pe_2: string;

  @Prop({ type: String })
  // @Column({ nullable: true })
  pe_3: string;

  @Prop({ type: String })
  // @Column({ nullable: true })
  pe_4: string;

  @Prop({ type: String })
  // @Column({ nullable: true })
  pe_5: string;

  @Prop({ type: String })
  // @Column({ nullable: true })
  pe_6: string;

  @Prop({ type: String })
  trailing_pe: string;

  // @Column({ type: 'date' })   // all types are working here
  // @CreateDateColumn()

  // @Prop({ type: Date, default: Date.now })
  // // @Column({ primary: true, type: 'date' })
  // // @PrimaryColumn({ type: 'date' })
  // created_at: Date;

  // @Prop({ type: Date, default: Date.now })
  // // @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  // // @PrimaryColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  // updated_at: Date; //! not tested

  // @BeforeInsert()
  // setPrimaryKey() {
  //   // this.created_at = new Date().toISOString().split('T')[0];
  //   this.created_at = new Date();
  // }
}

export const Price_earningsSchema =
  SchemaFactory.createForClass(Price_earnings);

Price_earningsSchema.index({ createdAt: 1, company_code: 1 }, { unique: true }); //Making compund Unique Key...!!!
