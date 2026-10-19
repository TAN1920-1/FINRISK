import { RouterProvider } from 'react-router-dom';
import { AppProviders } from '@/app/providers';
import { router } from '@/app/router';

/**
 * Application root.
 *
 * Providers are mounted above the router so that every route - including the
 * sign-in screens - can read the theme, raise a toast and reach the session.
 */
export default function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
