import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/queryClient';
import { AuthProvider } from './AuthProvider';
import { ThemeProvider } from './ThemeProvider';
import { ToastProvider } from './ToastProvider';

/**
 * Provider order matters:
 *
 * 1. `ThemeProvider` first so the very first paint already carries the right
 *    colour scheme.
 * 2. `QueryClientProvider` next: the auth provider uses the shared client to
 *    invalidate cached data when the organization changes.
 * 3. `ToastProvider` before `AuthProvider`, so a failure during session
 *    hydration can still be surfaced.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
