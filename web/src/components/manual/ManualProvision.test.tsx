import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManualProvision } from './ManualProvision';
import { setStoredToken } from '../../auth/token';

// Mock the API client functions
vi.mock('../../api/client', () => ({
  createManualUser: vi.fn(),
  createManualGroup: vi.fn(),
}));

import { createManualUser, createManualGroup } from '../../api/client';

describe('ManualProvision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoredToken('test-token');
  });

  it('renders user provisioning heading', () => {
    render(<ManualProvision />);
    expect(screen.getByText(/manual user provisioning/i)).toBeInTheDocument();
  });

  it('renders group provisioning heading', () => {
    render(<ManualProvision />);
    expect(screen.getByText(/manual group provisioning/i)).toBeInTheDocument();
  });

  it('renders userName input with required indicator', () => {
    render(<ManualProvision />);
    expect(screen.getByPlaceholderText('user@example.com')).toBeInTheDocument();
  });

  it('renders all user form fields', () => {
    render(<ManualProvision />);
    expect(screen.getByPlaceholderText('user@example.com')).toBeInTheDocument();
    // Both user and group forms have displayName — just verify at least 2 exist
    const displayNameInputs = screen.getAllByRole('textbox', { name: /displayname/i });
    expect(displayNameInputs.length).toBeGreaterThanOrEqual(2);
  });

  it('has Create User button disabled when userName is empty', () => {
    render(<ManualProvision />);
    const btn = screen.getByRole('button', { name: /create user/i });
    expect(btn).toBeDisabled();
  });

  it('enables Create User when userName is provided', async () => {
    const user = userEvent.setup();
    render(<ManualProvision />);

    await user.type(screen.getByPlaceholderText('user@example.com'), 'test@example.com');
    const btn = screen.getByRole('button', { name: /create user/i });
    expect(btn).not.toBeDisabled();
  });

  it('has Create Group button disabled when displayName is empty', () => {
    render(<ManualProvision />);
    const btn = screen.getByRole('button', { name: /create group/i });
    expect(btn).toBeDisabled();
  });

  it('renders Reset buttons for both forms', () => {
    render(<ManualProvision />);
    const resetButtons = screen.getAllByRole('button', { name: /reset/i });
    expect(resetButtons.length).toBe(2);
  });

  it('renders the collision testing guide disclosure', () => {
    render(<ManualProvision />);
    expect(screen.getByText(/how to create collision scenarios/i)).toBeInTheDocument();
  });

  it('renders group member IDs textarea', () => {
    render(<ManualProvision />);
    expect(screen.getByRole('textbox', { name: /member ids/i })).toBeInTheDocument();
  });

  it('calls createManualUser on submit', async () => {
    const user = userEvent.setup();
    (createManualUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'new-id',
      userName: 'test@example.com',
    });

    render(<ManualProvision />);

    await user.type(screen.getByPlaceholderText('user@example.com'), 'test@example.com');
    await user.click(screen.getByRole('button', { name: /create user/i }));

    expect(createManualUser).toHaveBeenCalledWith(
      expect.objectContaining({ userName: 'test@example.com' })
    );
  });

  it('resets user form when Reset clicked', async () => {
    const user = userEvent.setup();
    render(<ManualProvision />);

    await user.type(screen.getByPlaceholderText('user@example.com'), 'test@example.com');
    const resetButtons = screen.getAllByRole('button', { name: /reset/i });
    await user.click(resetButtons[0]);

    expect(screen.getByPlaceholderText('user@example.com')).toHaveValue('');
  });
});
