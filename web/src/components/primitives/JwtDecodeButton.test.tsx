import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { JwtDecodeButton } from './JwtDecodeButton';
import { CopyableJsonBlock } from './CopyableJsonBlock';

function makeJwt(header: object, payload: object, sig = 'sig'): string {
  const enc = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc(header)}.${enc(payload)}.${sig}`;
}

const wrap = (ui: React.ReactElement) =>
  render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);

describe('JwtDecodeButton', () => {
  it('renders nothing when the value is not a JWT', () => {
    const { container } = wrap(<JwtDecodeButton token="not-a-jwt" data-testid="jd" />);
    expect(container.querySelector('[data-testid="jd"]')).toBeNull();
  });

  it('reveals the decoded header + claims on click', () => {
    const jwt = makeJwt({ alg: 'RS256', kid: 'k9' }, { sub: 'user-9', aud: 'api://z' });
    wrap(<JwtDecodeButton token={jwt} data-testid="jd" />);
    expect(screen.queryByTestId('jd-result')).toBeNull();
    fireEvent.click(screen.getByTestId('jd-button'));
    expect(screen.getByTestId('jd-result')).toBeInTheDocument();
    expect(screen.getByTestId('jd-header-pre').textContent).toContain('k9');
    expect(screen.getByTestId('jd-payload-pre').textContent).toContain('user-9');
  });
});

describe('CopyableJsonBlock JWT inline decode (W2)', () => {
  it('offers a decode button for a JWT value nested in the JSON', () => {
    const jwt = makeJwt({ alg: 'RS256' }, { sub: 'u' });
    wrap(<CopyableJsonBlock value={{ authorization: `Bearer ${jwt}` }} data-testid="blk" />);
    expect(screen.getByTestId('blk-jwts')).toBeInTheDocument();
    // The first found token's decode button.
    fireEvent.click(screen.getByTestId('blk-jwt-0-button'));
    expect(screen.getByTestId('blk-jwt-0-result')).toBeInTheDocument();
  });

  it('renders no decode section when there is no JWT', () => {
    wrap(<CopyableJsonBlock value={{ hello: 'world' }} data-testid="blk2" />);
    expect(screen.queryByTestId('blk2-jwts')).toBeNull();
  });
});
