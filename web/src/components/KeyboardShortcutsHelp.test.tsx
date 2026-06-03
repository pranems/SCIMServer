/**
 * KeyboardShortcutsHelp tests (Phase F2).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp';

function wrap(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

describe('KeyboardShortcutsHelp', () => {
  it('renders nothing when open=false', () => {
    wrap(<KeyboardShortcutsHelp open={false} onOpenChange={() => undefined} />);
    expect(screen.queryByTestId('shortcuts-help')).not.toBeInTheDocument();
  });

  it('lists every navigation shortcut', () => {
    wrap(<KeyboardShortcutsHelp open onOpenChange={() => undefined} />);
    expect(screen.getByText('Go to Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Go to Endpoints')).toBeInTheDocument();
    expect(screen.getByText('Go to Manual Provision')).toBeInTheDocument();
    expect(screen.getByText('Go to Logs')).toBeInTheDocument();
    expect(screen.getByText('Go to Settings')).toBeInTheDocument();
  });

  it('lists search and help shortcuts', () => {
    wrap(<KeyboardShortcutsHelp open onOpenChange={() => undefined} />);
    expect(screen.getByText('Open command palette / search')).toBeInTheDocument();
    expect(screen.getByText('Show this shortcuts help')).toBeInTheDocument();
    expect(screen.getByText('Open command palette (mac)')).toBeInTheDocument();
    expect(screen.getByText('Open command palette (windows / linux)')).toBeInTheDocument();
    expect(screen.getByText('Close palette / drawer / dialog')).toBeInTheDocument();
  });

  it('Close button fires onOpenChange(false)', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    wrap(<KeyboardShortcutsHelp open onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('button', { name: /Close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
