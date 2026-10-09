import { request, type FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== 'string' || baseURL.length === 0) {
    throw new Error('Playwright baseURL must be configured before browser validation.');
  }

  const api = await request.newContext({ baseURL });
  try {
    const response = await api.get('/scim/health', { timeout: 10_000 });
    if (!response.ok()) {
      throw new Error(
        `Playwright SCIM preflight failed for ${baseURL}: /scim/health returned HTTP ${response.status()}.`,
      );
    }
  } finally {
    await api.dispose();
  }
}
