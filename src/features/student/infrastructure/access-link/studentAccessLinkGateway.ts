import { backendGet } from '@services/backendBridge';
import { parsePublicRegistrationForm } from '@/src/features/assessment-forms/api/assessmentForms';
import type { PublicStudentAccessLink } from '../../contracts/access-link/PublicStudentAccessLink';

export const studentAccessLinkGateway = {
  async load(linkId: string): Promise<PublicStudentAccessLink> {
    const link = await backendGet<PublicStudentAccessLink>(`/v1/public/access-links/${encodeURIComponent(linkId)}`, {
      retries: 0,
    });
    return { ...link, registrationForm: parsePublicRegistrationForm(link.registrationForm) };
  },
};
