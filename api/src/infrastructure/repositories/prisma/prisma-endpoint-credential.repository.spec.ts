import { PrismaEndpointCredentialRepository } from './prisma-endpoint-credential.repository';
import type { PrismaService } from '../../../modules/prisma/prisma.service';

describe('PrismaEndpointCredentialRepository - typed lookup (W3.5)', () => {
  it('queries by endpoint, credential type, active state, and expiry', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      endpointCredential: { findMany },
    } as unknown as PrismaService;
    const repo = new PrismaEndpointCredentialRepository(prisma);

    await repo.findActiveByEndpointAndType('ep-1', 'wif');

    expect(findMany).toHaveBeenCalledWith({
      where: {
        endpointId: 'ep-1',
        credentialType: 'wif',
        active: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: expect.any(Date) } },
        ],
      },
    });
  });

  it('rotates inside one transaction so replacement failure rolls back deactivation', async () => {
    const replacementError = new Error('replacement create failed');
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const create = jest.fn().mockRejectedValue(replacementError);
    const transaction = jest.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({ endpointCredential: { updateMany, create } }),
    );
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const repo = new PrismaEndpointCredentialRepository(prisma);

    await expect(repo.rotate('old-credential', {
      endpointId: 'ep-1',
      credentialType: 'bearer',
      credentialHash: 'replacement-hash',
    })).rejects.toBe(replacementError);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'old-credential', active: true },
      data: { active: false },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('reports whether a permanent delete removed exactly one row', async () => {
    const deleteMany = jest.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const prisma = { endpointCredential: { deleteMany } } as unknown as PrismaService;
    const repo = new PrismaEndpointCredentialRepository(prisma);

    await expect(repo.delete('credential-1')).resolves.toBe(true);
    await expect(repo.delete('credential-1')).resolves.toBe(false);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { id: 'credential-1', active: false },
    });
  });
});
