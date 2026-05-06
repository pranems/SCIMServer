/**
 * endpoints.tsx - endpoints list route at "/endpoints".
 *
 * Mounts EndpointsPage with `q` search support via
 * endpointsSearchSchema. EndpointsPage reads `q` from useSearch and
 * updates via useNavigate (Phase A3).
 */
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { EndpointsPage } from '../pages/EndpointsPage';
import { endpointsSearchSchema } from './search-schemas';

export const endpointsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/endpoints',
  component: EndpointsPage,
  validateSearch: endpointsSearchSchema,
});
