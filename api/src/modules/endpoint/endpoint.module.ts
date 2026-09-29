import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EndpointService } from './services/endpoint.service';
import { EndpointController } from './controllers/endpoint.controller';
import { RepositoryModule } from '../../infrastructure/repositories/repository.module';

@Module({
  imports: [PrismaModule, RepositoryModule.register()],
  controllers: [EndpointController],
  providers: [EndpointService],
  exports: [EndpointService] // Export for use in other modules
})
export class EndpointModule {}
