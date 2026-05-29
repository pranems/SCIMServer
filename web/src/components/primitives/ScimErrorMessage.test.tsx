/**
 * ScimErrorMessage.test.tsx - Phase K3 primitive contract.
 *
 * Locks the rendering behavior:
 *   - Always shows the catalog title in a Fluent MessageBar (intent=error).
 *   - Always shows the plain-English explanation as the body.
 *   - Optionally shows the raw `detail` from the server.
 *   - Optionally shows a "View details" expander with rawBody JSON.
 *   - Optionally shows a docsUrl link when the catalog entry has one.
 *   - Renders nothing when given `null` / `undefined` (so callers can
 *     unconditionally mount it without an `{error && <X />}` guard).
 *
 * @see docs/PHASE_K3_SMART_ERROR_EXPLAINER.md
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ScimErrorMessage } from './ScimErrorMessage';
import { ScimApiError, SCIM_ERROR_CATALOG } from '../../api/scim-error';

function renderWithFluent(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

describe('ScimErrorMessage', () => {
  it('renders nothing when error is null', () => {
    renderWithFluent(<ScimErrorMessage error={null} />);
    // FluentProvider always renders a wrapper div, so we assert via
    // testid rather than container.firstChild.
    expect(screen.queryByTestId('scim-error-message')).toBeNull();
  });

  it('renders nothing when error is undefined', () => {
    renderWithFluent(<ScimErrorMessage error={undefined} />);
    expect(screen.queryByTestId('scim-error-message')).toBeNull();
  });

  it('renders the catalog title for a known scimType', () => {
    const err = new ScimApiError({ status: 409, scimType: 'uniqueness', detail: 'userName taken' });
    renderWithFluent(<ScimErrorMessage error={err} />);
    expect(screen.getByTestId('scim-error-message')).toBeInTheDocument();
    expect(screen.getByText(SCIM_ERROR_CATALOG.uniqueness.title)).toBeInTheDocument();
  });

  it('renders the catalog plain-English explanation as the body', () => {
    const err = new ScimApiError({ status: 400, scimType: 'mutability', detail: 'readOnly' });
    renderWithFluent(<ScimErrorMessage error={err} />);
    expect(screen.getByText(SCIM_ERROR_CATALOG.mutability.explanation)).toBeInTheDocument();
  });

  it('shows the server detail line when present', () => {
    const err = new ScimApiError({ status: 409, scimType: 'uniqueness', detail: 'userName already taken' });
    renderWithFluent(<ScimErrorMessage error={err} />);
    expect(screen.getByText(/userName already taken/)).toBeInTheDocument();
  });

  it('exposes a "View details" expander when rawBody is present, hidden by default', async () => {
    const err = new ScimApiError({
      status: 409,
      scimType: 'uniqueness',
      detail: 'dup',
      // Real SCIM error bodies carry scimType too - fixture mirrors
      // what the server actually returns.
      rawBody: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '409',
        scimType: 'uniqueness',
        detail: 'dup',
      },
    });
    renderWithFluent(<ScimErrorMessage error={err} />);
    const toggle = screen.getByTestId('scim-error-toggle-raw');
    expect(toggle).toBeInTheDocument();
    // Expander starts collapsed.
    expect(screen.queryByTestId('scim-error-raw-json')).toBeNull();
    await userEvent.click(toggle);
    const raw = screen.getByTestId('scim-error-raw-json');
    expect(raw).toBeInTheDocument();
    expect(raw.textContent).toContain('uniqueness');
    expect(raw.textContent).toContain('messages:2.0:Error');
  });

  it('does not render the View-details expander when rawBody is absent', () => {
    const err = new ScimApiError({ status: 500, detail: 'boom' });
    renderWithFluent(<ScimErrorMessage error={err} />);
    expect(screen.queryByTestId('scim-error-toggle-raw')).toBeNull();
  });

  it('renders a docsUrl link when the catalog entry has one', () => {
    // Pick any catalog entry that has a docsUrl - the test stays stable
    // even if a future entry adds / removes one.
    const docKeyword = Object.keys(SCIM_ERROR_CATALOG).find(
      (k) => SCIM_ERROR_CATALOG[k].docsUrl,
    );
    if (!docKeyword) return; // catalog has no docs links right now - test is a no-op
    const err = new ScimApiError({ status: 400, scimType: docKeyword, detail: 'x' });
    renderWithFluent(<ScimErrorMessage error={err} />);
    const link = screen.getByTestId('scim-error-docs-link');
    expect(link).toHaveAttribute('href', SCIM_ERROR_CATALOG[docKeyword].docsUrl);
    expect(link).toHaveAttribute('target', '_blank');
    // a11y - external link must announce that it opens in a new tab
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('falls back to the generic catalog entry for an unparseable error (string)', () => {
    renderWithFluent(<ScimErrorMessage error="unrecognized failure" />);
    expect(screen.getByTestId('scim-error-message')).toBeInTheDocument();
    // Generic title is non-empty.
    expect(screen.getByTestId('scim-error-title').textContent?.length).toBeGreaterThan(0);
    // The original detail is still surfaced.
    expect(screen.getByText(/unrecognized failure/)).toBeInTheDocument();
  });

  // ─── Phase P1 - CopyableField primitives ───────────────────────────
  describe('Phase P1 - CopyableField primitives', () => {
    it('renders copy button next to the detail line', () => {
      const err = new ScimApiError({ status: 409, scimType: 'uniqueness', detail: 'userName already taken' });
      renderWithFluent(<ScimErrorMessage error={err} />);
      expect(screen.getByTestId('scim-error-detail-action-copy-button')).toBeInTheDocument();
    });

    it('renders copy button next to the requestId line', () => {
      const err = new ScimApiError({
        status: 409,
        scimType: 'uniqueness',
        detail: 'dup',
        requestId: 'req-abc-123',
      });
      renderWithFluent(<ScimErrorMessage error={err} />);
      expect(screen.getByTestId('scim-error-request-id-action-copy-button')).toBeInTheDocument();
    });

    it('renders copy button next to the rawBody pre when expanded', async () => {
      const err = new ScimApiError({
        status: 409,
        scimType: 'uniqueness',
        detail: 'dup',
        rawBody: { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '409' },
      });
      renderWithFluent(<ScimErrorMessage error={err} />);
      const toggle = screen.getByTestId('scim-error-toggle-raw');
      await userEvent.click(toggle);
      expect(screen.getByTestId('scim-error-raw-json-action-copy-button')).toBeInTheDocument();
    });
  });
});
