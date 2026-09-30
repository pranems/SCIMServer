import type { TestingModuleBuilder } from '@nestjs/testing';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createTestApp as createApp, resolveTestDatabaseUrl } from './app.helper';

const loadHarness = createRequire(__filename);
const { testGuard } = loadHarness(resolve(__dirname, '../../../../scripts/p1-validation/safety.cjs')) as {
  testGuard: () => Promise<unknown>;
};

export { resolveTestDatabaseUrl };

/** Only the owned P9 Jest configuration maps the ordinary helper to this one. */
export async function createTestApp(
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
) {
  const databaseUrl = process.env.DATABASE_URL;
  await testGuard();
  if (!databaseUrl || databaseUrl !== process.env.DATABASE_URL) {
    throw new Error('Verified database target changed during ownership verification.');
  }
  return createApp(customize, { databaseUrl });
}
