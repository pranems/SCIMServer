import { ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import type { Response } from 'express';
import { LogConfigController } from './log-config.controller';
import { ScimLogger } from './scim-logger.service';
import { LoggingService } from './logging.service';

describe('Log stream shutdown lifecycle', () => {
  let module: TestingModule;
  let controller: LogConfigController;
  let unsubscribe: jest.Mock;
  let unsubscribeScim: jest.Mock;

  beforeEach(async () => {
    jest.useFakeTimers();
    unsubscribe = jest.fn();
    unsubscribeScim = jest.fn();
    module = await Test.createTestingModule({
      controllers: [LogConfigController],
      providers: [
        { provide: LoggingService, useValue: {} },
        { provide: ScimLogger, useValue: {
          subscribe: jest.fn(() => unsubscribe),
          subscribeScimEvents: jest.fn(() => unsubscribeScim),
        } },
      ],
    }).compile();
    controller = module.get(LogConfigController);
  });

  afterEach(async () => {
    await module.close();
    jest.useRealTimers();
  });

  function response() {
    const res = new ServerResponse(new IncomingMessage(new Socket())) as Response;
    jest.spyOn(res, 'flushHeaders').mockImplementation(() => undefined);
    jest.spyOn(res, 'write').mockReturnValue(true);
    jest.spyOn(res, 'end').mockReturnValue(res);
    return res;
  }

  it('ends every stream, removes subscribers and cancels keepalives before server close', async () => {
    const first = response();
    const second = response();
    controller.streamLogs(undefined, undefined, undefined, first);
    controller.streamLogs(undefined, undefined, undefined, second);
    expect(jest.getTimerCount()).toBe(2);
    await module.close();
    expect(first.end).toHaveBeenCalledTimes(1);
    expect(second.end).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(unsubscribeScim).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not close a disconnected stream twice during shutdown', async () => {
    const res = response();
    controller.streamLogs(undefined, undefined, undefined, res);
    res.emit('close');
    await module.close();
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribeScim).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects new streams once shutdown has started', async () => {
    await module.close();
    expect(() => controller.streamLogs(undefined, undefined, undefined, response()))
      .toThrow(ServiceUnavailableException);
  });
});
