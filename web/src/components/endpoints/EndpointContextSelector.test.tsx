import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { EndpointContextSelector } from './EndpointContextSelector';

const endpoints = [
  { id: 'ep-1', name: 'prod-west', displayName: 'Production West', active: true },
  { id: 'ep-2', name: 'staging', displayName: 'Staging', active: false },
];

describe('EndpointContextSelector', () => {
  it('shows display name, stable name, and active state for each target', async () => {
    const user = userEvent.setup();
    render(
      <FluentProvider theme={webLightTheme}>
        <EndpointContextSelector
          endpoints={endpoints}
          value=""
          onChange={vi.fn()}
          label="Target endpoint"
          purpose="Resources will be created here."
        />
      </FluentProvider>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Target endpoint' }));
    expect(await screen.findByText('Production West')).toBeInTheDocument();
    expect(screen.getByText(/prod-west.*Active/i)).toBeInTheDocument();
    expect(screen.getByText(/staging.*Inactive/i)).toBeInTheDocument();
  });

  it('reports the selected endpoint id and renders its contextual summary', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <FluentProvider theme={webLightTheme}>
        <EndpointContextSelector
          endpoints={endpoints}
          value=""
          onChange={onChange}
          label="Target endpoint"
        />
      </FluentProvider>,
    );

    await user.click(screen.getByRole('combobox', { name: 'Target endpoint' }));
    await user.click(await screen.findByRole('option', { name: /Production West/i }));
    expect(onChange).toHaveBeenCalledWith('ep-1');

    rerender(
      <FluentProvider theme={webLightTheme}>
        <EndpointContextSelector
          endpoints={endpoints}
          value="ep-1"
          onChange={onChange}
          label="Target endpoint"
        />
      </FluentProvider>,
    );
    expect(screen.getByTestId('endpoint-context-selected')).toHaveTextContent('Production West');
    expect(screen.getByTestId('endpoint-context-selected')).toHaveTextContent('prod-west');
  });
});