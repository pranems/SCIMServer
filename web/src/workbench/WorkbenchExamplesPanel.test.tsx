import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { WorkbenchExamplesPanel } from './WorkbenchExamplesPanel';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpointSchemas: vi.fn(),
    useEndpointResourceTypes: vi.fn(),
    useEndpointResources: vi.fn(),
  };
});

import {
  useEndpointResources,
  useEndpointResourceTypes,
  useEndpointSchemas,
} from '../api/queries';

const endpoints = [
  { id: 'ep-1', name: 'prod', displayName: 'Production' },
];

function renderPanel(endpointId = '', onApply = vi.fn()) {
  return {
    onApply,
    ...render(
      <FluentProvider theme={webLightTheme}>
        <WorkbenchExamplesPanel
          endpoints={endpoints}
          endpointId={endpointId}
          onEndpointChange={() => undefined}
          onApply={onApply}
        />
      </FluentProvider>,
    ),
  };
}

describe('WorkbenchExamplesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useEndpointSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });
    (useEndpointResourceTypes as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });
    (useEndpointResources as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });
  });

  it('offers static server and admin templates without an endpoint', () => {
    const { onApply } = renderPanel();

    const template = screen.getByTestId('workbench-example-template') as HTMLSelectElement;
    expect([...template.options].map((option) => option.textContent)).toEqual(expect.arrayContaining([
      'Server - Server health',
      'Admin - Create endpoint',
    ]));
    fireEvent.change(template, { target: { value: 'admin-create-endpoint' } });
    fireEvent.click(screen.getByTestId('workbench-example-apply'));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      path: '/scim/admin/endpoints',
      body: expect.objectContaining({ profilePreset: 'rfc-standard' }),
    }));
  });

  it('applies a discovered custom-resource PATCH template with ETag', () => {
    const deviceUrn = 'urn:example:schemas:Device';
    (useEndpointSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        Resources: [{
          id: deviceUrn,
          attributes: [{ name: 'serialNumber', type: 'string', required: true }],
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
          schema: deviceUrn,
        }],
      },
      isLoading: false,
      error: null,
    });
    (useEndpointResources as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        Resources: [{
          id: 'device-1',
          serialNumber: 'SN-100',
          meta: { version: 'W/"v3"' },
        }],
      },
      isLoading: false,
      error: null,
    });
    const { onApply } = renderPanel('ep-1');

    expect(useEndpointResources).toHaveBeenCalledWith('ep-1', '/Devices', {
      startIndex: 1,
      count: 1,
    });
    fireEvent.change(screen.getByTestId('workbench-example-template'), {
      target: { value: 'resource-Device-patch' },
    });
    fireEvent.click(screen.getByTestId('workbench-example-apply'));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      method: 'PATCH',
      path: '/scim/endpoints/ep-1/Devices/device-1',
      headers: [{ key: 'If-Match', value: 'W/"v3"', enabled: true }],
    }));
  });
});