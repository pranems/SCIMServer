import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { GenericResourcesTab } from './GenericResourcesTab';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpointSchemas: vi.fn(),
    useEndpointResourceTypes: vi.fn(),
    useEndpointResources: vi.fn(),
    useCreateResource: vi.fn(),
  };
});

import {
  useCreateResource,
  useEndpointResources,
  useEndpointResourceTypes,
  useEndpointSchemas,
} from '../api/queries';

function wrap() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FluentProvider theme={webLightTheme}>
        <GenericResourcesTab endpointId="ep-1" resourceTypeId="Device" />
      </FluentProvider>
    </QueryClientProvider>,
  );
}

describe('GenericResourcesTab', () => {
  it('lists and creates custom resources from the discovered effective shape', async () => {
    const createResource = vi.fn().mockResolvedValue({ id: 'device-2' });
    (useEndpointSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        Resources: [{
          id: 'urn:example:schemas:Device',
          attributes: [
            { name: 'serialNumber', type: 'string', required: true },
            { name: 'compliant', type: 'boolean' },
          ],
        }],
      },
      isLoading: false,
      error: null,
    });
    (useEndpointResourceTypes as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        Resources: [{
          id: 'Device',
          name: 'Device',
          endpoint: '/Devices',
          schema: 'urn:example:schemas:Device',
        }],
      },
      isLoading: false,
      error: null,
    });
    (useEndpointResources as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        totalResults: 1,
        Resources: [{ id: 'device-1', serialNumber: 'SN-100', compliant: true }],
      },
      isLoading: false,
      error: null,
    });
    (useCreateResource as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: createResource,
      isPending: false,
    });

    wrap();
    expect(screen.getByText('SN-100')).toBeInTheDocument();
    expect(screen.getByText('1 Device')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('custom-resources-create'));
    expect(screen.getByTestId('create-resource-form-serialNumber-input')).toHaveValue(
      'serial-number-example',
    );
    fireEvent.click(screen.getByTestId('create-resource-dialog-submit'));

    await waitFor(() => {
      expect(useCreateResource).toHaveBeenCalledWith('ep-1', '/Devices');
      expect(createResource).toHaveBeenCalledWith({
        schemas: ['urn:example:schemas:Device'],
        serialNumber: 'serial-number-example',
        compliant: true,
      });
    });
  });

  it('renders custom extension values from their schema URN block', () => {
    const extensionUrn = 'urn:example:schemas:extension:DeviceDetails';
    (useEndpointSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        Resources: [
          {
            id: 'urn:example:schemas:Device',
            attributes: [{ name: 'serialNumber', type: 'string', required: true }],
          },
          {
            id: extensionUrn,
            attributes: [{ name: 'location', type: 'string' }],
          },
        ],
      },
      isLoading: false,
      error: null,
    });
    (useEndpointResourceTypes as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        Resources: [{
          id: 'Device',
          name: 'Device',
          endpoint: '/Devices',
          schema: 'urn:example:schemas:Device',
          schemaExtensions: [{ schema: extensionUrn }],
        }],
      },
      isLoading: false,
      error: null,
    });
    (useEndpointResources as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        totalResults: 1,
        Resources: [{
          id: 'device-1',
          serialNumber: 'SN-100',
          [extensionUrn]: { location: 'Seattle' },
        }],
      },
      isLoading: false,
      error: null,
    });
    (useCreateResource as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });

    wrap();
    expect(screen.getByText('Seattle')).toBeInTheDocument();
  });
});