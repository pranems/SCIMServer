/**
 * endpoints.tsx - endpoints list route at "/endpoints".
 *
 * Mounts EndpointsPage with `q` search support via
 * endpointsSearchSchema. EndpointsPage reads `q` from useSearch and
 * updates via useNavigate (Phase A3).
 *
 * Phase A4: loader pre-fetches the endpoint list so the card grid is
 * already populated when the user clicks Endpoints in the sidebar.
 */
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { EndpointsPage } from '../pages/EndpointsPage';
import { endpointsSearchSchema } from './search-schemas';
import { endpointsQueryOptions } from '../api/queries';

export const endpointsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/endpoints',
  component: EndpointsPage,
  validateSearch: endpointsSearchSchema,
  loader: ({ context }) => context.queryClient.ensureQueryData(endpointsQueryOptions()),
});
