import {
  RESOURCE_TYPE_NOT_SERVED_CODE,
  SCIM_WARNING_HEADER,
  buildResourceTypeWarning,
  formatWarningHeader,
  buildEmptyListResponseWithWarning,
} from './resource-type-enforcement';
import { SCIM_WARNING_URN } from './scim-service-helpers';

describe('resource-type-enforcement (EnforceResourceTypes relaxation)', () => {
  const warning = buildResourceTypeWarning('Group', 'User-Only-Endpoint', 'ep-123');

  describe('buildResourceTypeWarning', () => {
    it('carries the stable code, resource type, and endpoint id', () => {
      expect(warning.code).toBe(RESOURCE_TYPE_NOT_SERVED_CODE);
      expect(warning.resourceType).toBe('Group');
      expect(warning.endpointId).toBe('ep-123');
    });

    it('produces a human-readable single-sentence message naming the type + endpoint', () => {
      expect(warning.message).toContain('"Group"');
      expect(warning.message).toContain('"User-Only-Endpoint"');
      expect(warning.message).toContain('EnforceResourceTypes');
    });
  });

  describe('formatWarningHeader (W3)', () => {
    it('is a single-line "<code>; <message>" value', () => {
      const header = formatWarningHeader(warning);
      expect(header.startsWith(`${RESOURCE_TYPE_NOT_SERVED_CODE}; `)).toBe(true);
      expect(header).not.toMatch(/[\r\n]/);
    });

    it('collapses internal whitespace so the header stays single-line', () => {
      const multiline = buildResourceTypeWarning('Group', 'A\nB   C', 'ep');
      const header = formatWarningHeader(multiline);
      expect(header).not.toMatch(/[\r\n]/);
      expect(header).not.toMatch(/ {2,}/);
    });

    it('uses the custom vendor header name, not the deprecated RFC 9111 Warning', () => {
      expect(SCIM_WARNING_HEADER).toBe('X-SCIM-Warning');
    });
  });

  describe('buildEmptyListResponseWithWarning (W2)', () => {
    const body = buildEmptyListResponseWithWarning(warning);

    it('is a valid empty SCIM ListResponse', () => {
      expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(body.totalResults).toBe(0);
      expect(body.Resources).toEqual([]);
      expect(body.startIndex).toBe(1);
      expect(body.itemsPerPage).toBe(0);
    });

    it('declares the Warning extension URN in schemas and carries the warning array', () => {
      expect(body.schemas).toContain(SCIM_WARNING_URN);
      expect(body[SCIM_WARNING_URN]).toEqual({ warnings: [warning] });
    });
  });
});
