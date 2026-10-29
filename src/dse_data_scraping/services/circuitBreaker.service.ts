// company.service.ts
import { Inject, Injectable } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
import { CreateCircuitBreakerDto } from '../dto/circuitBreaker.dto';

//!===========================
// import { GetService } from './delete.service';
//!===========================

import {
  Circuit_breaks,
  Circuit_breaksDocument,
} from '../entities/circuitBreaker.entities';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';

@Injectable()
export class CircuitBreakerService {
  constructor(
    @InjectModel('Circuit_breaks')
    private circuit_breaksModel: Model<Circuit_breaksDocument>, // @Inject(GetService) // private readonly getService: GetService,
  ) {}

  async upsertCircuitBreakerEntity(
    createCircuitBreakerDtos: CreateCircuitBreakerDto[],
  ): Promise<void> {
    for (const createCircuitBreakerDto of createCircuitBreakerDtos) {
      const {
        trade_code,
        breaker,
        tickSize,
        openAdjPrice,
        floorPrice,
        lowerLimit,
        upperLimit,
        floorPriceBlockMarket,
        // date,
      } = createCircuitBreakerDto;
      const circuitBreaker = new Circuit_breaks();

      circuitBreaker.trade_code = trade_code;
      circuitBreaker.breaker = breaker;
      circuitBreaker.tickSize = tickSize;
      circuitBreaker.openAdjPrice = openAdjPrice;
      circuitBreaker.floorPrice = floorPrice;
      circuitBreaker.lowerLimit = lowerLimit;
      circuitBreaker.upperLimit = upperLimit;
      circuitBreaker.floorPriceBlockMarket = floorPriceBlockMarket;

      //!==================================

      try {
        //!===================
        const currentTime = new Date().toLocaleString('en-US', {
          timeZone: 'Asia/Dhaka',
        });

        // Get the next day's date
        const currentDate = currentTime.split(',')[0];
        const nextDay = new Date(currentDate);
        nextDay.setDate(nextDay.getDate() + 1);

        //!===================

        await this.circuit_breaksModel.updateOne(
          {
            trade_code: trade_code,
            updatedAt: {
              $gte: new Date(currentDate),
              $lt: new Date(nextDay),
            },
          },
          {
            $set: circuitBreaker,
          },
          { upsert: true },
        );
      } catch (error) {
        console.log('Error in circuit_breaker_service', error);
      }
      //!==================================
    }

    //!===========================
    // await this.getService.upsertCircuitBreakerEntity();
    //!===========================
  }
}
