import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LogDetail } from './LogDetail';
import type { RequestLogItem } from '../api/client';

const sampleLog: RequestLogItem = {
  id: 'log-1',
  method: 'POST',
  url: '/scim/endpoints/abc/Users',
  status: 201,
  durationMs: 45,
  createdAt: '2026-04-13T14:23:01.123Z',
  reportableIdentifier: 'jdoe@example.com',
  requestHeaders: { 'content-type': 'application/scim+json' },
  responseHeaders: { 'location': '/scim/endpoints/abc/Users/xyz' },
  requestBody: { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'jdoe@example.com' },
  responseBody: { id: 'xyz', userName: 'jdoe@example.com' },
};

describe('LogDetail', () => {
  it('renders nothing when log is null', () => {
    const { container } = render(<LogDetail log={null} onClose={() => {}} />);
    // Should not render any visible content
    expect(container.querySelector('[class*="overlay"]')).toBeNull();
  });

  it('renders log details when log is provided', () => {
    render(<LogDetail log={sampleLog} onClose={() => {}} />);
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('201')).toBeInTheDocument();
    expect(screen.getByText('45ms')).toBeInTheDocument();
  });

  it('renders the URL', () => {
    render(<LogDetail log={sampleLog} onClose={() => {}} />);
    expect(screen.getByText('/scim/endpoints/abc/Users')).toBeInTheDocument();
  });

  it('renders the identifier', () => {
    render(<LogDetail log={sampleLog} onClose={() => {}} />);
    expect(screen.getByText('jdoe@example.com')).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<LogDetail log={sampleLog} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders collapsible sections for headers/body', () => {
    render(<LogDetail log={sampleLog} onClose={() => {}} />);
    // There should be summary elements for the collapsible sections
    expect(screen.getByText('Request Headers')).toBeInTheDocument();
    expect(screen.getByText('Response Headers')).toBeInTheDocument();
    expect(screen.getByText('Request Body')).toBeInTheDocument();
    expect(screen.getByText('Response Body')).toBeInTheDocument();
  });
});
