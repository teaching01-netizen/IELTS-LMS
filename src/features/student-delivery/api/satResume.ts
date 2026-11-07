export { resumeSatStudentSession } from "../infrastructure/satStudentResume";
export type { SatResumeResult } from "../infrastructure/satStudentResume";
export {
  clearSatResumeLocator,
  loadSatResumeLocator,
  matchesSatResumeLocator,
  saveSatResumeLocator,
} from "../infrastructure/satResumeLocator";
export type { SatResumeLocatorV1 } from "../infrastructure/satResumeLocator";

export const SAT_RESUME_RECOVERY_COPY = {
  expired: { title: 'Exam access expired', description: 'Ask your proctor to restore access to your existing attempt. Your exam deadline has not changed.' },
  revoked: { title: 'Exam access needs recovery', description: 'This browser no longer has exam access. Ask your proctor to restore your existing attempt.' },
  ownership: { title: 'Another browser owns this exam', description: 'Continue in your active browser, or ask your proctor to transfer this attempt. Reconnecting will not replace the active browser.' },
};
