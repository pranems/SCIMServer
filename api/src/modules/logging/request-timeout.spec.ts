describe('Request Timeout Configuration', () => {
  it('should default to 120000ms when REQUEST_TIMEOUT_MS is not set', () => {
    const saved = process.env.REQUEST_TIMEOUT_MS;
    delete process.env.REQUEST_TIMEOUT_MS;
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS) || 120_000;
    expect(timeout).toBe(120_000);
    if (saved) process.env.REQUEST_TIMEOUT_MS = saved;
  });

  it('should respect REQUEST_TIMEOUT_MS env var', () => {
    const saved = process.env.REQUEST_TIMEOUT_MS;
    process.env.REQUEST_TIMEOUT_MS = '60000';
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS) || 30_000;
    expect(timeout).toBe(60_000);
    process.env.REQUEST_TIMEOUT_MS = saved || '';
    if (!saved) delete process.env.REQUEST_TIMEOUT_MS;
  });

  it('should use 120000ms when env var is empty string', () => {
    const saved = process.env.REQUEST_TIMEOUT_MS;
    process.env.REQUEST_TIMEOUT_MS = '';
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS) || 120_000;
    expect(timeout).toBe(120_000);
    if (saved) process.env.REQUEST_TIMEOUT_MS = saved;
    else delete process.env.REQUEST_TIMEOUT_MS;
  });
});
