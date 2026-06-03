/**
 * DetailDrawer primitive tests.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { DetailDrawer } from './DetailDrawer';

function wrap(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

describe('DetailDrawer', () => {
  it('does not render its body when open=false', () => {
    wrap(
      <DetailDrawer open={false} onClose={() => {}} title="Activity">
        <div data-testid="drawer-content">payload</div>
      </DetailDrawer>,
    );
    expect(screen.queryByTestId('drawer-content')).not.toBeInTheDocument();
  });

  it('renders title and body content when open=true', () => {
    wrap(
      <DetailDrawer open={true} onClose={() => {}} title="Activity Detail">
        <div data-testid="drawer-content">payload</div>
      </DetailDrawer>,
    );
    expect(screen.getByTestId('detail-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('detail-drawer-title')).toHaveTextContent('Activity Detail');
    expect(screen.getByTestId('drawer-content')).toHaveTextContent('payload');
  });

  it('renders the footer slot when supplied', () => {
    wrap(
      <DetailDrawer
        open={true}
        onClose={() => {}}
        title="X"
        footer={<button data-testid="primary-action">Save</button>}
      >
        <div>body</div>
      </DetailDrawer>,
    );
    expect(screen.getByTestId('detail-drawer-footer')).toBeInTheDocument();
    expect(screen.getByTestId('primary-action')).toBeInTheDocument();
  });

  it('omits the footer when not provided', () => {
    wrap(
      <DetailDrawer open={true} onClose={() => {}} title="X">
        <div>body</div>
      </DetailDrawer>,
    );
    expect(screen.queryByTestId('detail-drawer-footer')).not.toBeInTheDocument();
  });

  it('invokes onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    wrap(
      <DetailDrawer open={true} onClose={onClose} title="X">
        <div>body</div>
      </DetailDrawer>,
    );
    fireEvent.click(screen.getByTestId('detail-drawer-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('honors a custom data-testid', () => {
    wrap(
      <DetailDrawer data-testid="cred-drawer" open={true} onClose={() => {}} title="Credential">
        <div>body</div>
      </DetailDrawer>,
    );
    expect(screen.getByTestId('cred-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('cred-drawer-title')).toBeInTheDocument();
    expect(screen.getByTestId('cred-drawer-close')).toBeInTheDocument();
  });
});
