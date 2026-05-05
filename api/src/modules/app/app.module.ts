import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';

import { ActivityParserModule } from '../activity-parser/activity-parser.module';
import { AuthModule } from '../auth/auth.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DatabaseModule } from '../database/database.module';
import { LoggingModule } from '../logging/logging.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScimModule } from '../scim/scim.module';
import { EndpointModule } from '../endpoint/endpoint.module';
import { StatsModule } from '../stats/stats.module';
import { WebModule } from '../web/web.module';
import { OAuthModule } from '../../oauth/oauth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ActivityParserModule,
    AuthModule,
    DashboardModule,
    DatabaseModule,
    PrismaModule,
    LoggingModule,
    EndpointModule,
    ScimModule,
    StatsModule,
    WebModule,
    OAuthModule
  ]
})
export class AppModule {}
