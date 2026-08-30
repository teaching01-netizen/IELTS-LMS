import { useQuery } from '@tanstack/react-query';
import { studentAccessLinkGateway } from '../../infrastructure/access-link/studentAccessLinkGateway';

export const studentAccessLinkKeys = {
  public: (linkId: string) => ['student-access-link', linkId] as const,
};

export function useStudentAccessLink(linkId: string | undefined) {
  return useQuery({
    queryKey: studentAccessLinkKeys.public(linkId ?? 'missing'),
    queryFn: () => studentAccessLinkGateway.load(linkId ?? ''),
    enabled: Boolean(linkId),
    retry: false,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}
