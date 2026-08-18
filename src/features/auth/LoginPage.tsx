import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { LoadingSurface } from '@components/ui';
import { resolvePostLoginPath, useAuthSession } from './authSession';

export function LoginPage() {
  const { login, session, status } = useAuthSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const nextPath = searchParams.get('next');

  if (status === 'loading') {
    return <LoadingSurface label="Loading Session..." />;
  }

  if (session) {
    return (
      <Navigate
        to={resolvePostLoginPath(session.user.role, nextPath)}
        replace
      />
    );
  }

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const nextSession = await login(email, password);
      navigate(
        resolvePostLoginPath(nextSession.user.role, nextPath),
        { replace: true },
      );
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Sign-in failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white border border-border rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2 tracking-tight">IELTS Proctoring System</h1>
            <p className="text-sm text-gray-500">Sign in to access your dashboard</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full px-3 py-2 border border-gray-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600/25 focus:border-blue-600"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full px-3 py-2 border border-gray-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600/25 focus:border-blue-600"
              />
            </div>

            {error ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600/40 focus:ring-offset-2 transition duration-150 ease-in-out"
            >
              {isSubmitting ? 'Signing In...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 space-y-2 text-center">
            <p className="text-xs text-gray-400">
              Use a provisioned staff or student account. Cookie session and CSRF headers are established after sign-in.
            </p>
            <div className="flex items-center justify-center gap-3 text-sm">
              <Link to="/password/reset" className="font-medium text-blue-600 hover:text-blue-700">
                Forgot password?
              </Link>
              <span className="text-gray-300">|</span>
              <Link to="/activate" className="font-medium text-blue-600 hover:text-blue-700">
                Activate account
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
