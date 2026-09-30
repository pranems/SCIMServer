import { Test, type TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EndpointScimUsersService } from './endpoint-scim-users.service';
import { EndpointScimGroupsService } from './endpoint-scim-groups.service';
import { EndpointScimGenericService } from './endpoint-scim-generic.service';
import { ScimMetadataService } from './scim-metadata.service';
import { ScimSchemaRegistry, type ScimResourceType } from '../discovery/scim-schema-registry';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import { ScimLogger } from '../../logging/scim-logger.service';
import {
  GENERIC_RESOURCE_REPOSITORY,
  GROUP_REPOSITORY,
  USER_REPOSITORY,
} from '../../../domain/repositories/repository.tokens';

describe('Resource service capability boundary', () => {
  let module: TestingModule;
  const reads = {
    findByScimId: jest.fn(),
    findWithMembers: jest.fn(),
    findAll: jest.fn(),
    findAllWithMembers: jest.fn(),
  };
  const resourceType: ScimResourceType = {
    id: 'Widget',
    name: 'Widget',
    description: 'Synthetic capability boundary resource',
    endpoint: '/Widgets',
    schema: 'urn:example:schemas:core:2.0:Widget',
    schemaExtensions: [],
  };
  const profile = {
    schemas: [],
    resourceTypes: [],
    settings: {},
    serviceProviderConfig: {
      patch: { supported: false },
      filter: { supported: false },
      sort: { supported: false },
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    module = await Test.createTestingModule({
      providers: [
        EndpointScimUsersService,
        EndpointScimGroupsService,
        EndpointScimGenericService,
        ScimSchemaRegistry,
        ScimMetadataService,
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: USER_REPOSITORY, useValue: reads },
        { provide: GROUP_REPOSITORY, useValue: reads },
        { provide: GENERIC_RESOURCE_REPOSITORY, useValue: reads },
        {
          provide: EndpointContextStorage,
          useValue: { getProfile: () => profile },
        },
        {
          provide: ScimLogger,
          useValue: {
            enrichContext: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            trace: jest.fn(),
          },
        },
      ],
    }).compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it.each(['User', 'Group', 'Widget'])(
    'rejects disabled %s PATCH before any repository read',
    async (kind) => {
      const dto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'displayName', value: 'updated' }],
      };
      const operation =
        kind === 'User'
          ? module
              .get(EndpointScimUsersService)
              .patchUserForEndpoint('id', dto, 'http://localhost/scim', 'endpoint')
          : kind === 'Group'
            ? module
                .get(EndpointScimGroupsService)
                .patchGroupForEndpoint('id', dto, 'http://localhost/scim', 'endpoint')
            : module
                .get(EndpointScimGenericService)
                .patchResource('id', dto, 'http://localhost/scim', 'endpoint', resourceType);
      await expect(operation).rejects.toMatchObject({ status: 501 });
      expect(reads.findByScimId).not.toHaveBeenCalled();
      expect(reads.findWithMembers).not.toHaveBeenCalled();
    },
  );

  it.each(['filter', 'sort'])(
    'rejects disabled custom %s before any repository read',
    async (capability) => {
      const query =
        capability === 'filter' ? { filter: 'displayName eq "sample"' } : { sortBy: 'displayName' };
      const operation = module
        .get(EndpointScimGenericService)
        .listResources(query, 'http://localhost/scim', 'endpoint', resourceType);
      await expect(operation).rejects.toMatchObject({ status: 403 });
      expect(reads.findAll).not.toHaveBeenCalled();
      expect(reads.findAllWithMembers).not.toHaveBeenCalled();
    },
  );
});
