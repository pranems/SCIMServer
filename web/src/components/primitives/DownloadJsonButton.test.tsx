/**
 * DownloadJsonButton primitive tests.
 *
 * Asserts the OUTCOME (a download is triggered with the right filename and the
 * COMPLETE pretty-printed JSON content), not merely that the button renders -
 * covering both the Blob + object-URL path and the data-URI fallback.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { DownloadJsonButton } from './DownloadJsonButton';

function wrap(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

function spyCreatedAnchors(): HTMLAnchorElement[] {
  const created: HTMLAnchorElement[] = [];
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const el = realCreate(tag);
    if (tag === 'a') created.push(el as HTMLAnchorElement);
    return el;
  }) as typeof document.createElement);
  return created;
}

describe('DownloadJsonButton', () => {
  const originalCreateObjectUrl = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  const originalRevokeObjectUrl = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;

  afterEach(() => {
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = originalCreateObjectUrl;
    (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = originalRevokeObjectUrl;
    vi.restoreAllMocks();
  });

  it('renders the default label', () => {
    wrap(<DownloadJsonButton value={{ a: 1 }} data-testid="dl" />);
    expect(screen.getByTestId('dl')).toHaveTextContent('Download JSON');
  });

  it('downloads the complete value as pretty-printed JSON with a .json filename (data-URI fallback)', () => {
    // Force the data-URI fallback so the content is inspectable.
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = undefined;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const created = spyCreatedAnchors();

    wrap(
      <DownloadJsonButton
        value={{ id: 'abc', nested: { x: 1 } }}
        filename="log-abc"
        data-testid="dl"
      />,
    );
    fireEvent.click(screen.getByTestId('dl'));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = created[created.length - 1];
    expect(anchor.download).toBe('log-abc.json');
    expect(anchor.href).toContain('data:application/json');
    const decoded = decodeURIComponent(anchor.href.split(',').slice(1).join(','));
    expect(JSON.parse(decoded)).toEqual({ id: 'abc', nested: { x: 1 } });
    // 2-space pretty print => a newline followed by indentation.
    expect(decoded).toContain('\n  ');
  });

  it('uses Blob + object URL when available and revokes it', () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const created = spyCreatedAnchors();

    wrap(<DownloadJsonButton value={{ ok: true }} data-testid="dl" />);
    fireEvent.click(screen.getByTestId('dl'));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(created[created.length - 1].href).toContain('blob:mock-url');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('appends .json and sanitises unsafe filename characters', () => {
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const created = spyCreatedAnchors();

    wrap(<DownloadJsonButton value={{}} filename="My Record/2026" data-testid="dl" />);
    fireEvent.click(screen.getByTestId('dl'));

    expect(created[created.length - 1].download).toBe('My-Record-2026.json');
  });
});
