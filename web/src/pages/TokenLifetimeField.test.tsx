import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { TokenLifetimeField, tokenLifetimeError } from './TokenLifetimeField';

describe('TokenLifetimeField', () => {
  it.each(['60', '61', '3600', '604800', ''])('accepts %s', (value) => {
    expect(tokenLifetimeError(value)).toBeUndefined();
  });

  it.each(['59', '604801', '60.5', 'invalid', 'Infinity'])('rejects %s', (value) => {
    expect(tokenLifetimeError(value)).toContain('between 60 and 604800');
  });

  it('commits a cleared persisted override as null only when leaving the composite', () => {
    const onCommit = vi.fn();
    render(
      <FluentProvider theme={webLightTheme}>
        <TokenLifetimeField label="Lifetime" value="604800" onCommit={onCommit} data-testid="ttl" />
        <button data-testid="outside">Outside</button>
      </FluentProvider>,
    );
    const input = screen.getByTestId('ttl-input');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input, { relatedTarget: screen.getByTestId('ttl-undo-button') });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByTestId('ttl-undo-button'), { relatedTarget: screen.getByTestId('outside') });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('keeps a preset as a draft until focus leaves the composite', () => {
    const onCommit = vi.fn();
    render(
      <FluentProvider theme={webLightTheme}>
        <TokenLifetimeField label="Lifetime" value="3600" onCommit={onCommit} data-testid="ttl" />
        <button data-testid="outside">Outside</button>
      </FluentProvider>,
    );
    const presets = screen.getByTestId('ttl-presets');
    fireEvent.click(presets);
    fireEvent.click(screen.getByRole('option', { name: '1 week (604800 seconds)' }));
    expect(screen.getByTestId('ttl-input')).toHaveValue('604800');
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(presets, { relatedTarget: screen.getByTestId('ttl-input') });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByTestId('ttl-input'), { relatedTarget: screen.getByTestId('outside') });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(604800);
  });

  it('preserves preset Undo, Redo and the loaded reset baseline in a controlled trust form', () => {
    function TrustForm() {
      const [value, setValue] = React.useState('3600');
      return <TokenLifetimeField label="Lifetime" value={value} onChange={setValue} data-testid="ttl" />;
    }
    render(<FluentProvider theme={webLightTheme}><TrustForm /></FluentProvider>);
    fireEvent.click(screen.getByTestId('ttl-presets'));
    fireEvent.click(screen.getByRole('option', { name: '1 week (604800 seconds)' }));
    const input = screen.getByTestId('ttl-input');
    expect(input).toHaveValue('604800');
    expect(screen.getByTestId('ttl-undo-button')).toBeEnabled();
    fireEvent.click(screen.getByTestId('ttl-undo-button'));
    expect(input).toHaveValue('3600');
    fireEvent.click(screen.getByTestId('ttl-redo-button'));
    expect(input).toHaveValue('604800');
    fireEvent.click(screen.getByTestId('ttl-reset-button'));
    expect(input).toHaveValue('3600');
  });

  it('does not add an Undo entry when choosing the unchanged preset', () => {
    const onCommit = vi.fn();
    render(
      <FluentProvider theme={webLightTheme}>
        <TokenLifetimeField label="Lifetime" value="3600" onCommit={onCommit} data-testid="ttl" />
      </FluentProvider>,
    );
    fireEvent.click(screen.getByTestId('ttl-presets'));
    fireEvent.click(screen.getByRole('option', { name: '1 hour (default) (3600 seconds)' }));
    expect(screen.getByTestId('ttl-input')).toHaveValue('3600');
    expect(screen.getByTestId('ttl-undo-button')).toBeDisabled();
    expect(screen.getByTestId('ttl-reset-button')).toBeDisabled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('keeps preset and editable input control identities distinct', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <TokenLifetimeField label="Lifetime" value="3600" data-testid="ttl" />
      </FluentProvider>,
    );
    const inputId = screen.getByTestId('ttl-input').getAttribute('id');
    expect(inputId).toBeTruthy();
    expect(screen.getByTestId('ttl-presets').getAttribute('id')).not.toBe(inputId);
    expect(document.querySelectorAll(`[id="${inputId}"]`)).toHaveLength(1);
  });

  it('does not auto-save when focus moves to undo, and saves the final draft when leaving', () => {
    const onCommit = vi.fn();
    render(
      <FluentProvider theme={webLightTheme}>
        <TokenLifetimeField label="Lifetime" value="3600" onCommit={onCommit} data-testid="ttl" />
        <button data-testid="outside">Outside</button>
      </FluentProvider>,
    );
    const input = screen.getByTestId('ttl-input');
    const undo = screen.getByTestId('ttl-undo-button');
    const redo = screen.getByTestId('ttl-redo-button');
    fireEvent.change(input, { target: { value: '61' } });
    fireEvent.blur(input, { relatedTarget: undo });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.click(undo);
    expect(input).toHaveValue('3600');
    fireEvent.click(redo);
    expect(input).toHaveValue('61');
    fireEvent.blur(redo, { relatedTarget: screen.getByTestId('outside') });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(61);
  });
});
