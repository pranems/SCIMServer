import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import type { EndpointConfig } from './endpoint-config.interface';

export interface EndpointContext {
  endpointId: string;
  baseUrl: string;
  config?: EndpointConfig;
}

/**
 * EndpointContextStorage manages endpoint context for the current request
 * Uses AsyncLocalStorage to ensure endpoint context is isolated per request
 */
@Injectable()
export class EndpointContextStorage {
  private storage = new AsyncLocalStorage<EndpointContext>();

  setContext(context: EndpointContext): void {
    this.storage.enterWith(context);
  }

  getContext(): EndpointContext | undefined {
    return this.storage.getStore();
  }

  getEndpointId(): string | undefined {
    return this.storage.getStore()?.endpointId;
  }

  getBaseUrl(): string | undefined {
    return this.storage.getStore()?.baseUrl;
  }

  getConfig(): EndpointConfig | undefined {
    return this.storage.getStore()?.config;
  }
}
