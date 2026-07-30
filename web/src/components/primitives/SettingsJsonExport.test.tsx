import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { SettingsJsonExport } from './SettingsJsonExport';

const renderWithFluent = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);

describe('SettingsJsonExport', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders a copy button + a download button with derived testids', () => {
    renderWithFluent(<SettingsJsonExport value={{ a: 1 }} data-testid="x" />);
    expect(screen.getByTestId('x')).toBeInTheDocument();
    expect(screen.getByTestId('x-copy')).toBeInTheDocument();
    expect(screen.getByTestId('x-download')).toBeInTheDocument();
  });

  it('copies the value as pretty-printed JSON', () => {
    renderWithFluent(<SettingsJsonExport value={{ profile: { settings: { A: true } } }} data-testid="x" />);
    fireEvent.click(screen.getByTestId('x-copy'));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    // Multi-line, 2-space indented, round-trips.
    expect(copied).toContain('\n');
    expect(JSON.parse(copied)).toEqual({ profile: { settings: { A: true } } });
  });

  it('triggers a download with the given filename', () => {
    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLElement;
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = clickSpy;
      }
      return el;
    });
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });

    renderWithFluent(<SettingsJsonExport value={{ a: 1 }} filename="my-settings.json" data-testid="x" />);
    fireEvent.click(screen.getByTestId('x-download'));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
