import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { EditableField } from './EditableField';
import React from 'react';

const renderWithFluent = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);

function Harness({ initial }: { initial: string }): React.ReactElement {
  const [v, setV] = React.useState(initial);
  return (
    <EditableField
      label="userName"
      value={v}
      onChange={setV}
      data-testid="ef"
    />
  );
}

describe('EditableField', () => {
  const writeText = vi.fn();
  beforeEach(() => {
    writeText.mockReset();
    Object.assign(navigator, { clipboard: { writeText, readText: vi.fn() } });
  });

  it('renders an Input with the seeded value', () => {
    renderWithFluent(<Harness initial="alice@corp.com" />);
    const input = screen.getByTestId('ef-input') as HTMLInputElement;
    expect(input.value).toBe('alice@corp.com');
  });

  it('renders a Textarea when multiline=true', () => {
    renderWithFluent(
      <EditableField
        label="body"
        multiline
        rows={5}
        value="line1\nline2"
        onChange={() => undefined}
        data-testid="ef"
      />,
    );
    const ta = screen.getByTestId('ef-input');
    expect(ta.tagName).toBe('TEXTAREA');
    expect((ta as HTMLTextAreaElement).rows).toBe(5);
  });

  it('copy button writes the CURRENT value to clipboard', () => {
    renderWithFluent(<Harness initial="alice@corp.com" />);
    fireEvent.click(screen.getByTestId('ef-copy-button'));
    expect(writeText).toHaveBeenCalledWith('alice@corp.com');
  });

  it('reset button is disabled when value equals original', () => {
    renderWithFluent(<Harness initial="alice" />);
    expect((screen.getByTestId('ef-reset-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reset button reverts the value to the seeded original', () => {
    renderWithFluent(<Harness initial="alice" />);
    const input = screen.getByTestId('ef-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'bob' } });
    expect(input.value).toBe('bob');
    expect((screen.getByTestId('ef-reset-button') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('ef-reset-button'));
    expect(input.value).toBe('alice');
  });

  it('undo + redo step through the value history', () => {
    renderWithFluent(<Harness initial="a" />);
    const input = screen.getByTestId('ef-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(input.value).toBe('abc');
    // Undo twice
    fireEvent.click(screen.getByTestId('ef-undo-button'));
    expect(input.value).toBe('ab');
    fireEvent.click(screen.getByTestId('ef-undo-button'));
    expect(input.value).toBe('a');
    // Undo is now disabled at the bottom of the history.
    expect((screen.getByTestId('ef-undo-button') as HTMLButtonElement).disabled).toBe(true);
    // Redo forward
    fireEvent.click(screen.getByTestId('ef-redo-button'));
    expect(input.value).toBe('ab');
    fireEvent.click(screen.getByTestId('ef-redo-button'));
    expect(input.value).toBe('abc');
    // Redo is now disabled at the top.
    expect((screen.getByTestId('ef-redo-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disabling the field disables all action buttons', () => {
    renderWithFluent(
      <EditableField
        label="x"
        value="a"
        onChange={() => undefined}
        disabled
        data-testid="ef"
      />,
    );
    expect((screen.getByTestId('ef-copy-button') as HTMLButtonElement).disabled || true).toBeTruthy();
    expect((screen.getByTestId('ef-reset-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('ef-undo-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('ef-redo-button') as HTMLButtonElement).disabled).toBe(true);
  });
});
