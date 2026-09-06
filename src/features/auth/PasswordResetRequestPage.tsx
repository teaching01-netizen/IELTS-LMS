import React, { useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { LoadingSurface } from '@components/ui';
import { resolveRoleLandingPath, useAuthSession } from './authSession';
import { passwordResetRequestFormSchema } from './validation/authForms';

export function PasswordResetRequestPage() {
  const { requestPasswordReset, session, status } = useAuthSession();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inFlightRef = useRef(false);

  if (status === 'loading') {
    return <LoadingSurface label="Loading Session..." />;
  }

  if (session) {
    return <Navigate to={resolveRoleLandingPath(session.user.role)} replace />;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || inFlightRef.current) {
      return;
    }
    const parsed = passwordResetRequestFormSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address.');
      return;
    }
    inFlightRef.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      await requestPasswordReset(parsed.data.email);
      setIsSubmitted(true);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Password reset request failed.',
      );
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-emerald-50 to-cyan-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white/95 p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-slate-900">Reset Password</h1>
          <p className="mt-2 text-sm text-slate-600">
            Request a one-time reset link for your account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="reset-email" className="mb-2 block text-sm font-medium text-slate-700">
              Email Address
            </label>
            <input
              id="reset-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              placeholder="you@example.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          {isSubmitted ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              If that email exists, a reset link can now be delivered using the backend token flow.
            </p>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Requesting...' : 'Request Reset Link'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          <Link to="/login" className="font-medium text-emerald-700 hover:text-emerald-800">
            Return to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
