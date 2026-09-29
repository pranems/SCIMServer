import { HttpException } from '@nestjs/common';
import { wrapPrismaError } from '../../../infrastructure/repositories/prisma/prisma-error.util';
import type { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { SCIM_DIAGNOSTICS_URN } from './scim-constants';
import { handleRepositoryError } from './scim-service-helpers';

describe('repository server-failure response contract', () => {
  it.each([
    ['injected private member failure', 'UNKNOWN', 500],
    ['ECONNREFUSED at private database host', 'CONNECTION', 503],
  ] as const)('does not return %s to the client', (message, code, status) => {
    const cause = new Error(message);
    const failure = wrapPrismaError(cause, 'Group.create(private-row-id)');
    const logError = jest.fn();
    const logger = { error: logError } as unknown as ScimLogger;
    expect(failure.code).toBe(code);

    try {
      handleRepositoryError(failure, 'create group', logger, LogCategory.SCIM_GROUP);
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      expect(error.getStatus()).toBe(status);
      const body = error.getResponse() as Record<string, unknown>;
      expect(body.detail).toBe('Failed to create group.');
      for (const key of Object.keys(body)) {
        expect(['schemas', 'status', 'scimType', 'detail', SCIM_DIAGNOSTICS_URN]).toContain(key);
      }
      expect(JSON.stringify(body)).not.toMatch(/private|injected/);
      expect(logError).toHaveBeenCalledWith(
        LogCategory.SCIM_GROUP,
        'Repository failure: create group',
        cause,
        { operation: 'create group', errorCode: code },
      );
      return;
    }
    throw new Error('Expected a mapped repository exception.');
  });
});
