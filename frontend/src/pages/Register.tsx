import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UserPlus } from 'lucide-react';
import { useAuth } from '@/app/AuthProvider';
import { ApiError } from '@/lib/api';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import { NoticeBanner } from '@/components/ui/Feedback';

/**
 * Registration.
 *
 * The password rules mirror the server's policy (minimum length, mixed
 * characters, enough distinct characters) so the user is told before the request
 * rather than after it. The server remains the authority; this only saves a
 * round trip.
 */
const schema = z.object({
  full_name: z.string().trim().min(2, 'Enter your full name.').max(200),
  email: z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.'),
  organization_name: z
    .string()
    .trim()
    .min(2, 'Enter your organization name.')
    .max(200),
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .refine((value) => /[A-Za-z]/.test(value) && /[^A-Za-z]/.test(value), {
      message: 'Mix letters with digits or symbols.',
    })
    .refine((value) => new Set(value).size >= 5, {
      message: 'Use at least five distinct characters.',
    }),
});

type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  const { register: registerUser, status } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: '', email: '', organization_name: '', password: '' },
  });

  if (status === 'authenticated') {
    return <Navigate to="/overview" replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await registerUser({
        full_name: values.full_name,
        email: values.email,
        organization_name: values.organization_name,
        password: values.password,
      });
      navigate('/overview', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.detail);
        for (const [field, message] of Object.entries(error.fieldErrors ?? {})) {
          if (field in values) setError(field as keyof FormValues, { message });
        }
        return;
      }
      setFormError('Registration failed. Please try again.');
    }
  });

  return (
    <AuthLayout
      title="Create your organization"
      description="The first account becomes the organization administrator. Further members are invited from Settings."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="rounded text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        {formError ? <NoticeBanner tone="danger">{formError}</NoticeBanner> : null}

        <Field label="Full name" error={errors.full_name?.message} required>
          <Input
            {...register('full_name')}
            autoComplete="name"
            placeholder="Alex Morgan"
            invalid={Boolean(errors.full_name)}
          />
        </Field>

        <Field label="Work email" error={errors.email?.message} required>
          <Input
            {...register('email')}
            type="email"
            autoComplete="email"
            placeholder="alex@example.com"
            invalid={Boolean(errors.email)}
          />
        </Field>

        <Field
          label="Organization name"
          error={errors.organization_name?.message}
          hint="Shown on reports and used to scope every record."
          required
        >
          <Input
            {...register('organization_name')}
            autoComplete="organization"
            placeholder="Northwind Financial"
            invalid={Boolean(errors.organization_name)}
          />
        </Field>

        <Field
          label="Password"
          error={errors.password?.message}
          hint="At least 10 characters, mixing letters with digits or symbols."
          required
        >
          <Input
            {...register('password')}
            type="password"
            autoComplete="new-password"
            placeholder="••••••••••"
            invalid={Boolean(errors.password)}
          />
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full justify-center"
          loading={isSubmitting}
          icon={<UserPlus className="h-4 w-4" aria-hidden />}
        >
          Create organization
        </Button>

        <NoticeBanner tone="info" title="Self-registration">
          Open registration is disabled in production deployments. The first account may always be
          created so a new installation can be provisioned.
        </NoticeBanner>
      </form>
    </AuthLayout>
  );
}
