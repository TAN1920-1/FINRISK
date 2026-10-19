import { Link, useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { useAuth } from '@/app/AuthProvider';

/** Shown for any authenticated URL that does not match a route. */
export function NotFoundPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  return (
    <div className="card">
      <EmptyState
        icon={<Compass className="h-5 w-5" aria-hidden />}
        title="That page does not exist"
        description="The link may be out of date, or the record it pointed at has been removed."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => navigate(-1)}>
              Go back
            </Button>
            <Link
              to={isAuthenticated ? '/overview' : '/login'}
              className="inline-flex h-9 items-center rounded bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              {isAuthenticated ? 'Open the overview' : 'Sign in'}
            </Link>
          </div>
        }
      />
    </div>
  );
}
