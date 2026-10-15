import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateTimeField } from './DateTimeField';

describe('DateTimeField', () => {
  it('renders a semantic complete UTC timestamp and copies the source instant', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      render(<DateTimeField value="2026-10-15T01:59:58.123+02:00" data-testid="instant" />);
      expect(screen.getByText('2026-10-14 23:59:58.123 UTC').closest('time')).toHaveAttribute(
        'datetime',
        '2026-10-14T23:59:58.123Z',
      );
      fireEvent.click(screen.getByTestId('instant-copy-button'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('2026-10-15T01:59:58.123+02:00'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows invalid input explicitly without publishing a false semantic timestamp', () => {
    const { container } = render(<DateTimeField value="broken" />);
    expect(screen.getByText('Invalid timestamp: broken')).toBeInTheDocument();
    expect(container.querySelector('time')).toBeNull();
  });

  it('does not offer a meaningless copy action for a missing timestamp', () => {
    render(<DateTimeField value={null} data-testid="missing" />);
    expect(screen.getByTestId('missing')).toHaveTextContent('-');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
