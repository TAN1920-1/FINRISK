import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LogIn } from 'lucide-react';
import { useAuth } from '@/app/AuthProvider';
import { ApiError } from '@/lib/api';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import { NoticeBanner } from '@/components/ui/Feedback';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

type FormValues = z.infer<typeof schema>;

/**
 * Sign-in screen.
 *
 * The server's message is shown verbatim (it distinguishes a wrong password from
 * a locked-out limiter), and a field-level rejection is bound back to the input
 * that caused it rather than shown as a generic error.
 */
export function LoginPage() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  if (status === 'authenticated') {
    return <Navigate to="/overview" replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values.email, values.password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/overview', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.detail);
        for (const [field, message] of Object.entries(error.fieldErrors ?? {})) {
          if (field === 'email' || field === 'password') setError(field, { message });
        }
        return;
      }
      setFormError('Sign-in failed. Please try again.');
    }
  });

  return (
    <AuthLayout
      title="Sign in"
      description="Access your organization's risk register, exposure model and audit trail."
      footer={
        <>
          No account yet?{' '}
          <Link to="/register" className="rounded text-primary hover:underline">
            Create an organization
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {formError ? <NoticeBanner tone="danger">{formError}</NoticeBanner> : null}

        <Field label="Email address" error={errors.email?.message} required>
          <Input
            {...register('email')}
            type="email"
            autoComplete="email"
            placeholder="analyst@example.com"
            invalid={Boolean(errors.email)}
          />
        </Field>

        <Field label="Password" error={errors.password?.message} required>
          <Input
            {...register('password')}
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            invalid={Boolean(errors.password)}
          />
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full justify-center"
          loading={isSubmitting}
          icon={<LogIn className="h-4 w-4" aria-hidden />}
        >
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
