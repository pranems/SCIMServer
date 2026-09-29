import { Test } from '@nestjs/testing';
import fs from 'node:fs';
import { createTestApp, resolveTestDatabaseUrl } from '../../../../test/e2e/helpers/app.helper';

describe('owned search harness database isolation', () => {
  it('pins the verified target even if a concurrent runner introduces a marker', () => {
    expect(resolveTestDatabaseUrl(
      'postgresql://shared.invalid/not_owned',
      'postgresql://127.0.0.1:1/ignored',
      'postgresql://127.0.0.1:54321/task_owned',
    )).toBe('postgresql://127.0.0.1:54321/task_owned');
  });

  it('preserves ordinary marker resolution when no verified target is supplied', () => {
    expect(resolveTestDatabaseUrl('postgresql://marker.invalid/ordinary', 'fallback'))
      .toBe('postgresql://marker.invalid/ordinary');
  });

  it('never reads a marker when bootstrapping with a verified database target', async () => {
    const backend = process.env.PERSISTENCE_BACKEND;
    const databaseUrl = process.env.DATABASE_URL;
    const read = jest.spyOn(fs, 'readFileSync');
    const boundary = new Error('stop before application compilation');
    const compile = jest.fn().mockImplementation(() => {
      expect(process.env.DATABASE_URL).toBe('postgresql://127.0.0.1:54321/task_owned');
      return Promise.reject(boundary);
    });
    jest.spyOn(Test, 'createTestingModule').mockReturnValue({ compile } as never);
    try {
      process.env.PERSISTENCE_BACKEND = 'prisma';
      process.env.DATABASE_URL = 'postgresql://shared.invalid/do_not_connect';
      await expect(createTestApp(undefined, {
        databaseUrl: 'postgresql://127.0.0.1:54321/task_owned',
      })).rejects.toThrow(boundary);
      expect(read.mock.calls.some(([file]) => String(file).endsWith('.test-db-path'))).toBe(false);
    } finally {
      if (backend === undefined) delete process.env.PERSISTENCE_BACKEND;
      else process.env.PERSISTENCE_BACKEND = backend;
      if (databaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = databaseUrl;
      jest.restoreAllMocks();
    }
  });
});
