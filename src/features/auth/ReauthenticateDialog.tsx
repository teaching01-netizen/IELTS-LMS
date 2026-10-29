import { useEffect, useId, useState } from 'react';
import { Button, Dialog } from '@components/ui';
import type { AuthSession } from './api/authGateway';

interface ReauthenticateDialogProps {
  isOpen: boolean;
  email: string;
  onConfirm: (password: string) => Promise<AuthSession>;
  onClose: () => void;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as Record<string, unknown>;
  const value = record['status'] ?? record['statusCode'];
  return typeof value === 'number' ? value : undefined;
}

function confirmationError(error: unknown): string {
  const status = statusOf(error);
  const code =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (status === 401 && code === 'SESSION_EXPIRED') return 'Your session has ended. Sign in again.';
  if (status === 401) return 'That password is incorrect.';
  if (status === 429) return 'Too many attempts. Wait a moment, then try again.';
  return 'We couldn’t confirm your password. Check your connection and try again.';
}

/**
 * Password confirmation for sensitive actions (403 REAUTH_REQUIRED). Opens over
 * the current screen so unsaved work stays mounted. It never replays the
 * blocked action: the user repeats it after confirming.
 */
export function ReauthenticateDialog({ isOpen, email, onConfirm, onClose }: ReauthenticateDialogProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const passwordId = useId();
  const errorId = useId();

  useEffect(() => {
    if (!isOpen) {
      // Never keep a password around between openings.
      setPassword('');
      setError(null);
      setSubmitting(false);
      setConfirmed(false);
    }
  }, [isOpen]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(password);
      setConfirmed(true);
    } catch (confirmError) {
      setError(confirmationError(confirmError));
    } finally {
      setPassword('');
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={confirmed ? 'Password confirmed' : 'Confirm your password'}
      size="sm"
      preventCloseOnOverlayClick
      closeOnEscape={!submitting}
    >
      {confirmed ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-700" role="status">
            Your password is confirmed. Repeat the action you were doing.
          </p>
          <div className="flex justify-end">
            <Button type="button" onClick={onClose}>
              Continue
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-sm text-gray-600">
            This action needs your password again
            {email ? (
              <>
                {' '}for <span className="font-medium text-gray-900">{email}</span>
              </>
            ) : null}
            .
          </p>
          <div>
            <label htmlFor={passwordId} className="mb-1.5 block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              disabled={submitting}
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-gray-900 shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/25"
            />
            {error ? (
              <p id={errorId} role="alert" className="mt-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Confirming…' : 'Confirm'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
