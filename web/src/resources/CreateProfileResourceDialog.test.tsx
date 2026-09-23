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
    expect(screen.getByTestId('create-resource-preview-pre')).toHaveTextContent(DEVICE_URN);

    fireEvent.change(screen.getByTestId('create-resource-form-serialNumber-input'), {
      target: { value: 'SN-200' },
    });
    await user.click(screen.getByTestId('create-resource-dialog-submit'));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        schemas: [DEVICE_URN],
        serialNumber: 'SN-200',
        compliant: true,
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});