/**
 * SCIM /Me Endpoint Controller (Phase 10 — RFC 7644 §3.11)
 *
 * "/Me" is a URI alias for the User resource associated with the
 * currently authenticated subject. All operations (GET, PATCH, PUT,
 * DELETE) are delegated to the Users service after resolving the
 * authenticated identity.
 *
 * Identity Resolution:
 *   1. Extract `sub` claim from the JWT token (`request.oauth.sub`)
 *   2. Look up a User whose `userName` matches the `sub` claim
 *   3. Delegate the operation using the resolved SCIM `id`
 *
 * When OAuth is not used (legacy shared-secret auth) or the `sub` claim
 * does not correspond to any User resource, 404 is returned.
 *
 * @see RFC 7644 §3.11 — "/Me" Authenticated Subject Alias
 */
import {
  Controller,
  Get,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  HttpCode,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import type { EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { EndpointScimUsersService } from '../services/endpoint-scim-users.service';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { PatchUserDto } from '../dto/patch-user.dto';
import { applyAttributeProjection } from '../common/scim-attribute-projection';
import { buildBaseUrl } from '../common/base-url.util';
import { createScimError } from '../common/scim-errors';

/** Extended request interface matching SharedSecretGuard output. */
interface AuthenticatedRequest extends Request {
  oauth?: Record<string, unknown>;
  authType?: 'oauth' | 'legacy';
}

/**
 * /Me Controller — RFC 7644 §3.11
 *
 * Routes: /scim/endpoints/{endpointId}/Me
 *
 * Maps the authenticated principal to a SCIM User resource and delegates
 * all CRUD operations to EndpointScimUsersService.
 */
@Controller('endpoints/:endpointId')
export class ScimMeController {
  constructor(
    private readonly endpointService: EndpointService,
    private readonly endpointContext: EndpointContextStorage,
    private readonly usersService: EndpointScimUsersService,
  ) {}

  // ─── Private Helpers ──────────────────────────────────────────────

  /**
   * Validate endpoint exists/active and set context (same pattern as Users controller).
   */
  private async validateAndSetContext(
    endpointId: string,
    req: Request,
  ): Promise<{ baseUrl: string; config: EndpointConfig }> {
    const endpoint = await this.endpointService.getEndpoint(endpointId);

    if (!endpoint.active) {
      throw new ForbiddenException(
        `Endpoint "${endpoint.name}" is inactive. SCIM operations are not allowed.`,
      );
    }

    const profile = endpoint.profile;
    const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
    const baseUrl = `${buildBaseUrl(req)}/endpoints/${endpointId}`;
    this.endpointContext.setContext({ endpointId, baseUrl, profile, config });

    return { baseUrl, config };
  }

  /**
   * Resolve the currently authenticated subject to a SCIM User id.
   *
   * Strategy:
   *   1. Require OAuth authentication (`request.authType === 'oauth'`)
   *   2. Extract `sub` claim from the JWT payload
   *   3. Find User with `userName` matching `sub` via the Users service
   *   4. Return the SCIM `id` if found, otherwise throw 404
   *
   * @throws 404 if the authenticated subject does not correspond to a User
   * @throws 404 if legacy auth is used (no JWT identity available)
   */
  private async resolveAuthenticatedScimId(
    req: AuthenticatedRequest,
    endpointId: string,
    baseUrl: string,
    config: EndpointConfig,
  ): Promise<string> {
    // Legacy shared-secret auth has no user identity
    if (req.authType !== 'oauth' || !req.oauth) {
      throw createScimError({
        status: 404,
        scimType: 'noTarget',
        detail:
          'The /Me endpoint requires OAuth authentication with a JWT token ' +
          'whose "sub" claim matches a SCIM User\'s userName.',
      });
    }

    const sub = req.oauth.sub as string | undefined;
    if (!sub) {
      throw createScimError({
        status: 404,
        scimType: 'noTarget',
        detail: 'JWT token does not contain a "sub" claim. Cannot resolve /Me identity.',
      });
    }

    // Look up the User whose userName matches the JWT sub claim.
    // Uses the list endpoint with a filter to leverage existing filter push-down.
    const result = await this.usersService.listUsersForEndpoint(
      { filter: `userName eq "${sub}"`, count: 1 },
      baseUrl,
      endpointId,
      config,
    );

    if (result.totalResults === 0 || !result.Resources || result.Resources.length === 0) {
      throw createScimError({
        status: 404,
        scimType: 'noTarget',
        detail: `No User resource found with userName matching the authenticated subject "${sub}".`,
      });
    }

    return result.Resources[0].id;
  }

  // ─── Route Handlers ───────────────────────────────────────────────

  /**
   * GET /scim/endpoints/{endpointId}/Me
   *
   * Retrieve the User resource for the authenticated subject.
   * RFC 7644 §3.11: Equivalent to GET /Users/{id} for the current user.
   */
  @Get('Me')
  async getMe(
    @Param('endpointId') endpointId: string,
    @Req() req: Request,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string,
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const scimId = await this.resolveAuthenticatedScimId(req as AuthenticatedRequest, endpointId, baseUrl, config);
    const result = await this.usersService.getUserForEndpoint(scimId, baseUrl, endpointId, config);
    const alwaysByParent = this.usersService.getAlwaysReturnedByParent(endpointId);
    const requestByParent = this.usersService.getRequestReturnedByParent(endpointId);
    return applyAttributeProjection(result, attributes, excludedAttributes, alwaysByParent, requestByParent);
  }

  /**
   * PUT /scim/endpoints/{endpointId}/Me
   *
   * Replace the User resource for the authenticated subject.
   * RFC 7644 §3.11: Equivalent to PUT /Users/{id} for the current user.
   */
  @Put('Me')
  async replaceMe(
    @Param('endpointId') endpointId: string,
    @Body() dto: CreateUserDto,
    @Req() req: Request,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string,
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const scimId = await this.resolveAuthenticatedScimId(req as AuthenticatedRequest, endpointId, baseUrl, config);
    const ifMatch = req.headers['if-match'] as string | undefined;
    const result = await this.usersService.replaceUserForEndpoint(scimId, dto, baseUrl, endpointId, config, ifMatch);
    const alwaysByParent = this.usersService.getAlwaysReturnedByParent(endpointId);
    const requestByParent = this.usersService.getRequestReturnedByParent(endpointId);
    return applyAttributeProjection(result, attributes, excludedAttributes, alwaysByParent, requestByParent);
  }

  /**
   * PATCH /scim/endpoints/{endpointId}/Me
   *
   * Partially update the User resource for the authenticated subject.
   * RFC 7644 §3.11: Equivalent to PATCH /Users/{id} for the current user.
   */
  @Patch('Me')
  async patchMe(
    @Param('endpointId') endpointId: string,
    @Body() dto: PatchUserDto,
    @Req() req: Request,
    @Query('attributes') attributes?: string,
    @Query('excludedAttributes') excludedAttributes?: string,
  ) {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const scimId = await this.resolveAuthenticatedScimId(req as AuthenticatedRequest, endpointId, baseUrl, config);
    const ifMatch = req.headers['if-match'] as string | undefined;
    const result = await this.usersService.patchUserForEndpoint(scimId, dto, baseUrl, endpointId, config, ifMatch);
    const alwaysByParent = this.usersService.getAlwaysReturnedByParent(endpointId);
    const requestByParent = this.usersService.getRequestReturnedByParent(endpointId);
    return applyAttributeProjection(result, attributes, excludedAttributes, alwaysByParent, requestByParent);
  }

  /**
   * DELETE /scim/endpoints/{endpointId}/Me
   *
   * Delete the User resource for the authenticated subject.
   * RFC 7644 §3.11: Equivalent to DELETE /Users/{id} for the current user.
   */
  @Delete('Me')
  @HttpCode(204)
  async deleteMe(
    @Param('endpointId') endpointId: string,
    @Req() req: Request,
  ): Promise<void> {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);
    const scimId = await this.resolveAuthenticatedScimId(req as AuthenticatedRequest, endpointId, baseUrl, config);
    const ifMatch = req.headers['if-match'] as string | undefined;
    return this.usersService.deleteUserForEndpoint(scimId, endpointId, config, ifMatch);
  }
}
