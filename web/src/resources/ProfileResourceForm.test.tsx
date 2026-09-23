import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ProfileResourceForm } from './ProfileResourceForm';
import {
  resolveEffectiveResourceShape,
  type ProfileResourceSchema,
  type ProfileResourceType,
} from './profile-resource-shape';

const USER_URN = 'urn:ietf:params:scim:schemas:core:2.0:User';

const resourceType: ProfileResourceType = {
  id: 'User',
  name: 'User',
  endpoint: '/Users',
  schema: USER_URN,
};

const schemas: ProfileResourceSchema[] = [{
  id: USER_URN,
  attributes: [
    { name: 'userName', type: 'string', required: true },
    { name: 'active', type: 'boolean' },
    { name: 'rank', type: 'integer' },
    { name: 'category', type: 'string', canonicalValues: ['employee', 'contractor'] },
    {
      name: 'emails',
      type: 'complex',
      multiValued: true,
      subAttributes: [{ name: 'value', type: 'string' }],
    },
  ],
}];

function Harness({ onValidityChange }: { onValidityChange: (valid: boolean) => void }) {
  const shape = resolveEffectiveResourceShape(resourceType, schemas);
  const [values, setValues] = useState<Record<string, unknown>>(
    Object.fromEntries(shape.fields.map((field) => [field.id, field.example])),
  );
  return (
    <FluentProvider theme={webLightTheme}>
      <ProfileResourceForm
        shape={shape}
        values={values}
        onChange={(fieldId, value) => setValues((current) => ({ ...current, [fieldId]: value }))}
        onValidityChange={onValidityChange}
        data-testid="profile-form"
      />
      <output data-testid="form-values">{JSON.stringify(values)}</output>
    </FluentProvider>
  );
}

describe('ProfileResourceForm', () => {
  it('renders profile fields with working examples and emits typed changes', async () => {
    const user = userEvent.setup();
    const onValidityChange = vi.fn();
    render(<Harness onValidityChange={onValidityChange} />);

    expect(screen.getByTestId('profile-form-userName-input')).toHaveValue('alex.taylor@example.com');
    expect(screen.getByRole('switch', { name: 'Active' })).toBeChecked();
    expect(screen.getByTestId('profile-form-rank-input')).toHaveValue(1);
    expect(screen.getByTestId('profile-form-rank-input')).toHaveAttribute('type', 'number');
    expect(screen.getByTestId('profile-form-category')).toHaveTextContent('employee');
    expect(screen.getByTestId('profile-form-emails-input')).toHaveValue(
      JSON.stringify([{ value: 'alex.taylor@example.com' }], null, 2),
    );

    fireEvent.change(screen.getByTestId('profile-form-rank-input'), { target: { value: '7' } });
    await user.click(screen.getByRole('switch', { name: 'Active' }));
    const values = JSON.parse(screen.getByTestId('form-values').textContent ?? '{}') as Record<string, unknown>;
    expect(values[`${USER_URN}|rank`]).toBe(7);
    expect(values[`${USER_URN}|active`]).toBe(false);
  });

  it('reports malformed structured JSON and recovers when corrected', () => {
    const onValidityChange = vi.fn();
    render(<Harness onValidityChange={onValidityChange} />);

    const input = screen.getByTestId('profile-form-emails-input');
    fireEvent.change(input, { target: { value: '{not-json' } });
    expect(screen.getByText('Enter valid JSON.')).toBeInTheDocument();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);

    fireEvent.change(input, { target: { value: '[]' } });
    expect(screen.queryByText('Enter valid JSON.')).not.toBeInTheDocument();
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });
});