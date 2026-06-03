import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { CopyJsonButton } from './CopyJsonButton';

const renderWithFluent = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);

describe('CopyJsonButton', () => {
  const writeText = vi.fn();
  beforeEach(() => {
    writeText.mockReset();
    Object.assign(navigator, { clipboard: { writeText, readText: vi.fn() } });
  });

  it('renders a button with default label "Copy as JSON"', () => {
    renderWithFluent(<CopyJsonButton value={{ a: 1 }} data-testid="cj" />);
    const btn = screen.getByTestId('cj');
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toMatch(/Copy as JSON/i);
  });

  it('writes pretty-printed JSON to the clipboard on click', async () => {
    const value = { schemas: ['core'], name: { familyName: 'Doe' } };
    renderWithFluent(<CopyJsonButton value={value} data-testid="cj" />);
    fireEvent.click(screen.getByTestId('cj'));
    expect(writeText).toHaveBeenCalledTimes(1);
    const payload = writeText.mock.calls[0][0] as string;
    expect(JSON.parse(payload)).toEqual(value);
    // Pretty-print confirms two-space indent.
    expect(payload).toContain('\n  "schemas"');
  });

  it('honors the indent override', () => {
    renderWithFluent(<CopyJsonButton value={{ x: 1 }} indent={4} data-testid="cj" />);
    fireEvent.click(screen.getByTestId('cj'));
    expect(writeText.mock.calls[0][0]).toContain('\n    "x"');
  });

  it('falls back to String(value) when JSON.stringify throws', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    renderWithFluent(<CopyJsonButton value={cyclic} data-testid="cj" />);
    fireEvent.click(screen.getByTestId('cj'));
    expect(writeText).toHaveBeenCalledTimes(1);
    // Either '[object Object]' or anything non-empty - never silently nothing.
    expect(writeText.mock.calls[0][0]).not.toBe('');
  });

  it('renders icon-only when iconOnly is true (label hidden)', () => {
    renderWithFluent(
      <CopyJsonButton value={{}} label="Hidden" iconOnly data-testid="cj" ariaLabel="aria-only" />,
    );
    const btn = screen.getByTestId('cj');
    expect(btn.textContent ?? '').not.toContain('Hidden');
    expect(btn.getAttribute('aria-label')).toBe('aria-only');
  });

  it('stops click propagation so it does not trigger parent row clicks', () => {
    const parentClick = vi.fn();
    renderWithFluent(
      <div onClick={parentClick}>
        <CopyJsonButton value={{}} data-testid="cj" />
      </div>,
    );
    fireEvent.click(screen.getByTestId('cj'));
    expect(parentClick).not.toHaveBeenCalled();
  });
});
