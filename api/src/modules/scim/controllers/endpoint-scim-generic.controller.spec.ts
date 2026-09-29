import { EndpointScimGenericController } from './endpoint-scim-generic.controller';
import type { EndpointService } from '../../endpoint/services/endpoint.service';
import type { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import type { EndpointScimGenericService } from '../services/endpoint-scim-generic.service';
import type { Request } from 'express';
import { typedPatchProfile, CONTOSO, DEVICE, PATCH } from '../../../../test/e2e/helpers/typed-patch-fixtures';

describe('P2 custom-resource PATCH controller', () => {
  it('preserves operation ordering and returns only the projected service contract', async () => {
    const profile = typedPatchProfile(true);
    const endpoint = { active: true, profile };
    const dto = { schemas: [PATCH], Operations: [
      { op: 'add', path: `${CONTOSO}:contacts`, value: { type: 'work', value: 'new' } },
      { op: 'replace', path: `${CONTOSO}:contacts[type eq "work"].value`, value: 'selected' },
    ] };
    const result = { schemas: [DEVICE, CONTOSO], id: 'device', meta: {}, [CONTOSO]: { contacts: [{ type: 'work', value: 'selected' }] } };
    const patchResource = jest.fn().mockResolvedValue(result);
    const controller = new EndpointScimGenericController(
      { getEndpoint: jest.fn().mockResolvedValue(endpoint) } as unknown as EndpointService,
      { setContext: jest.fn(), getWarnings: () => [] } as unknown as EndpointContextStorage,
      { patchResource, getAlwaysReturnedByParent: () => new Map(), getRequestReturnedByParent: () => new Map() } as unknown as EndpointScimGenericService,
    );
    const req = { protocol: 'http', get: () => 'localhost', headers: { 'if-match': 'W/"1"' } } as unknown as Request;
    expect(await controller.patchResource('endpoint', 'Devices', 'device', dto, req)).toEqual(result);
    expect(patchResource.mock.calls[0][1]).toEqual(dto);
    expect(patchResource.mock.calls[0][6]).toBe('W/"1"');
    expect(Object.keys(result).sort()).toEqual(['schemas', 'id', 'meta', CONTOSO].sort());
  });
});
