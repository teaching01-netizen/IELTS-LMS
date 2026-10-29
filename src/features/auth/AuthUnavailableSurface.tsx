import { ErrorSurface } from '@components/ui';
import { useAuthSession } from './authSession';

/**
 * Shown instead of a login redirect when the session could not be checked
 * (cold transient failure) or a logout is still being confirmed. Retry reuses
 * the provider's single recovery owner.
 */
export function AuthUnavailableSurface() {
  const { status, pendingLogout, refresh } = useAuthSession();
  if (status === 'logoutPending') {
    const everywhere = pendingLogout?.scope === 'all';
    return (
      <ErrorSurface
        title={pendingLogout?.failed ? 'Sign-out not confirmed yet' : 'Signing out…'}
        description={
          pendingLogout?.durable === false
            ? 'Your data is hidden, but this browser could not save the sign-out request. Keep this tab open and reconnect to finish signing out; closing it may restore your sign-in.'
            : pendingLogout?.failed
            ? everywhere
              ? 'We couldn’t reach the server to sign you out everywhere. Your data is hidden on this device, and we’ll keep retrying.'
              : 'We couldn’t reach the server to finish signing out. Your data is hidden on this device, and we’ll keep retrying.'
            : 'Your data is hidden while we finish signing you out.'
        }
        {...(pendingLogout?.failed ? { actionLabel: 'Retry now', onAction: () => void refresh() } : {})}
      />
    );
  }
  return (
    <ErrorSurface
      title="Can’t reach the server"
      description="We couldn’t check your sign-in. You may still be signed in; we’ll retry automatically."
      actionLabel="Retry now"
      onAction={() => void refresh()}
    />
  );
}
