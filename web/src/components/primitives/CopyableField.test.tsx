import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { CopyableField } from './CopyableField';

const renderWithFluent = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);

describe('CopyableField primitive', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the value + a copy button by default', () => {
    renderWithFluent(<CopyableField value="abc-123" data-testid="f1" />);
    expect(screen.getByTestId('f1')).toHaveTextContent('abc-123');
    expect(screen.getByTestId('f1-copy-button')).toBeInTheDocument();
  });

  it('clicking the copy button writes the value to the clipboard', async () => {
    renderWithFluent(<CopyableField value="user@example.com" data-testid="f2" />);
    fireEvent.click(screen.getByTestId('f2-copy-button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('user@example.com'));
  });

  it('honours copyValue override (display one string, copy a different one)', async () => {
    renderWithFluent(
      <CopyableField value="user@e..." copyValue="user@example.com" data-testid="f3" />,
    );
    fireEvent.click(screen.getByTestId('f3-copy-button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('user@example.com'));
  });

  it('buttonOnly=true renders only the button (no inline value text node)', () => {
    renderWithFluent(<CopyableField value="abc-def" buttonOnly data-testid="f4" />);
    const wrapper = screen.getByTestId('f4');
    // The wrapper text content should equal the empty button's accessible label only
    // (Fluent Button with icon-only sets aria-label, not visible text).
    expect(wrapper.textContent).toBe('');
    expect(screen.getByTestId('f4-copy-button')).toBeInTheDocument();
  });

  it('truncate=true composes TruncatedText for long values', () => {
    const long = 'urn:ietf:params:scim:schemas:extension:proviam:2.0:Employee';
    renderWithFluent(
      <CopyableField value={long} truncate maxWidth={200} data-testid="f5" />,
    );
    // TruncatedText sets overflow:hidden + textOverflow:ellipsis
    const wrapper = screen.getByTestId('f5');
    const styled = wrapper.querySelector('[style*="max-width"]') as HTMLElement | null;
    expect(styled).not.toBeNull();
  });

  it('click on the copy button does not bubble (e.g. inside clickable row)', async () => {
    const rowClick = vi.fn();
    renderWithFluent(
      <div onClick={rowClick}>
        <CopyableField value="x" data-testid="f6" />
      </div>,
    );
    fireEvent.click(screen.getByTestId('f6-copy-button'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('renders an icon-only button with accessible label for the row context', () => {
    renderWithFluent(<CopyableField value="abc" data-testid="f7" />);
    const btn = screen.getByTestId('f7-copy-button');
    expect(btn).toHaveAttribute('aria-label', 'Copy abc');
  });

  it('honours custom ariaLabel when supplied (for noisy values like tokens)', () => {
    renderWithFluent(
      <CopyableField value="eyJh...redacted" ariaLabel="Copy bearer token" data-testid="f8" />,
    );
    const btn = screen.getByTestId('f8-copy-button');
    expect(btn).toHaveAttribute('aria-label', 'Copy bearer token');
  });
});
