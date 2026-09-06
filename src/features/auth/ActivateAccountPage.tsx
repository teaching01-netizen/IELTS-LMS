import React, { useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { LoadingSurface } from '@components/ui';
import { resolvePostLoginPath, resolveRoleLandingPath, useAuthSession } from './authSession';
import { activationFormSchema } from './validation/authForms';

function readToken(searchParams: URLSearchParams) {
  return searchParams.get('token') ?? '';
}

export function ActivateAccountPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { activateAccount, session, status } = useAuthSession();
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const token = useMemo(() => readToken(searchParams), [searchParams]);
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
    const parsed = activationFormSchema.safeParse({
      token,
      password,
      confirmPassword,
      displayName,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }

    inFlightRef.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      const nextSession = await activateAccount(parsed.data.token, parsed.data.password, parsed.data.displayName || undefined);
      navigate(resolvePostLoginPath(nextSession.user.role), { replace: true });
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Account activation failed.',
      );
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white/95 p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-slate-900">Activate Account</h1>
          <p className="mt-2 text-sm text-slate-600">
            Finish account setup and create your password.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="display-name" className="mb-2 block text-sm font-medium text-slate-700">
              Display Name
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your full name"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label htmlFor="activation-password" className="mb-2 block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="activation-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              placeholder="Create a password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label htmlFor="activation-confirm-password" className="mb-2 block text-sm font-medium text-slate-700">
              Confirm Password
            </label>
            <input
              id="activation-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              placeholder="Confirm your password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 shadow-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Activating...' : 'Activate Account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already activated? <Link to="/login" className="font-medium text-blue-700 hover:text-blue-800">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
