import type { TestingModuleBuilder } from '@nestjs/testing';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createTestApp as createApp } from './app.helper';

const loadHarness = createRequire(__filename);
const { guard } = loadHarness(resolve(__dirname, '../../../../scripts/scim-search-validation/safety.cjs')) as {
  guard: () => Promise<unknown>;
};

/** Opt-in bootstrap used only by the owned search validation Jest config. */
export async function createTestApp(
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
) {
  const databaseUrl = process.env.DATABASE_URL;
  await guard();
  if (!databaseUrl || databaseUrl !== process.env.DATABASE_URL) {
    throw new Error('Verified database target changed during ownership verification.');
  }
  return createApp(customize, { databaseUrl });
}
