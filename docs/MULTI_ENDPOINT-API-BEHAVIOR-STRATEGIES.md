# Endpoint-Specific Behavior Strategies: Complete Comparison

> **Document Purpose**: Guide for implementing config-driven endpoint behavior variations in the SCIM Tool.
> 
> **Created**: February 3, 2026

## Overview of All Approaches

| Level | Pattern | Extensibility | Maintainability | Runtime Perf | Best For |
|-------|---------|---------------|-----------------|--------------|----------|
| **Request** | Guard | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Access control, feature flags |
| **Request** | Middleware | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Request preprocessing |
| **Controller** | Interceptor | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Request/Response transformation |
| **Service** | Strategy Pattern | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Complex business logic |
| **Service** | Config-Driven Conditionals | ⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | Simple flag checks |
| **Data** | Decorator Pattern | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | Composable behaviors |
| **Cross-Cutting** | Plugin/Extension System | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | Third-party extensibility |

---

## 1. 🛡️ Guard Pattern (Request Level)

**Best for**: Feature toggles, access control, endpoint enable/disable

```typescript
// endpoint-feature.guard.ts
@Injectable()
export class EndpointFeatureGuard implements CanActivate {
  constructor(private readonly endpointService: EndpointService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const endpointId = request.params.endpointId;
    const endpoint = await this.endpointService.getEndpoint(endpointId);
    const config = endpoint.config || {};

    // Feature flag checks
    const handler = context.getHandler();
    const requiredFeature = Reflect.getMetadata('feature', handler);
    
    if (requiredFeature && !config[requiredFeature]) {
      throw new ForbiddenException(`Feature "${requiredFeature}" not enabled for this endpoint`);
    }

    // Store config for downstream use
    request.endpointConfig = config;
    return true;
  }
}

// Usage with decorator
@Feature('bulkOperations')
@Post('Bulk')
async bulkOperation() { ... }
```

### Pros & Cons

| Pros | Cons |
|------|------|
| ✅ Fail-fast, clean rejection | ❌ Limited to boolean checks |
| ✅ Decorator-based, declarative | ❌ Can't modify response |
| ✅ Excellent runtime performance | ❌ Only for gatekeeping |

---

## 2. 🔄 Interceptor Pattern (Controller Level) ⭐ RECOMMENDED

**Best for**: Response transformation, logging, metrics, headers

```typescript
// endpoint-behavior.interceptor.ts
@Injectable()
export class EndpointBehaviorInterceptor implements NestInterceptor {
  constructor(
    private readonly endpointService: EndpointService,
    private readonly contextStorage: EndpointContextStorage
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const endpointId = request.params.endpointId;
    
    const endpoint = await this.endpointService.getEndpoint(endpointId);
    const config: EndpointConfig = endpoint.config || {};

    // Store in context for services
    this.contextStorage.setContext({ endpointId, config });

    // Pre-request modifications
    if (config.forceContentType) {
      request.headers['content-type'] = config.forceContentType;
    }

    return next.handle().pipe(
      map(data => this.transformResponse(data, config)),
      tap(() => {
        // Post-response: Set custom headers
        if (config.customHeaders) {
          Object.entries(config.customHeaders).forEach(([k, v]) => 
            response.setHeader(k, v as string)
          );
        }
      })
    );
  }

  private transformResponse(data: any, config: EndpointConfig): any {
    if (!data) return data;

    // Config-driven transformations
    if (config.excludeMeta) delete data.meta;
    if (config.excludeSchemas) delete data.schemas;
    if (config.flattenResponse) return this.flatten(data);
    if (config.snakeCaseResponse) return this.toSnakeCase(data);
    if (config.customSchemaUrn) {
      data.schemas = data.schemas?.map((s: string) => 
        s.replace('urn:ietf:params:scim', config.customSchemaUrn)
      );
    }
    
    return data;
  }
}
```

### Pros & Cons

| Pros | Cons |
|------|------|
| ✅ Central place for transformations | ❌ Async complexity with Observables |
| ✅ Access to both request & response | ❌ Can't change business logic |
| ✅ Clean, doesn't pollute services | ❌ Order matters with multiple interceptors |
| ✅ Easy to test in isolation | |

---

## 3. 🎯 Strategy Pattern (Service Level) ⭐⭐ MOST EXTENSIBLE

**Best for**: Complex business logic variations, validation rules, data mapping

```typescript
// strategies/endpoint-behavior.strategy.ts
export interface EndpointBehaviorStrategy {
  validateUser(dto: CreateUserDto): Promise<void>;
  mapUserData(dto: CreateUserDto, endpointId: string): Prisma.ScimUserCreateInput;
  buildResponse(user: ScimUser, baseUrl: string): ScimUserResponse;
  shouldSendWebhook(): boolean;
}

// strategies/default.strategy.ts
@Injectable()
export class DefaultBehaviorStrategy implements EndpointBehaviorStrategy {
  async validateUser(dto: CreateUserDto): Promise<void> {
    if (!dto.userName) throw new BadRequestException('userName required');
  }
  
  mapUserData(dto: CreateUserDto, endpointId: string): Prisma.ScimUserCreateInput {
    return { ...dto, endpointId };
  }
  
  buildResponse(user: ScimUser, baseUrl: string): ScimUserResponse {
    return { schemas: SCIM_USER_SCHEMA, ...user, meta: this.buildMeta(user, baseUrl) };
  }
  
  shouldSendWebhook(): boolean { return false; }
}

// strategies/strict.strategy.ts
@Injectable()
export class StrictBehaviorStrategy implements EndpointBehaviorStrategy {
  async validateUser(dto: CreateUserDto): Promise<void> {
    if (!dto.userName) throw new BadRequestException('userName required');
    if (!dto.emails?.length) throw new BadRequestException('At least one email required');
    if (!dto.name?.givenName) throw new BadRequestException('givenName required');
    // Strict validation...
  }
  // ... other methods with strict behavior
}

// strategies/legacy.strategy.ts  
@Injectable()
export class LegacyBehaviorStrategy implements EndpointBehaviorStrategy {
  // Support legacy SCIM 1.1 format, different field mappings, etc.
}

// strategy.factory.ts
@Injectable()
export class BehaviorStrategyFactory {
  constructor(
    private readonly defaultStrategy: DefaultBehaviorStrategy,
    private readonly strictStrategy: StrictBehaviorStrategy,
    private readonly legacyStrategy: LegacyBehaviorStrategy,
  ) {}

  create(config: EndpointConfig): EndpointBehaviorStrategy {
    if (config.strictMode) return this.strictStrategy;
    if (config.legacyMode) return this.legacyStrategy;
    if (config.customBehavior) return this.createComposite(config);
    return this.defaultStrategy;
  }

  private createComposite(config: EndpointConfig): EndpointBehaviorStrategy {
    // Compose behaviors based on individual flags
    return new CompositeBehaviorStrategy(config, this.defaultStrategy);
  }
}

// Usage in service
@Injectable()
export class EndpointScimUsersService {
  constructor(private readonly strategyFactory: BehaviorStrategyFactory) {}

  async createUserForEndpoint(dto: CreateUserDto, baseUrl: string, endpointId: string) {
    const config = await this.getEndpointConfig(endpointId);
    const strategy = this.strategyFactory.create(config);

    await strategy.validateUser(dto);
    const userData = strategy.mapUserData(dto, endpointId);
    const user = await this.prisma.scimUser.create({ data: userData });
    
    if (strategy.shouldSendWebhook()) {
      await this.webhookService.send(user);
    }
    
    return strategy.buildResponse(user, baseUrl);
  }
}
```

### Pros & Cons

| Pros | Cons |
|------|------|
| ✅ **Most extensible** - add new strategies easily | ❌ More classes to maintain |
| ✅ Open/Closed principle - extend without modifying | ❌ Slight overhead from factory |
| ✅ Easy to unit test each strategy | ❌ Can become complex with many variations |
| ✅ Clean separation of concerns | |
| ✅ Composable strategies possible | |

---

## 4. 🎨 Decorator/Pipeline Pattern (Data Level) ⭐⭐ MOST COMPOSABLE

**Best for**: Stackable, composable transformations

```typescript
// decorators/response-decorator.interface.ts
export interface ResponseDecorator {
  decorate(data: any, config: EndpointConfig): any;
}

// decorators/implementations
@Injectable()
export class SchemaDecorator implements ResponseDecorator {
  decorate(data: any, config: EndpointConfig): any {
    if (config.customSchemaUrn && data.schemas) {
      data.schemas = data.schemas.map((s: string) => 
        s.replace('urn:ietf:params:scim', config.customSchemaUrn)
      );
    }
    return data;
  }
}

@Injectable()
export class MetaDecorator implements ResponseDecorator {
  decorate(data: any, config: EndpointConfig): any {
    if (config.excludeMeta) delete data.meta;
    if (config.extendedMeta && data.meta) {
      data.meta.endpoint = config.endpointName;
      data.meta.version = config.apiVersion;
    }
    return data;
  }
}

@Injectable()
export class EnterpriseSchemaDecorator implements ResponseDecorator {
  decorate(data: any, config: EndpointConfig): any {
    if (config.includeEnterpriseSchema && data.schemas) {
      data.schemas.push('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User');
      data['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'] = {
        employeeNumber: data.employeeNumber,
        department: data.department,
      };
    }
    return data;
  }
}

// decorator-pipeline.service.ts
@Injectable()
export class DecoratorPipeline {
  private decorators: ResponseDecorator[] = [];

  constructor(
    schema: SchemaDecorator,
    meta: MetaDecorator,
    enterprise: EnterpriseSchemaDecorator,
  ) {
    this.decorators = [schema, meta, enterprise];
  }

  process(data: any, config: EndpointConfig): any {
    return this.decorators.reduce(
      (result, decorator) => decorator.decorate(result, config),
      data
    );
  }
}
```

### Pros & Cons

| Pros | Cons |
|------|------|
| ✅ **Highly composable** - mix & match | ❌ Order-dependent |
| ✅ Single responsibility per decorator | ❌ Many small classes |
| ✅ Easy to add/remove behaviors | ❌ Debugging pipeline can be tricky |
| ✅ Testable in isolation | |

---

## 5. 🔌 Plugin/Extension System (Cross-Cutting) ⭐⭐ MOST POWERFUL

**Best for**: Third-party extensibility, complex enterprise scenarios

```typescript
// plugin.interface.ts
export interface EndpointPlugin {
  name: string;
  priority: number;
  
  onBeforeCreate?(ctx: PluginContext, dto: any): Promise<any>;
  onAfterCreate?(ctx: PluginContext, entity: any): Promise<any>;
  onBeforeUpdate?(ctx: PluginContext, id: string, dto: any): Promise<any>;
  onAfterUpdate?(ctx: PluginContext, entity: any): Promise<any>;
  onBeforeDelete?(ctx: PluginContext, id: string): Promise<void>;
  onResponse?(ctx: PluginContext, data: any): Promise<any>;
  onError?(ctx: PluginContext, error: Error): Promise<void>;
}

// plugin-registry.service.ts
@Injectable()
export class PluginRegistry {
  private plugins: Map<string, EndpointPlugin[]> = new Map();

  register(endpointId: string, plugin: EndpointPlugin): void {
    const existing = this.plugins.get(endpointId) || [];
    existing.push(plugin);
    existing.sort((a, b) => a.priority - b.priority);
    this.plugins.set(endpointId, existing);
  }

  async executeHook<T>(
    endpointId: string, 
    hook: keyof EndpointPlugin, 
    ctx: PluginContext, 
    ...args: any[]
  ): Promise<T> {
    const plugins = this.plugins.get(endpointId) || [];
    let result = args[0];
    
    for (const plugin of plugins) {
      const hookFn = plugin[hook] as Function;
      if (hookFn) {
        result = await hookFn.call(plugin, ctx, result, ...args.slice(1));
      }
    }
    return result;
  }
}

// plugin-loader.service.ts (loads from config)
@Injectable()
export class PluginLoader {
  constructor(private registry: PluginRegistry) {}

  async loadForEndpoint(endpointId: string, config: EndpointConfig): Promise<void> {
    if (config.plugins?.auditLog) {
      this.registry.register(endpointId, new AuditLogPlugin());
    }
    if (config.plugins?.webhook) {
      this.registry.register(endpointId, new WebhookPlugin(config.plugins.webhook));
    }
    if (config.plugins?.customValidation) {
      this.registry.register(endpointId, new CustomValidationPlugin(config.plugins.customValidation));
    }
  }
}

// Usage in service
async createUserForEndpoint(dto: CreateUserDto, baseUrl: string, endpointId: string) {
  const ctx = { endpointId, baseUrl, config: await this.getConfig(endpointId) };
  
  // Plugin hook: before create
  dto = await this.pluginRegistry.executeHook(endpointId, 'onBeforeCreate', ctx, dto);
  
  const user = await this.prisma.scimUser.create({ data: this.mapDto(dto) });
  
  // Plugin hook: after create
  const result = await this.pluginRegistry.executeHook(endpointId, 'onAfterCreate', ctx, user);
  
  // Plugin hook: transform response
  return this.pluginRegistry.executeHook(endpointId, 'onResponse', ctx, this.toResponse(result));
}
```

### Pros & Cons

| Pros | Cons |
|------|------|
| ✅ **Ultimate extensibility** | ❌ Complex to implement correctly |
| ✅ Third-party plugins possible | ❌ Performance overhead |
| ✅ Runtime plugin loading | ❌ Harder to debug |
| ✅ Complete lifecycle control | ❌ Security concerns with dynamic loading |

---

## 📊 Final Recommendation Matrix

```
                    EXTENSIBILITY
                         ▲
                         │
         Plugin System   │   Strategy Pattern
              ⭐⭐⭐⭐⭐    │      ⭐⭐⭐⭐⭐
                         │
                         │
         Decorator       │   Interceptor
         Pipeline        │      ⭐⭐⭐⭐
          ⭐⭐⭐⭐         │
                         │
    ─────────────────────┼─────────────────────► MAINTAINABILITY
                         │
         Middleware      │   Guards
           ⭐⭐⭐          │     ⭐⭐⭐⭐
                         │
                         │
         Conditionals    │
         in Service      │
           ⭐⭐           │
                         │
```

---

## 🏆 Recommended Architecture (Layered Approach)

```
┌─────────────────────────────────────────────────────────────┐
│                     REQUEST FLOW                            │
├─────────────────────────────────────────────────────────────┤
│  1. Guard          → Feature flags, enable/disable          │
│                       (fail-fast, minimal overhead)         │
├─────────────────────────────────────────────────────────────┤
│  2. Interceptor    → Load config, set context               │
│                       Response transformations              │
├─────────────────────────────────────────────────────────────┤
│  3. Controller     → Route to service                       │
├─────────────────────────────────────────────────────────────┤
│  4. Strategy       → Business logic variations              │
│     Factory          (validation, mapping, webhooks)        │
├─────────────────────────────────────────────────────────────┤
│  5. Decorator      → Response composition                   │
│     Pipeline         (schemas, meta, extensions)            │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 Recommendation for SCIM Tool

For the SCIM Tool implementation, the recommended approach is:

### Must-Have (Phase 1)
1. **Interceptor** - For config loading and response transformations
2. **Strategy Pattern** - For validation and business logic variations

### Nice-to-Have (Phase 2)
3. **Guards** - For feature flags and endpoint enable/disable
4. **Decorator Pipeline** - If many composable response variations needed

### Future (Phase 3)
5. **Plugin System** - For advanced enterprise extensibility

This combination provides the best balance of **extensibility**, **maintainability**, and **runtime performance**.

---

## Related Documentation

- [MULTI_ENDPOINT_ARCHITECTURE.md](./MULTI_ENDPOINT_ARCHITECTURE.md)
- [MULTI_ENDPOINT_IMPLEMENTATION.md](./MULTI_ENDPOINT_IMPLEMENTATION.md)
- [MULTI_ENDPOINT_QUICK_START.md](./MULTI_ENDPOINT_QUICK_START.md)
