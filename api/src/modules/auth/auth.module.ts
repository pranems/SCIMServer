import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';

import { SharedSecretGuard } from './shared-secret.guard';
import { OAuthModule } from '../../oauth/oauth.module';
import { EndpointModule } from '../endpoint/endpoint.module';
import { RepositoryModule } from '../../infrastructure/repositories/repository.module';

@Module({
  imports: [ConfigModule, OAuthModule, EndpointModule, RepositoryModule.register()],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SharedSecretGuard
    }
  ]
})
export class AuthModule {}
