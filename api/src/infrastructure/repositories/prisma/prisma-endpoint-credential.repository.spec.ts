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
});
