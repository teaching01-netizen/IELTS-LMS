export type StudentAutoSaveStatus =
  | 'saved'
  | 'saved_locally'
  | 'saving'
  | 'syncing'
  | 'offline'
  | 'needs_recovery'
  | 'error';

export interface StudentSaveStatusPresentation {
  /** Full wording; what assistive tech announces. */
  label: string;
  /** Narrow-header wording: always a prefix of `label`, so a compact header
   * can show it and append the rest visually hidden. */
  shortLabel: string;
  tone: 'success' | 'neutral' | 'warning' | 'danger';
}

/**
 * The one mapping from the runtime's attempt sync state to student-facing
 * save copy, shared by every header so wording cannot drift. "Saved" is shown
 * only for the runtime's acknowledged `saved` state. `offline` is raised on
 * network loss whether or not edits are pending, so its copy states the
 * pause rather than claiming pending changes.
 */
export function getStudentSaveStatusPresentation(
  status: StudentAutoSaveStatus,
): StudentSaveStatusPresentation {
  switch (status) {
    case 'saving':
      return { label: 'Saving…', shortLabel: 'Saving…', tone: 'neutral' };
    case 'syncing':
      return { label: 'Syncing…', shortLabel: 'Syncing…', tone: 'neutral' };
    case 'saved_locally':
      return {
        label: 'Saved on this device · awaiting server',
        shortLabel: 'Saved on device',
        tone: 'warning',
      };
    case 'offline':
      return { label: 'Offline · saving paused', shortLabel: 'Offline', tone: 'warning' };
    case 'needs_recovery':
      return {
        label: 'Needs recovery · work kept on this device',
        shortLabel: 'Needs recovery',
        tone: 'danger',
      };
    case 'error':
      return { label: 'Not saved · retrying', shortLabel: 'Not saved', tone: 'danger' };
    case 'saved':
      return { label: 'Saved', shortLabel: 'Saved', tone: 'success' };
  }
}

/**
 * Compact chip wording for the IELTS shared-timetable room, where a local
 * marker must never read as a submission receipt. One owner with the header
 * mapping so wording cannot drift.
 */
export function getStudentSaveStatusChipLabel(status: StudentAutoSaveStatus): string {
  switch (status) {
    case 'saving':
      return 'Saving…';
    case 'syncing':
      return 'Syncing…';
    case 'saved_locally':
      return 'Saved on this device';
    case 'offline':
      return 'Offline · saved on this device';
    case 'needs_recovery':
      return 'Needs review · kept on this device';
    case 'error':
      return 'Not saved · retrying';
    case 'saved':
      return 'Saved to server';
  }
}
