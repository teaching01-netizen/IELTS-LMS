import { useQuery } from '@tanstack/react-query';
import { studentAccessLinkGateway } from '../../infrastructure/access-link/studentAccessLinkGateway';
import { entryQueueDelayMs, parseEntryQueueError } from '../../infrastructure/studentEntryGateway';

export const studentAccessLinkKeys = {
  public: (linkId: string) => ['student-access-link', linkId] as const,
};

const MAX_QUEUED_RETRIES = 5;

// A 429 while a whole room checks in means "wait", not "broken link": retry
// at the server's Retry-After floor. Any other error surfaces immediately.
export function retryAccessLinkWhileQueued(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_QUEUED_RETRIES && parseEntryQueueError(error).queued;
}

export function accessLinkRetryDelayMs(_failureCount: number, error: unknown): number {
  return entryQueueDelayMs(parseEntryQueueError(error).retryAfterSecs);
}

export function useStudentAccessLink(linkId: string | undefined) {
  return useQuery({
    queryKey: studentAccessLinkKeys.public(linkId ?? 'missing'),
    queryFn: () => studentAccessLinkGateway.load(linkId ?? ''),
    enabled: Boolean(linkId),
    retry: retryAccessLinkWhileQueued,
    retryDelay: accessLinkRetryDelayMs,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}
