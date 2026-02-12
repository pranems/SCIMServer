import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import type { EndpointConfig } from './endpoint-config.interface';

export interface EndpointContext {
  endpointId: string;
  baseUrl: string;
  config?: EndpointConfig;
}

/**
 * EndpointContextStorage manages endpoint context for the current request.
 * Uses AsyncLocalStorage to ensure endpoint context is isolated per request.
 *
 * Provides two modes:
 * - `run(context, fn)` — preferred, scopes the context to the fn's execution (safe)
 * - `setContext(context)` — legacy convenience for controllers that can't wrap in run()
 *
 * @see https://nodejs.org/api/async_context.html
 */
@Injectable()
export class EndpointContextStorage {
  private storage = new AsyncLocalStorage<EndpointContext>();

  /**
   * Execute a function within a scoped endpoint context.
   * This is the preferred API — the context is automatically cleaned up.
   */
  run<T>(context: EndpointContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  /**
   * Set context for the current async scope (convenience for NestJS controllers).
   * Uses enterWith() — the context persists for the lifetime of the current async scope.
   */
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
