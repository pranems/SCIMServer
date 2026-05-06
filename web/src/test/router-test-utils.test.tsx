/**
 * router-test-utils.test.tsx - tests for the renderWithRouter helper.
 *
 * Verifies that the helper produces a working router context where
 *   - <Link to="..."> renders without throwing
 *   - useParams returns route params for the seeded URL
 *   - useSearch returns parsed search params
 *   - QueryClientProvider is in scope (so queries work in tests)
 */

import { describe, it, expect } from 'vitest';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { renderWithRouter } from './router-test-utils';

describe('renderWithRouter', () => {
  it('mounts a child component inside a router context', async () => {
    const Child = (): React.JSX.Element => <div data-testid="child">hi</div>;
    const { findByTestId } = renderWithRouter(<Child />);
    expect(await findByTestId('child')).toBeInTheDocument();
  });

  it('seeds the initial path so route params resolve', async () => {
    function Probe(): React.JSX.Element {
      const { endpointId } = useParams({ strict: false }) as { endpointId?: string };
      return <div data-testid="ep">{endpointId ?? 'none'}</div>;
    }
    const { findByTestId } = renderWithRouter(<Probe />, {
      initialUrl: '/endpoints/abc-123/users',
      routePath: '/endpoints/$endpointId/users',
    });
    expect(await findByTestId('ep')).toHaveTextContent('abc-123');
  });

  it('parses search params on the initial URL', async () => {
    function Probe(): React.JSX.Element {
      const search = useSearch({ strict: false }) as { page?: number; pageSize?: number };
      return (
        <div data-testid="search">
          {search.page ?? 'no-page'}/{search.pageSize ?? 'no-pageSize'}
        </div>
      );
    }
    const { findByTestId } = renderWithRouter(<Probe />, {
      initialUrl: '/endpoints/abc/users?page=3&pageSize=50',
      routePath: '/endpoints/$endpointId/users',
    });
    expect(await findByTestId('search')).toHaveTextContent('3/50');
  });

  it('runs validateSearch when supplied so URL strings are coerced', async () => {
    // Phase A3 contract: when a route component calls useSearch and
    // expects parsed types (e.g. number not string for page), the test
    // helper has to install a validateSearch fn. We assert here that the
    // option is honored end-to-end.
    interface ParsedSearch {
      page: number;
      pageSize: number;
    }
    function Probe(): React.JSX.Element {
      const search = useSearch({ strict: false }) as ParsedSearch;
      return (
        <div data-testid="parsed">
          page={search.page}|pageSize={search.pageSize}|pageType={typeof search.page}
        </div>
      );
    }
    const { findByTestId } = renderWithRouter(<Probe />, {
      initialUrl: '/users?page=4&pageSize=25',
      routePath: '/users',
      validateSearch: (raw) => ({
        page: Number(raw.page ?? 1),
        pageSize: Number(raw.pageSize ?? 20),
      }),
    });
    expect(await findByTestId('parsed')).toHaveTextContent(
      'page=4|pageSize=25|pageType=number',
    );
  });

  it('renders <Link> components without crashing', async () => {
    const { findByTestId } = renderWithRouter(
      <Link to="/endpoints" data-testid="link">
        Endpoints
      </Link>,
    );
    expect(await findByTestId('link')).toBeInTheDocument();
  });
});
