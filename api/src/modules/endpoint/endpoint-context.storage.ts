import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response } from 'express';
import type { EndpointConfig } from './endpoint-config.interface';

export interface EndpointContext {
  endpointId: string;
  baseUrl: string;
  config?: EndpointConfig;
  /** Accumulated warnings for the current request (e.g. stripped readOnly attributes) */
  warnings?: string[];
}

/**
 * EndpointContextStorage manages endpoint context for the current request.
 * Uses AsyncLocalStorage to ensure endpoint context is isolated per request.
 *
 * Provides two modes:
 * - `run(context, fn)` — preferred, scopes the context to the fn's execution (safe)
 * - `setContext(context)` — populates the current store established by the middleware
 *
 * A global Express middleware (`createContextMiddleware()`) initialises the
 * AsyncLocalStorage store so that `setContext()` can safely mutate it across
 * NestJS interceptors, guards, and handler methods.
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
   * Build an Express middleware that wraps each request in a fresh
   * AsyncLocalStorage store so that setContext / addWarnings / getWarnings
   * work consistently across the NestJS request pipeline (guards,
   * interceptors, pipes, handlers).
   */
  createMiddleware(): (req: Request, res: Response, next: () => void) => void {
    return (_req: Request, _res: Response, next: () => void): void => {
      this.storage.run({ endpointId: '', baseUrl: '' }, () => next());
    };
  }

  /**
   * Populate the endpoint context for the current request.
   *
   * If a store already exists (created by the middleware), its properties are
   * mutated in-place so the same object reference is visible throughout the
   * request lifecycle.  Falls back to `enterWith()` when no store exists yet.
   */
  setContext(context: EndpointContext): void {
    const existing = this.storage.getStore();
    if (existing) {
      existing.endpointId = context.endpointId;
      existing.baseUrl = context.baseUrl;
      existing.config = context.config;
      // Do NOT reset warnings — they may have been accumulated before setContext
    } else {
      this.storage.enterWith(context);
    }
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

  /**
   * Append warnings to the current request context.
   * Used by services to record stripped readOnly attributes.
   */
  addWarnings(warnings: string[]): void {
    const store = this.storage.getStore();
    if (!store || warnings.length === 0) return;
    if (!store.warnings) store.warnings = [];
    store.warnings.push(...warnings);
  }

  /**
   * Get accumulated warnings for the current request.
   * Used by controllers to decide whether to attach warning URN.
   */
  getWarnings(): string[] {
    return this.storage.getStore()?.warnings ?? [];
  }
}
