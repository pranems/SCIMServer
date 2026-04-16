import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from './Header';
import { ThemeProvider } from '../hooks/useTheme';

const renderHeader = (tokenConfigured = true) => {
  const onChangeToken = vi.fn();
  render(
    <ThemeProvider>
      <Header tokenConfigured={tokenConfigured} onChangeToken={onChangeToken} />
    </ThemeProvider>
  );
  return { onChangeToken };
};

describe('Header', () => {
  it('renders the SCIMServer title', () => {
    renderHeader();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('SCIMServer');
  });

  it('renders the subtitle', () => {
    renderHeader();
    expect(screen.getByText('SCIM 2.0 Provisioning Monitor')).toBeInTheDocument();
  });

  it('shows Active status', () => {
    renderHeader();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows "Set Token" when token not configured', () => {
    renderHeader(false);
    expect(screen.getByRole('button', { name: /set token/i })).toBeInTheDocument();
    expect(screen.getByText('Token required')).toBeInTheDocument();
  });

  it('shows "Change Token" when token is configured', () => {
    renderHeader(true);
    expect(screen.getByRole('button', { name: /change token/i })).toBeInTheDocument();
  });

  it('calls onChangeToken when button clicked', async () => {
    const user = userEvent.setup();
    const { onChangeToken } = renderHeader(true);

    await user.click(screen.getByRole('button', { name: /change token/i }));
    expect(onChangeToken).toHaveBeenCalledOnce();
  });

  it('has a theme toggle button', () => {
    renderHeader();
    // Default is dark → button shows sun emoji (☀️) for switching to light
    const buttons = screen.getAllByRole('button');
    const themeBtn = buttons.find(b => b.textContent?.includes('☀') || b.textContent?.includes('🌙'));
    expect(themeBtn).toBeDefined();
  });

  it('toggles theme when theme button clicked', async () => {
    const user = userEvent.setup();
    renderHeader();

    // Initially dark → shows ☀️ (click to switch to light)
    const buttons = screen.getAllByRole('button');
    const themeBtn = buttons.find(b => b.textContent?.includes('☀'))!;
    expect(themeBtn).toBeDefined();
    await user.click(themeBtn);

    // After toggle → should show 🌙 (click to switch back to dark)
    const updatedButtons = screen.getAllByRole('button');
    const moonBtn = updatedButtons.find(b => b.textContent?.includes('🌙'));
    expect(moonBtn).toBeDefined();
  });

  it('does not render backup stats indicators', () => {
    renderHeader();
    // After removing dead BackupService code, no backup-related text should appear
    expect(screen.queryByText(/backup/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/snapshot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no persistence/i)).not.toBeInTheDocument();
  });

  it('does not produce console errors about backup stats', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderHeader();
    // Should not log any backup-related warnings
    const backupWarns = warnSpy.mock.calls.filter(
      args => args.some(arg => typeof arg === 'string' && arg.includes('backup'))
    );
    expect(backupWarns.length).toBe(0);
    warnSpy.mockRestore();
  });
});
