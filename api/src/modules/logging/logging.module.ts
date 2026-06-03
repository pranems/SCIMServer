import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { PrismaModule } from '../prisma/prisma.module';
import { LoggingService } from './logging.service';
import { ScimLogger } from './scim-logger.service';
import { LogQueryService } from './log-query.service';
import { LogConfigController } from './log-config.controller';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [LogConfigController],
  providers: [
    LoggingService,
    ScimLogger,
    LogQueryService,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor
    }
  ],
  exports: [LoggingService, ScimLogger, LogQueryService]
})
export class LoggingModule {}
