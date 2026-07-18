/**
 * endpoints.$endpointId.credentials.tsx - LEGACY redirect route.
 *
 * P5 - the Credentials tab was merged into the unified method-centric "Connect"
 * tab. This route now permanently redirects any deep-link to `/credentials`
 * onward to `/connect` so existing bookmarks + cross-links keep working.
 */
import { createRoute, redirect } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';

export const credentialsTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'credentials',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/endpoints/$endpointId/connect',
      params: { endpointId: params.endpointId },
    });
  },
});
