import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { LoadingSurface } from '@components/ui';
import { resolvePostLoginPath, useAuthSession } from './authSession';
import { loginFormSchema } from './validation/authForms';

/**
 * Shown instead of the staff form when the signed-in (or just-signed-in)
 * account is a student. Students take exams via check-in, not the staff
 * workspace, and /login is their role landing — navigating there would
 * self-loop (S3-C1).
 */
export function StudentCheckInGuidance() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white border border-border rounded-lg shadow-lg p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900 mb-2 tracking-tight">Student check-in</h1>
            <p className="text-sm text-gray-500">
              Student accounts check in with your exam code — open the check-in URL
              from your proctor, or use the access link below.
            </p>
          </div>
          <div className="space-y-3">
            <Link
              to="/join"
              className="block w-full text-center bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600/40 focus:ring-offset-2"
            >
              I have an access link
            </Link>
            <p className="text-center text-sm text-gray-500">
              Checking in with an exam code? Open the check-in URL from your proctor
              (it looks like <span className="font-mono">/student/…</span>).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login, session, status } = useAuthSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [studentGuidance, setStudentGuidance] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isMountedRef = useRef(true);
  const inFlightRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const nextPath = searchParams.get('next');

  if (status === 'loading') {
    return <LoadingSurface label="Loading Session..." />;
  }

  // Student accounts have no staff workspace: never bounce them to /login
  // (self-loop, S3-C1). Show check-in guidance and stay on the page.
  if (session && session.user.role === 'student') {
    return <StudentCheckInGuidance />;
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
    // Dedupe double-submits (double-click, keyboard repeat, StrictMode).
    if (isSubmitting || inFlightRef.current) {
      return;
    }
    const parsed = loginFormSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email and password.');
      return;
    }
    inFlightRef.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      const nextSession = await login(parsed.data.email, parsed.data.password);
      if (!isMountedRef.current) {
        return;
      }
      if (nextSession.user.role === 'student') {
        // No staff landing exists for students; /login IS the student landing
        // path, so navigating would self-loop. Show guidance instead.
        setStudentGuidance(true);
        return;
      }
      navigate(
        resolvePostLoginPath(nextSession.user.role, nextPath),
        { replace: true },
      );
    } catch (loginError) {
      if (isMountedRef.current) {
        setError(loginError instanceof Error ? loginError.message : 'Sign-in failed.');
      }
    } finally {
      inFlightRef.current = false;
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  if (studentGuidance) {
    return <StudentCheckInGuidance />;
  }

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
                className="w-full px-3 py-2 border border-gray-200 rounded-md shadow-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600/25 focus:border-blue-600"
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
                className="w-full px-3 py-2 border border-gray-200 rounded-md shadow-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600/25 focus:border-blue-600"
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
              <Link to="/password/reset" className="font-medium text-blue-700 hover:text-blue-800">
                Forgot password?
              </Link>
              <span className="text-gray-300">|</span>
              <Link to="/activate" className="font-medium text-blue-700 hover:text-blue-800">
                Activate account
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
