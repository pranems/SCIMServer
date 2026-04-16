import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './useAuth';
import { TOKEN_STORAGE_KEY } from '../auth/token';

const AuthConsumer: React.FC = () => {
  const { token, setToken, clearToken } = useAuth();
  return (
    <div>
      <span data-testid="token">{token ?? 'none'}</span>
      <button onClick={() => setToken('test-token')}>Set</button>
      <button onClick={clearToken}>Clear</button>
    </div>
  );
};

describe('useAuth', () => {
  it('starts with no token', () => {
    render(<AuthProvider><AuthConsumer /></AuthProvider>);
    expect(screen.getByTestId('token')).toHaveTextContent('none');
  });

  it('reads token from localStorage on mount', () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'stored-secret');
    render(<AuthProvider><AuthConsumer /></AuthProvider>);
    expect(screen.getByTestId('token')).toHaveTextContent('stored-secret');
  });

  it('sets a new token', async () => {
    const user = userEvent.setup();
    render(<AuthProvider><AuthConsumer /></AuthProvider>);

    await user.click(screen.getByText('Set'));
    expect(screen.getByTestId('token')).toHaveTextContent('test-token');
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('test-token');
  });

  it('clears the token', async () => {
    const user = userEvent.setup();
    localStorage.setItem(TOKEN_STORAGE_KEY, 'to-clear');
    render(<AuthProvider><AuthConsumer /></AuthProvider>);

    expect(screen.getByTestId('token')).toHaveTextContent('to-clear');
    await user.click(screen.getByText('Clear'));
    expect(screen.getByTestId('token')).toHaveTextContent('none');
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('throws when used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<AuthConsumer />)).toThrow('useAuth must be used within an AuthProvider');
    spy.mockRestore();
  });
});
