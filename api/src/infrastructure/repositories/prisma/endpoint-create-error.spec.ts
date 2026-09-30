import { wrapEndpointCreateError } from './endpoint-create-error';
import { EndpointNotFoundError } from '../../../domain/errors/endpoint-not-found.error';
import { RepositoryError } from '../../../domain/errors/repository-error';
import type { PrismaService } from '../../../modules/prisma/prisma.service';

describe('Endpoint-owned create error classification', () => {
  const endpointId = '76e3c596-22aa-4527-bd6d-234367d798e6';
  const findUnique = jest.fn();
  const prisma = { endpoint: { findUnique } } as unknown as PrismaService;
  beforeEach(() => { findUnique.mockReset(); });

  it.each(['P2003', 'P2025'])('confirms the missing endpoint before translating %s', async code => {
    findUnique.mockResolvedValue(null);
    const cause = Object.assign(new Error('Private driver detail'), { code });
    const error = await wrapEndpointCreateError(cause, 'create', endpointId, prisma);
    expect(error).toBeInstanceOf(EndpointNotFoundError);
    expect(error.message).toBe('Endpoint no longer exists');
    expect(error.cause).toBe(cause);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: endpointId }, select: { id: true } });
  });

  it('does not call a different missing FK an absent endpoint', async () => {
    findUnique.mockResolvedValue({ id: endpointId });
    const cause = Object.assign(new Error('Private ResourceMember driver detail'), {
      code: 'P2003', meta: { field_name: 'ResourceMember_memberResourceId_fkey' },
    });
    const error = await wrapEndpointCreateError(cause, 'create', endpointId, prisma);
    expect(error).not.toBeInstanceOf(EndpointNotFoundError);
    expect(error.code).toBe('UNKNOWN');
    expect(error.message).toBe('Unexpected persistence failure');
    expect(error.cause).toBe(cause);
  });

  it.each(['P1001', 'P1002', 'P1008', 'P1017'])('keeps outage %s distinct without probing for absence', async code => {
    const error = await wrapEndpointCreateError(Object.assign(new Error('Private database host'), { code }), 'create', endpointId, prisma);
    expect(error.code).toBe('CONNECTION');
    expect(error).not.toBeInstanceOf(EndpointNotFoundError);
    expect(error.message).not.toContain('Private database host');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('does not interpret a trigger failure as endpoint absence', async () => {
    const cause = Object.assign(new Error('Private SQL connect statement failed'), { code: 'P2010' });
    const error = await wrapEndpointCreateError(cause, 'create', endpointId, prisma);
    expect(error.code).toBe('UNKNOWN');
    expect(error.message).toBe('Unexpected persistence failure');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('does not interpret a failed endpoint lookup as absence', async () => {
    findUnique.mockRejectedValue(Object.assign(new Error('Database offline'), { code: 'P1001' }));
    const error = await wrapEndpointCreateError({ code: 'P2003' }, 'create', endpointId, prisma);
    expect(error.code).toBe('CONNECTION');
    expect(error).not.toBeInstanceOf(EndpointNotFoundError);
  });

  it('retains already classified failures for aggregate and conditional-write callers', async () => {
    const classified = new RepositoryError('CONFLICT', 'Already classified');
    expect(await wrapEndpointCreateError(classified, 'create', endpointId, prisma)).toBe(classified);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
