import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';

describe('Active log stream application shutdown', () => {
  it('closes a live HTTP stream without requiring the client to disconnect first', async () => {
    const app: INestApplication = await createTestApp();
    const abort = new AbortController();
    let closing: Promise<void> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const token = await getAuthToken(app);
      const address = app.getHttpServer<Server>().address();
      if (!address || typeof address === 'string') throw new Error('Expected owned TCP test listener');
      const stream = await fetch(`http://127.0.0.1:${address.port}/scim/admin/log-config/stream`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: abort.signal,
      });
      expect(stream.status).toBe(200);
      const reader = stream.body!.getReader();
      const connected = await reader.read();
      expect(new TextDecoder().decode(connected.value)).toContain('event: connected');
      closing = app.close();
      await Promise.race([
        closing,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Shutdown blocked by an active log stream')), 3000);
        }),
      ]);
      let ended = false;
      for (let chunk = 0; chunk < 10 && !ended; chunk++) ended = (await reader.read()).done;
      expect(ended).toBe(true);
    } finally {
      if (deadline) clearTimeout(deadline);
      abort.abort();
      await (closing ?? app.close());
    }
  });
});
