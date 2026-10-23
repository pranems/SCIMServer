const assert = require('node:assert/strict');
const { EndpointService } = require('../../src/modules/endpoint/services/endpoint.service.ts');
const {
  PrismaEndpointLifecycleRepository,
} = require('../../src/infrastructure/repositories/prisma/prisma-endpoint-lifecycle.repository.ts');

async function main() {
  assert.equal(require.main, module);
  assert.equal(process.env.PERSISTENCE_BACKEND, 'prisma');
  const timezoneOffset = new Date(2026, 0, 1).getTimezoneOffset();
  assert.equal(timezoneOffset, 300);
  const id = '76e3c596-22aa-4527-bd6d-234367d798e6';
  let snapshotReads = 0;
  const prisma = {
    async $queryRaw(_sql, endpointId, knownFingerprint) {
      assert.equal(endpointId, id);
      assert.equal(knownFingerprint, null);
      snapshotReads++;
      return [
        {
          fingerprint: '00000000-0000-4000-8000-000000000001',
          endpoint: {
            id,
            name: 'timezone-probe',
            displayName: 'Timezone probe',
            description: null,
            active: true,
            profile: {
              schemas: [],
              resourceTypes: [],
              settings: { logFileEnabled: false },
            },
            createdAt: '2026-01-01T00:00:00.000',
            updatedAt: '2026-01-01T00:00:00.000',
          },
        },
      ];
    },
  };
  const logger = {
    clearEndpointLevel() {},
    disableEndpointFileLogging() {},
  };
  const service = new EndpointService(
    prisma,
    logger,
    new PrismaEndpointLifecycleRepository(prisma),
  );
  const endpoint = await service.getEndpoint(id);
  process.stdout.write(
    JSON.stringify({
      runner: 'standalone-production-path',
      entrypoint: process.argv[1],
      execArgv: process.execArgv,
      timezoneOffset,
      snapshotReads,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
