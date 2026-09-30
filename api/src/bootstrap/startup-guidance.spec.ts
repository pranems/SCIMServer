import { Logger } from '@nestjs/common';

const app = {
  set: jest.fn(), enableShutdownHooks: jest.fn(), use: jest.fn(),
  enableCors: jest.fn(), useStaticAssets: jest.fn(), setGlobalPrefix: jest.fn(),
  useLogger: jest.fn(), useBodyParser: jest.fn(), useGlobalPipes: jest.fn(),
  listen: jest.fn().mockResolvedValue(undefined),
  getHttpServer: jest.fn().mockReturnValue({ setTimeout: jest.fn() }),
};

jest.mock('@nestjs/core', () => ({ NestFactory: { create: jest.fn(async () => app) } }));
jest.mock('../modules/app/app.module', () => ({ AppModule: class {} }));
jest.mock('./spa-fallback', () => ({ applySpaFallback: jest.fn() }));
jest.mock('./correlation-middleware', () => ({ applyCorrelationMiddleware: jest.fn() }));
jest.mock('./body-parsers', () => ({ applyBodyParsers: jest.fn() }));

describe('emitted schema-validation startup guidance', () => {
  it('keeps strict validation on and diagnoses the specific Entra wire shape', async () => {
    const log = jest.spyOn(Logger, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    try {
      await import('../main');
      await new Promise(resolve => setImmediate(resolve));
      const guidance = log.mock.calls
        .filter(call => call[1] === 'SchemaValidation')
        .map(call => String(call[0])).join('\n');
      expect(guidance).toContain('StrictSchemaValidation is ON by default');
      expect(guidance).not.toMatch(/disable per-endpoint|StrictSchemaValidation.*False/i);
      expect(guidance).toContain('Keep strict validation enabled');
      expect(guidance).toContain('AllowAndCoerceBooleanStrings');
      expect(guidance).toContain('VerbosePatchSupported');
      expect(guidance).toContain('SCIM_ENTRA_COMPATIBILITY.md');
      expect(app.listen).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
      warn.mockRestore();
    }
  });
});
