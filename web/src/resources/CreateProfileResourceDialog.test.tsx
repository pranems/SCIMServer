import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { CreateProfileResourceDialog } from './CreateProfileResourceDialog';
import { resolveEffectiveResourceShape } from './profile-resource-shape';

const DEVICE_URN = 'urn:example:schemas:Device';
const shape = resolveEffectiveResourceShape(
  { id: 'Device', name: 'Device', endpoint: '/Devices', schema: DEVICE_URN },
  [{
    id: DEVICE_URN,
    attributes: [
      { name: 'serialNumber', type: 'string', required: true },
      { name: 'compliant', type: 'boolean' },
      { name: 'platform', type: 'string' },
    ],
  }],
);

describe('CreateProfileResourceDialog', () => {
  it('submits the editable working example as a valid SCIM payload', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <FluentProvider theme={webLightTheme}>
        <CreateProfileResourceDialog
          open
          shape={shape}
          onCreate={onCreate}
          onClose={onClose}
        />
      </FluentProvider>,
    );

    expect(screen.getByTestId('create-resource-form-serialNumber-input')).toHaveValue(
      'serial-number-example',
    );
    expect((screen.getByTestId('create-resource-body-input') as HTMLTextAreaElement).value)
      .toContain(DEVICE_URN);

    fireEvent.change(screen.getByTestId('create-resource-form-serialNumber-input'), {
      target: { value: 'SN-200' },
    });
    expect((screen.getByTestId('create-resource-body-input') as HTMLTextAreaElement).value)
      .toContain('SN-200');
    await user.click(screen.getByTestId('create-resource-dialog-submit'));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        schemas: [DEVICE_URN],
        serialNumber: 'SN-200',
        compliant: true,
        platform: 'platform-example',
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('synchronizes valid body edits back to controls and preserves arbitrary body members', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <FluentProvider theme={webLightTheme}>
        <CreateProfileResourceDialog
          open
          shape={shape}
          onCreate={onCreate}
          onClose={vi.fn()}
        />
      </FluentProvider>,
    );

    const body = {
      schemas: [DEVICE_URN],
      serialNumber: 'SN-JSON',
      compliant: false,
      platform: 'Linux',
      vendorMetadata: { source: 'operator' },
    };
    fireEvent.change(screen.getByTestId('create-resource-body-input'), {
      target: { value: JSON.stringify(body, null, 2) },
    });

    expect(screen.getByTestId('create-resource-form-serialNumber-input')).toHaveValue('SN-JSON');
    expect(screen.getByRole('switch', { name: 'Compliant' })).not.toBeChecked();
    expect(screen.getByTestId('create-resource-form-platform-input')).toHaveValue('Linux');

    fireEvent.change(screen.getByTestId('create-resource-form-platform-input'), {
      target: { value: 'Windows' },
    });
    await user.click(screen.getByTestId('create-resource-dialog-submit'));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
      ...body,
      platform: 'Windows',
    }));
  });

  it('blocks submission while the editable request body contains invalid JSON', async () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <CreateProfileResourceDialog
          open
          shape={shape}
          onCreate={vi.fn()}
          onClose={vi.fn()}
        />
      </FluentProvider>,
    );

    fireEvent.change(screen.getByTestId('create-resource-body-input'), {
      target: { value: '{not-json' },
    });

    expect(screen.getByText('Enter a valid JSON object.')).toBeInTheDocument();
    expect(screen.getByTestId('create-resource-dialog-submit')).toBeDisabled();
  });
});