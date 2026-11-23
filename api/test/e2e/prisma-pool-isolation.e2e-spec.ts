import pg from 'pg';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

const postgres = process.env.PERSISTENCE_BACKEND?.toLowerCase() === 'inmemory' ? describe.skip : describe;

postgres('application PostgreSQL startup isolation', () => {
  let prisma: PrismaService;
  let control: pg.Pool;

  beforeAll(async () => {
    const original = process.env.DATABASE_URL;
    if (!original) throw new Error('An owned PostgreSQL DATABASE_URL is required.');
    const url = new URL(original);
    const options = url.searchParams.get('options') ?? '';
    url.searchParams.set('options', `${options} -c default_transaction_isolation=serializable`.trim());
    try {
      process.env.DATABASE_URL = url.toString();
      control = new pg.Pool({ connectionString: process.env.DATABASE_URL });
      prisma = new PrismaService();
      await prisma.$connect();
    } finally {
      process.env.DATABASE_URL = original;
    }
  });

  afterAll(async () => {
    await prisma?.onApplicationShutdown();
    await control?.end();
  });

  it('overrides a conflicting connection option while preserving independent concurrent leases', async () => {
    const raw = await control.query<{ default_transaction_isolation: string }>('SHOW default_transaction_isolation');
    expect(raw.rows[0].default_transaction_isolation).toBe('serializable');

    let entered = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let sessions: { pid: number; isolation: string }[];
    try {
      sessions = await Promise.all([0, 1].map(() => prisma.$transaction(async tx => {
        const [session] = await tx.$queryRaw<{ pid: number; isolation: string }[]>`
          SELECT pg_backend_pid() AS pid, current_setting('transaction_isolation') AS isolation`;
        if (++entered === 2) release();
        await barrier;
        return session;
      })));
    } finally {
      release();
    }
    expect(new Set(sessions.map(session => session.pid)).size).toBe(2);
    expect(sessions.map(session => session.isolation)).toEqual(['read committed', 'read committed']);
  });

  it('still honors an explicitly requested stronger transaction isolation', async () => {
    const rows = await prisma.$transaction(
      tx => tx.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`,
      { isolationLevel: 'Serializable' },
    );
    expect(rows).toEqual([{ transaction_isolation: 'serializable' }]);
  });
});
