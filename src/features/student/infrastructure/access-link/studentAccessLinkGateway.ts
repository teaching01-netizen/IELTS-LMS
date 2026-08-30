import { backendGet } from '@services/backendBridge';
import type { PublicStudentAccessLink } from '../../contracts/access-link/PublicStudentAccessLink';

export const studentAccessLinkGateway = {
  load(linkId: string): Promise<PublicStudentAccessLink> {
    return backendGet<PublicStudentAccessLink>(`/v1/public/access-links/${encodeURIComponent(linkId)}`, {
      retries: 0,
    });
  },
};
