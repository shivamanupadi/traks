import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';

// Same-origin: /api/auth/* is served by the API worker (zone route in prod,
// vite proxy in dev), so the default baseURL (current origin) is correct.
export const authClient = createAuthClient({
  plugins: [organizationClient()],
});
