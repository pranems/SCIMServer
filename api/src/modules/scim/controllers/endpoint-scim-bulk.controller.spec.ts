import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { EndpointScimBulkController } from './endpoint-scim-bulk.controller';
import { BulkProcessorService } from '../services/bulk-processor.service';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import { ENDPOINT_CONFIG_FLAGS } from '../../endpoint/endpoint-config.interface';
import { SCIM_BULK_REQUEST_SCHEMA, BULK_MAX_PAYLOAD_SIZE } from '../dto/bulk-request.dto';
import type { BulkRequestDto } from '../dto/bulk-request.dto';

describe('EndpointScimBulkController', () => {
  let controller: EndpointScimBulkController;
  let bulkProcessor: BulkProcessorService;
  let endpointService: EndpointService;

  const makeEndpoint = (configOverrides: Record<string, unknown> = {}) => ({
    id: 'ep-1',
    name: 'test-endpoint',
    displayName: 'Test Endpoint',
    description: 'Test',
    config: configOverrides,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const mockRequest = {
    protocol: 'http',
    headers: { 'content-length': '256' } as Record<string, string>,
    baseUrl: '/scim',
    get: jest.fn((header: string) => {
      if (header === 'host') return 'localhost:3000';
      return undefined;
    }),
    originalUrl: '/scim/endpoints/ep-1/Bulk',
  } as any;

  const validDto: BulkRequestDto = {
    schemas: [SCIM_BULK_REQUEST_SCHEMA],
    Operations: [
      { method: 'POST', path: '/Users', bulkId: 'u1', data: { userName: 'alice' } },
    ],
  };

  const mockBulkProcessor = {
    process: jest.fn().mockResolvedValue({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkResponse'],
      Operations: [{ method: 'POST', bulkId: 'u1', status: '201', location: 'http://localhost:3000/scim/endpoints/ep-1/Users/u-001' }],
    }),
  };

  const mockEndpointService = {
    getEndpoint: jest.fn(),
  };

  const mockEndpointContext = {
    setContext: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EndpointScimBulkController],
      providers: [
        { provide: BulkProcessorService, useValue: mockBulkProcessor },
        { provide: EndpointService, useValue: mockEndpointService },
        { provide: EndpointContextStorage, useValue: mockEndpointContext },
      ],
    }).compile();

    controller = module.get<EndpointScimBulkController>(EndpointScimBulkController);
    bulkProcessor = module.get<BulkProcessorService>(BulkProcessorService);
    endpointService = module.get<EndpointService>(EndpointService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Config flag gate ─────────────────────────────────────────────────────

  describe('BulkOperationsEnabled config flag gate', () => {
    it('should return 403 when BulkOperationsEnabled is not set', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(makeEndpoint({}));

      await expect(
        controller.processBulk('ep-1', validDto, mockRequest),
      ).rejects.toThrow(ForbiddenException);
      expect(mockBulkProcessor.process).not.toHaveBeenCalled();
    });

    it('should return 403 when BulkOperationsEnabled is "False"', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(
        makeEndpoint({ [ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED]: 'False' }),
      );

      await expect(
        controller.processBulk('ep-1', validDto, mockRequest),
      ).rejects.toThrow(ForbiddenException);
      expect(mockBulkProcessor.process).not.toHaveBeenCalled();
    });

    it('should return 403 when BulkOperationsEnabled is false (boolean)', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(
        makeEndpoint({ [ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED]: false }),
      );

      await expect(
        controller.processBulk('ep-1', validDto, mockRequest),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should proceed when BulkOperationsEnabled is "True"', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(
        makeEndpoint({ [ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED]: 'True' }),
      );

      const result = await controller.processBulk('ep-1', validDto, mockRequest);
      expect(mockBulkProcessor.process).toHaveBeenCalled();
      expect(result.Operations).toHaveLength(1);
    });

    it('should proceed when BulkOperationsEnabled is true (boolean)', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(
        makeEndpoint({ [ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED]: true }),
      );

      const result = await controller.processBulk('ep-1', validDto, mockRequest);
      expect(mockBulkProcessor.process).toHaveBeenCalled();
    });

    it('should proceed when BulkOperationsEnabled is "1"', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(
        makeEndpoint({ [ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED]: '1' }),
      );

      const result = await controller.processBulk('ep-1', validDto, mockRequest);
      expect(mockBulkProcessor.process).toHaveBeenCalled();
    });
  });

  // ─── Endpoint validation ──────────────────────────────────────────────────

  describe('endpoint validation', () => {
    it('should return 403 when endpoint is inactive', async () => {
      const inactiveEndpoint = { ...makeEndpoint({ [ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED]: 'True' }), active: false };
      mockEndpointService.getEndpoint.mockResolvedValue(inactiveEndpoint);

      await expect(
        controller.processBulk('ep-1', validDto, mockRequest),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Schema validation ────────────────────────────────────────────────────

  describe('schema validation', () => {
    it('should return 400 when BulkRequest schema is missing', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(
        makeEndpoint({ [ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED]: 'True' }),
      );

      const badDto: BulkRequestDto = {
        schemas: ['urn:wrong:schema'],
        Operations: [{ method: 'POST', path: '/Users', bulkId: 'u1', data: { userName: 'x' } }],
      };

      await expect(
        controller.processBulk('ep-1', badDto, mockRequest),
      ).rejects.toThrow();
    });
  });

  // ─── Payload size guard ───────────────────────────────────────────────────

  describe('payload size guard', () => {
    it('should return 413 when content-length exceeds max payload size', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(
        makeEndpoint({ [ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED]: 'True' }),
      );

      const largeReq = {
        ...mockRequest,
        headers: { ...mockRequest.headers, 'content-length': String(BULK_MAX_PAYLOAD_SIZE + 1) },
      };

      await expect(
        controller.processBulk('ep-1', validDto, largeReq),
      ).rejects.toThrow();
    });
  });

  // ─── Successful processing ────────────────────────────────────────────────

  describe('successful processing', () => {
    it('should delegate to BulkProcessorService with correct parameters', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(
        makeEndpoint({ [ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED]: 'True' }),
      );

      const dtoWithFailOnErrors: BulkRequestDto = {
        schemas: [SCIM_BULK_REQUEST_SCHEMA],
        failOnErrors: 3,
        Operations: [
          { method: 'POST', path: '/Users', bulkId: 'u1', data: { userName: 'alice' } },
          { method: 'DELETE', path: '/Users/u-old' },
        ],
      };

      await controller.processBulk('ep-1', dtoWithFailOnErrors, mockRequest);

      expect(mockBulkProcessor.process).toHaveBeenCalledWith(
        'ep-1',
        dtoWithFailOnErrors.Operations,
        expect.stringContaining('/endpoints/ep-1'),
        expect.objectContaining({ [ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED]: 'True' }),
        3,
      );
    });

    it('should pass failOnErrors=0 when not specified in request', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue(
        makeEndpoint({ [ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED]: 'True' }),
      );

      await controller.processBulk('ep-1', validDto, mockRequest);

      expect(mockBulkProcessor.process).toHaveBeenCalledWith(
        'ep-1',
        validDto.Operations,
        expect.any(String),
        expect.any(Object),
        0,
      );
    });
  });
});
