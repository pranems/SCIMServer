import { HttpException } from '@nestjs/common';
import { createScimError } from './scim-errors';

describe('createScimError', () => {
  it('should return an HttpException', () => {
    const err = createScimError({ status: 400, detail: 'bad request' });
    expect(err).toBeInstanceOf(HttpException);
  });

  it('should set the HTTP status code', () => {
    const err = createScimError({ status: 404, detail: 'not found' });
    expect(err.getStatus()).toBe(404);
  });

  it('should include SCIM error schema in response body', () => {
    const err = createScimError({ status: 400, detail: 'test' });
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
  });

  it('should include detail message in response body', () => {
    const err = createScimError({ status: 400, detail: 'Invalid filter syntax' });
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.detail).toBe('Invalid filter syntax');
  });

  it('should include scimType when provided', () => {
    const err = createScimError({ status: 400, detail: 'bad', scimType: 'invalidFilter' });
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.scimType).toBe('invalidFilter');
  });

  it('should omit scimType when not provided', () => {
    const err = createScimError({ status: 500, detail: 'server error' });
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.scimType).toBeUndefined();
  });

  it('should convert status to string per RFC 7644 §3.12', () => {
    const err = createScimError({ status: 409, detail: 'conflict' });
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.status).toBe('409');
    expect(typeof body.status).toBe('string');
  });

  it('should handle various status codes correctly', () => {
    const cases = [
      { status: 400, detail: 'Bad Request', scimType: 'invalidSyntax' },
      { status: 401, detail: 'Unauthorized' },
      { status: 404, detail: 'Not Found', scimType: 'noTarget' },
      { status: 409, detail: 'Conflict', scimType: 'uniqueness' },
      { status: 412, detail: 'Precondition Failed', scimType: 'versionMismatch' },
      { status: 501, detail: 'Not Implemented', scimType: 'mutability' },
    ];

    for (const { status, detail, scimType } of cases) {
      const err = createScimError({ status, detail, scimType });
      expect(err.getStatus()).toBe(status);
      const body = err.getResponse() as Record<string, unknown>;
      expect(body.detail).toBe(detail);
      expect(body.status).toBe(String(status));
    }
  });

  // ─── Diagnostics Extension (Phase A Step 4) ────────────────────────────

  describe('diagnostics extension', () => {
    const DIAGNOSTICS_URN = 'urn:scimserver:api:messages:2.0:Diagnostics';

    it('should include diagnostics extension when triggeredBy is provided', () => {
      const err = createScimError({
        status: 400,
        detail: 'Schema validation failed',
        diagnostics: { triggeredBy: 'StrictSchemaValidation' },
      });
      const body = err.getResponse() as Record<string, unknown>;
      const diag = body[DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag).toBeDefined();
      expect(diag.triggeredBy).toBe('StrictSchemaValidation');
    });

    it('should not include diagnostics extension when no context and no diagnostics', () => {
      // Outside request scope - no correlation context
      const err = createScimError({ status: 400, detail: 'test' });
      const body = err.getResponse() as Record<string, unknown>;
      expect(body[DIAGNOSTICS_URN]).toBeUndefined();
    });

    it('should include extra fields in diagnostics', () => {
      const err = createScimError({
        status: 500,
        detail: 'DB error',
        diagnostics: { triggeredBy: 'database', extra: { errorCode: 'CONNECTION' } },
      });
      const body = err.getResponse() as Record<string, unknown>;
      const diag = body[DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag).toBeDefined();
      expect(diag.triggeredBy).toBe('database');
      expect(diag.errorCode).toBe('CONNECTION');
    });

    it('should auto-enrich with requestId and endpointId from correlation context', () => {
      // Simulate being inside a request scope
      const { AsyncLocalStorage } = require('async_hooks');
      const { getCorrelationContext } = require('../../logging/scim-logger.service');

      // We need to use ScimLogger's runWithContext - but since createScimError reads
      // the module-level correlationStorage directly via getCorrelationContext(),
      // we verify it works by calling within a ScimLogger context.
      const ScimLoggerModule = require('../../logging/scim-logger.service');
      const logger = new ScimLoggerModule.ScimLogger();

      let body: Record<string, unknown> | undefined;
      logger.runWithContext(
        { requestId: 'test-req-id', endpointId: 'ep-test-123' },
        () => {
          const err = createScimError({
            status: 400,
            detail: 'Schema validation failed',
            diagnostics: { triggeredBy: 'StrictSchemaValidation' },
          });
          body = err.getResponse() as Record<string, unknown>;
        },
      );

      const diag = body![DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag).toBeDefined();
      expect(diag.requestId).toBe('test-req-id');
      expect(diag.endpointId).toBe('ep-test-123');
      expect(diag.triggeredBy).toBe('StrictSchemaValidation');
      expect(diag.logsUrl).toContain('/scim/endpoints/ep-test-123/logs/recent?requestId=test-req-id');
    });

    it('should fallback to admin logsUrl when endpointId is not available', () => {
      const ScimLoggerModule = require('../../logging/scim-logger.service');
      const logger = new ScimLoggerModule.ScimLogger();

      let body: Record<string, unknown> | undefined;
      logger.runWithContext(
        { requestId: 'test-req-no-ep' },
        () => {
          const err = createScimError({
            status: 400,
            detail: 'test',
            diagnostics: { triggeredBy: 'test' },
          });
          body = err.getResponse() as Record<string, unknown>;
        },
      );

      const diag = body![DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag.logsUrl).toContain('/scim/admin/log-config/recent?requestId=test-req-no-ep');
      expect(diag.logsUrl).not.toContain('/endpoints/');
    });

    it('should preserve standard SCIM error fields alongside diagnostics', () => {
      const err = createScimError({
        status: 409,
        detail: 'Duplicate userName',
        scimType: 'uniqueness',
        diagnostics: { triggeredBy: 'uniqueness-check' },
      });
      const body = err.getResponse() as Record<string, unknown>;

      // Standard fields preserved
      expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
      expect(body.detail).toBe('Duplicate userName');
      expect(body.scimType).toBe('uniqueness');
      expect(body.status).toBe('409');

      // Diagnostics added alongside
      const diag = body[DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag).toBeDefined();
      expect(diag.triggeredBy).toBe('uniqueness-check');
    });

    it('should auto-enrich with context even when diagnostics param is omitted', () => {
      const ScimLoggerModule = require('../../logging/scim-logger.service');
      const logger = new ScimLoggerModule.ScimLogger();

      let body: Record<string, unknown> | undefined;
      logger.runWithContext(
        { requestId: 'auto-enrich-req', endpointId: 'ep-auto' },
        () => {
          const err = createScimError({
            status: 404,
            detail: 'Not found',
            scimType: 'noTarget',
            // NO diagnostics param - should still auto-enrich from context
          });
          body = err.getResponse() as Record<string, unknown>;
        },
      );

      const diag = body![DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag).toBeDefined();
      expect(diag.requestId).toBe('auto-enrich-req');
      expect(diag.endpointId).toBe('ep-auto');
      expect(diag.triggeredBy).toBeUndefined(); // no triggeredBy since no diagnostics param
      expect(diag.logsUrl).toContain('ep-auto');
    });

    it('should include extra fields without triggeredBy', () => {
      const err = createScimError({
        status: 500,
        detail: 'DB error',
        diagnostics: { extra: { errorCode: 'CONNECTION', operation: 'create' } },
      });
      const body = err.getResponse() as Record<string, unknown>;
      const diag = body[DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag).toBeDefined();
      expect(diag.errorCode).toBe('CONNECTION');
      expect(diag.operation).toBe('create');
      expect(diag.triggeredBy).toBeUndefined();
    });

    // ── Phase 1: attributePaths + schemaUrn enrichment ─────────────────

    it('should include attributePaths array in diagnostics when provided', () => {
      const err = createScimError({
        status: 400,
        detail: 'Schema validation failed',
        diagnostics: {
          errorCode: 'VALIDATION_SCHEMA',
          triggeredBy: 'StrictSchemaValidation',
          attributePaths: [
            'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User.costCenter',
            'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User.organization',
          ],
        },
      });
      const body = err.getResponse() as Record<string, unknown>;
      const diag = body[DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag).toBeDefined();
      expect(diag.attributePaths).toEqual([
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User.costCenter',
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User.organization',
      ]);
    });

    it('should set attributePath to first element of attributePaths when attributePath not explicitly set', () => {
      const err = createScimError({
        status: 400,
        detail: 'Schema validation failed',
        diagnostics: {
          errorCode: 'VALIDATION_SCHEMA',
          attributePaths: ['emails[0].type', 'name.givenName'],
        },
      });
      const body = err.getResponse() as Record<string, unknown>;
      const diag = body[DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag.attributePath).toBe('emails[0].type');
      expect(diag.attributePaths).toEqual(['emails[0].type', 'name.givenName']);
    });

    it('should NOT override explicit attributePath when attributePaths also provided', () => {
      const err = createScimError({
        status: 400,
        detail: 'Immutable violation',
        diagnostics: {
          errorCode: 'VALIDATION_IMMUTABLE',
          attributePath: 'externalId',
          attributePaths: ['externalId', 'userName'],
        },
      });
      const body = err.getResponse() as Record<string, unknown>;
      const diag = body[DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag.attributePath).toBe('externalId');
      expect(diag.attributePaths).toEqual(['externalId', 'userName']);
    });

    it('should include schemaUrn in diagnostics when provided', () => {
      const err = createScimError({
        status: 400,
        detail: 'Schema validation failed',
        diagnostics: {
          errorCode: 'VALIDATION_SCHEMA',
          schemaUrn: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
        },
      });
      const body = err.getResponse() as Record<string, unknown>;
      const diag = body[DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag.schemaUrn).toBe('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User');
    });

    it('should omit attributePaths from diagnostics when empty array provided', () => {
      const err = createScimError({
        status: 400,
        detail: 'test',
        diagnostics: {
          errorCode: 'VALIDATION_SCHEMA',
          attributePaths: [],
        },
      });
      const body = err.getResponse() as Record<string, unknown>;
      const diag = body[DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag.attributePaths).toBeUndefined();
    });

    it('should include single-element attributePaths and set attributePath', () => {
      const err = createScimError({
        status: 400,
        detail: 'test',
        diagnostics: {
          errorCode: 'VALIDATION_IMMUTABLE',
          attributePaths: ['userName'],
        },
      });
      const body = err.getResponse() as Record<string, unknown>;
      const diag = body[DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag.attributePath).toBe('userName');
      expect(diag.attributePaths).toEqual(['userName']);
    });

    // ── Phase 3: activeConfig snapshot ───────────────────────────────

    it('should include activeConfig in diagnostics when provided', () => {
      const err = createScimError({
        status: 400,
        detail: 'Schema validation failed',
        diagnostics: {
          errorCode: 'VALIDATION_SCHEMA',
          triggeredBy: 'StrictSchemaValidation',
          activeConfig: {
            StrictSchemaValidation: true,
            IgnoreReadOnlyAttributesInPatch: false,
          },
        },
      });
      const body = err.getResponse() as Record<string, unknown>;
      const diag = body[DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag.activeConfig).toBeDefined();
      expect((diag.activeConfig as Record<string, unknown>).StrictSchemaValidation).toBe(true);
      expect((diag.activeConfig as Record<string, unknown>).IgnoreReadOnlyAttributesInPatch).toBe(false);
    });

    it('should omit activeConfig when not provided', () => {
      const err = createScimError({
        status: 400,
        detail: 'test',
        diagnostics: { errorCode: 'VALIDATION_SCHEMA' },
      });
      const body = err.getResponse() as Record<string, unknown>;
      const diag = body[DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag.activeConfig).toBeUndefined();
    });

    // ── Phase 4: filterExpression ────────────────────────────────────

    it('should include filterExpression in diagnostics when provided', () => {
      const err = createScimError({
        status: 400,
        detail: 'Filter validation failed',
        scimType: 'invalidFilter',
        diagnostics: {
          errorCode: 'VALIDATION_FILTER',
          filterExpression: 'userName eq "test" and bogusAttr pr',
        },
      });
      const body = err.getResponse() as Record<string, unknown>;
      const diag = body[DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag.filterExpression).toBe('userName eq "test" and bogusAttr pr');
    });

    it('should omit filterExpression when not provided', () => {
      const err = createScimError({
        status: 400,
        detail: 'test',
        diagnostics: { errorCode: 'VALIDATION_FILTER' },
      });
      const body = err.getResponse() as Record<string, unknown>;
      const diag = body[DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag.filterExpression).toBeUndefined();
    });

    it('should auto-read operation from correlation context when not in diagnostics (Step 3.3)', () => {
      const ScimLoggerModule = require('../../logging/scim-logger.service');
      const logger = new ScimLoggerModule.ScimLogger();

      let body: Record<string, unknown> | undefined;
      logger.runWithContext(
        { requestId: 'op-test-req', endpointId: 'ep-op', operation: 'replace' },
        () => {
          const err = createScimError({
            status: 400,
            detail: 'Schema validation failed',
            diagnostics: { triggeredBy: 'StrictSchemaValidation' },
          });
          body = err.getResponse() as Record<string, unknown>;
        },
      );

      const diag = body![DIAGNOSTICS_URN] as Record<string, unknown>;
      expect(diag).toBeDefined();
      expect(diag.operation).toBe('replace');
    });
  });
});
