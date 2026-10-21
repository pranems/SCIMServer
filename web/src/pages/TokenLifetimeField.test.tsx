import { describe, expect, it, vi } from 'vitest';
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
