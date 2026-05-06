/**
 * endpoints.tsx - endpoints list route at "/endpoints".
 *
 * Mounts EndpointsPage with optional search-query support via the
 * endpointsSearchSchema from search-schemas.ts. Phase A3 will wire the
 * search query to client-side filtering inside EndpointsPage.
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
