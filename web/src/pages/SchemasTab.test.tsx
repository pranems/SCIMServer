/**
 * SchemasTab tests (Phase D3).
 *
 * Asserts the spec contract per
 * UI_REDESIGN_REMAINING_GAPS_PLAN.md S7.3:
 *   - Tree of schemas -> attributes (expand/collapse)
 *   - Each leaf shows characteristic badges (type, mutability,
 *     returned, uniqueness, required, multiValued)
 *   - LoadingSkeleton on isLoading (G1 pattern)
 *   - EmptyState when SchemaDiscovery is disabled / zero schemas
 *   - Copy-to-clipboard for the schema URN
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { SchemasTab } from './SchemasTab';
import type { ScimSchemasResponse } from '../api/queries';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpointSchemas: vi.fn(),
  };
});

import { useEndpointSchemas } from '../api/queries';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

const mockSchemas: ScimSchemasResponse = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
  totalResults: 2,
  startIndex: 1,
  itemsPerPage: 2,
  Resources: [
    {
      id: 'urn:ietf:params:scim:schemas:core:2.0:User',
      name: 'User',
      description: 'SCIM Core User schema',
      attributes: [
        {
          name: 'userName',
          type: 'string',
          required: true,
          mutability: 'readWrite',
          returned: 'default',
          uniqueness: 'server',
          multiValued: false,
          caseExact: false,
        },
        {
          name: 'emails',
          type: 'complex',
          required: false,
          mutability: 'readWrite',
          returned: 'default',
          uniqueness: 'none',
          multiValued: true,
          caseExact: false,
          subAttributes: [
            {
              name: 'value',
              type: 'string',
              required: false,
              mutability: 'readWrite',
              returned: 'always',
              uniqueness: 'none',
              multiValued: false,
              caseExact: false,
            },
            {
              name: 'primary',
              type: 'boolean',
              required: false,
              mutability: 'readWrite',
              returned: 'default',
              uniqueness: 'none',
              multiValued: false,
            },
          ],
        },
      ],
    },
    {
      id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
      name: 'Group',
      description: 'SCIM Core Group schema',
      attributes: [
        {
          name: 'displayName',
          type: 'string',
          required: true,
          mutability: 'readWrite',
          returned: 'default',
          uniqueness: 'server',
          multiValued: false,
          caseExact: false,
        },
      ],
    },
  ],
};

describe('SchemasTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders LoadingSkeleton (not Spinner) while loading - G1 pattern', () => {
    (useEndpointSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    renderWithProviders(<SchemasTab endpointId="ep-1" />);
    expect(screen.getByTestId('tab-schemas')).toBeInTheDocument();
    expect(screen.getByTestId('schemas-skeleton')).toBeInTheDocument();
  });

  it('renders one tree row per schema with name + URN + attribute count', () => {
    (useEndpointSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockSchemas,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<SchemasTab endpointId="ep-1" />);
    expect(screen.getByTestId('schemas-tree')).toBeInTheDocument();
    expect(
      screen.getByTestId('schema-row-urn:ietf:params:scim:schemas:core:2.0:User'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('schema-row-urn:ietf:params:scim:schemas:core:2.0:Group'),
    ).toBeInTheDocument();
    // Attribute counts visible (User has 2, Group has 1).
    expect(screen.getByText(/2 attributes/i)).toBeInTheDocument();
    expect(screen.getByText(/1 attribute/i)).toBeInTheDocument();
  });

  it('shows characteristics on the leaf when an attribute is expanded', () => {
    (useEndpointSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockSchemas,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<SchemasTab endpointId="ep-1" />);
    // Expand the User schema
    fireEvent.click(
      screen.getByTestId('schema-toggle-urn:ietf:params:scim:schemas:core:2.0:User'),
    );
    // userName attribute leaf exposes its characteristics inline.
    const leaf = screen.getByTestId(
      'attr-leaf-urn:ietf:params:scim:schemas:core:2.0:User-userName',
    );
    expect(leaf).toBeInTheDocument();
    // Spec-required characteristics: required, mutability, returned,
    // uniqueness, type, multiValued.
    const text = leaf.textContent ?? '';
    expect(text).toMatch(/string/i);
    expect(text).toMatch(/required/i);
    expect(text).toMatch(/readWrite/);
    expect(text).toMatch(/server/);
  });

  it('renders sub-attributes under a complex attribute when expanded', () => {
    (useEndpointSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockSchemas,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<SchemasTab endpointId="ep-1" />);
    // Expand User schema, then expand emails complex attribute.
    fireEvent.click(
      screen.getByTestId('schema-toggle-urn:ietf:params:scim:schemas:core:2.0:User'),
    );
    fireEvent.click(
      screen.getByTestId('attr-toggle-urn:ietf:params:scim:schemas:core:2.0:User-emails'),
    );
    expect(
      screen.getByTestId('subattr-leaf-urn:ietf:params:scim:schemas:core:2.0:User-emails-value'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('subattr-leaf-urn:ietf:params:scim:schemas:core:2.0:User-emails-primary'),
    ).toBeInTheDocument();
  });

  it('exposes a copy-URN button per schema', () => {
    (useEndpointSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockSchemas,
      isLoading: false,
      error: null,
    });

    // Stub clipboard API (jsdom doesn't ship it).
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
    });

    renderWithProviders(<SchemasTab endpointId="ep-1" />);
    const copyBtn = screen.getByTestId(
      'schema-copy-urn:ietf:params:scim:schemas:core:2.0:User',
    );
    fireEvent.click(copyBtn);
    expect(writeText).toHaveBeenCalledWith('urn:ietf:params:scim:schemas:core:2.0:User');
  });

  it('shows EmptyState when schema discovery is disabled (404 / zero schemas)', () => {
    (useEndpointSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockSchemas, Resources: [], totalResults: 0 },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<SchemasTab endpointId="ep-1" />);
    expect(screen.getByTestId('schemas-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('schemas-tree')).not.toBeInTheDocument();
  });

  it('renders the error block when the discovery call fails', () => {
    (useEndpointSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('schemas API down'),
    });

    renderWithProviders(<SchemasTab endpointId="ep-1" />);
    expect(screen.getByTestId('schemas-error')).toHaveTextContent(/schemas API down/);
  });
});
