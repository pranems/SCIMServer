import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from './useTheme';

const ThemeConsumer: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>Toggle</button>
    </div>
  );
};

describe('useTheme', () => {
  it('defaults to dark theme', () => {
    render(<ThemeProvider><ThemeConsumer /></ThemeProvider>);
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('reads stored theme from localStorage', () => {
    localStorage.setItem('scimserver-theme', 'light');
    render(<ThemeProvider><ThemeConsumer /></ThemeProvider>);
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('toggles between dark and light', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><ThemeConsumer /></ThemeProvider>);

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');

    await user.click(screen.getByText('Toggle'));
    expect(screen.getByTestId('theme')).toHaveTextContent('light');

    await user.click(screen.getByText('Toggle'));
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('persists theme to localStorage', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><ThemeConsumer /></ThemeProvider>);

    await user.click(screen.getByText('Toggle'));
    expect(localStorage.getItem('scimserver-theme')).toBe('light');
  });

  it('sets data-theme attribute on document', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><ThemeConsumer /></ThemeProvider>);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    await user.click(screen.getByText('Toggle'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('throws when used outside provider', () => {
    // Suppress React error boundary console noise
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ThemeConsumer />)).toThrow('useTheme must be used within a ThemeProvider');
    spy.mockRestore();
  });
});
