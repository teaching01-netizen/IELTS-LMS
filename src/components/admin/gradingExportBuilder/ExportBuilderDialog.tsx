import React, { useEffect, useMemo, useState } from 'react';
import { Download, Save } from 'lucide-react';

import type { GradingSession, StudentSubmission } from '../../../types/grading';
import { gradingRepository } from '../../../services/gradingRepository';
import { Button, Dialog, Input, Select } from '@components/ui';
import { downloadBinaryFile } from '../gradingReviewUtils';
import {
  createPerStudentZipPdfExport,
  type PerStudentZipPdfExportSection,
} from '../gradingPerStudentExport';
import {
  buildPerStudentZipPdfExportInput,
} from '../buildPerStudentZipPdfExportInput';
import {
  buildExportPlan,
  createDefaultExportProfile,
  createExportStudentRecord,
  filterExportStudents,
  type ExportPlan,
  type ExportProfile,
  type ExportStudentRecord,
} from './exportPlan';
import {
  createSavedExportProfile,
  loadAvailableExportProfiles,
  persistExportProfile,
} from './profileStorage';
import { exportBuilderDeps } from './exportBuilderDependencies';
import { ExportBuilderFilters } from './ExportBuilderFilters';
import { ExportBuilderPreview } from './ExportBuilderPreview';
import { ExportBuilderStudents } from './ExportBuilderStudents';
import { ExportBuilderStructure } from './ExportBuilderStructure';

export interface ExportBuilderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  session: GradingSession | null;
}

const DEFAULT_PROFILE = createDefaultExportProfile();

export function ExportBuilderDialog({
  isOpen,
  onClose,
  sessionId,
  session,
}: ExportBuilderDialogProps) {
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<StudentSubmission[]>([]);
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<readonly ExportProfile[]>([DEFAULT_PROFILE]);
  const [profile, setProfile] = useState<ExportProfile>(DEFAULT_PROFILE);
  const [selectedProfileId, setSelectedProfileId] = useState(DEFAULT_PROFILE.id);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [exporting, setExporting] = useState(false);
  const [generatedAt, setGeneratedAt] = useState(() => new Date());

  const records = useMemo<readonly ExportStudentRecord[]>(
    () => submissions.map((submission) => createExportStudentRecord(submission, session?.examTitle ?? 'Grading export')),
    [session?.examTitle, submissions],
  );
  const matchingRecords = useMemo(
    () => filterExportStudents(records, profile.filters),
    [profile.filters, records],
  );
  const plan = useMemo<ExportPlan>(() => buildExportPlan({
    session: {
      sessionId,
      examTitle: session?.examTitle ?? 'Grading export',
    },
    students: records,
    selectedSubmissionIds,
    profile,
    generatedAt,
  }), [generatedAt, profile, records, selectedSubmissionIds, session?.examTitle, sessionId]);

  useEffect(() => {
    if (!isOpen) return;
    setDialogError(null);
    setDialogLoading(true);
    setGeneratedAt(new Date());
    setSelectedSubmissionIds([]);
    setProfiles([DEFAULT_PROFILE]);
    setProfile(DEFAULT_PROFILE);
    setSelectedProfileId(DEFAULT_PROFILE.id);

    let cancelled = false;
    loadAvailableExportProfiles()
      .then((availableProfiles) => {
        if (!cancelled) setProfiles(availableProfiles);
      })
      .catch((error) => {
        if (!cancelled) setDialogError(error instanceof Error ? error.message : 'Failed to load export presets.');
      });
    gradingRepository
      .getSubmissionsBySession(sessionId)
      .then((fullSubmissions) => {
        if (cancelled) return;
        setSubmissions(fullSubmissions);
        setSelectedSubmissionIds(fullSubmissions.map((submission) => submission.id));
      })
      .catch((error) => {
        if (cancelled) return;
        setDialogError(error instanceof Error ? error.message : 'Failed to load students for export.');
      })
      .finally(() => {
        if (cancelled) return;
        setDialogLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, sessionId]);

  const closeDialog = () => {
    if (exporting) return;
    setDialogError(null);
    onClose();
  };

  const updateProfile = (nextProfile: ExportProfile) => {
    setProfile(nextProfile);
  };

  const selectProfile = (profileId: string) => {
    const nextProfile = profiles.find((candidate) => candidate.id === profileId);
    if (!nextProfile) return;
    setSelectedProfileId(profileId);
    setProfile(nextProfile);
    setSelectedSubmissionIds(
      filterExportStudents(records, nextProfile.filters).map((record) => record.identity.submissionId),
    );
  };

  const saveProfile = async () => {
    if (!profileName.trim()) {
      setDialogError('Enter a name before saving this export preset.');
      return;
    }
    const saved = createSavedExportProfile(profileName, profile);
    try {
      const persisted = await persistExportProfile(saved);
      const nextProfiles = await loadAvailableExportProfiles();
      setProfiles(nextProfiles);
      setSelectedProfileId(persisted.id);
      setProfile(persisted);
      setProfileName('');
      setSaveAsOpen(false);
      setDialogError(null);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : 'Failed to save export preset.');
    }
  };

  const toggleSelected = (submissionId: string) => {
    setSelectedSubmissionIds((current) => current.includes(submissionId)
      ? current.filter((id) => id !== submissionId)
      : [...current, submissionId]);
  };

  const runExport = async () => {
    setDialogError(null);
    if (profile.sections.length === 0) {
      setDialogError('Select at least one PDF section.');
      return;
    }
    if (plan.selectedCount === 0) {
      setDialogError('Select at least one matching student.');
      return;
    }

    setExporting(true);
    try {
      const fullSession = session ?? (await gradingRepository.getSessionById(sessionId));
      if (!fullSession) throw new Error('Could not load grading session metadata.');
      const selectedSubmissions = submissions.filter((submission) =>
        plan.students.some((student) => student.submissionId === submission.id),
      );
      const exportInput = await buildPerStudentZipPdfExportInput(
        {
          session: fullSession,
          selectedSections: [...profile.sections] as PerStudentZipPdfExportSection[],
          pdfMode: profile.pdfMode,
          pdfFilenameTemplate: profile.filenameTemplate,
          selectedSubmissions,
          generatedAt,
          exportPlan: plan,
        },
        exportBuilderDeps,
      );
      const exportPayload = await createPerStudentZipPdfExport(exportInput);
      downloadBinaryFile(exportPayload.filename, exportPayload.bytes, exportPayload.contentType);
      onClose();
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : 'Failed to export per-student PDFs.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={closeDialog}
      title="Export Builder"
      preventCloseOnOverlayClick={exporting}
      closeOnEscape={!exporting}
      size="full"
      className="!max-w-6xl"
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={closeDialog} disabled={exporting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void runExport()}
            disabled={exporting || dialogLoading || plan.selectedCount === 0 || profile.sections.length === 0}
            isLoading={exporting}
            leftIcon={!exporting ? <Download size={15} /> : undefined}
          >
            {exporting ? 'Building ZIP…' : 'Export ZIP'}
          </Button>
        </>
      )}
    >
      {dialogError ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
          {dialogError}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
        <Select
          label="Preset"
          value={selectedProfileId}
          options={profiles.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
          onChange={(event) => selectProfile(event.target.value)}
          disabled={exporting}
          className="min-w-64"
        />
        {saveAsOpen ? (
          <div className="flex flex-1 items-end gap-2 sm:max-w-md">
            <Input
              label="Preset name"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="e.g. Warwick by course and level"
              disabled={exporting}
              fullWidth
            />
            <Button type="button" size="sm" onClick={() => void saveProfile()} disabled={exporting}>Save</Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSaveAsOpen(true)}
            disabled={exporting}
            leftIcon={<Save size={14} />}
          >
            Save as preset
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600" aria-live="polite">
        <span><strong className="text-gray-900">{matchingRecords.length}</strong> students match</span>
        <span><strong className="text-gray-900">{plan.selectedCount}</strong> selected for export</span>
        <span><strong className="text-gray-900">{plan.pdfCount}</strong> PDFs</span>
        <span><strong className="text-gray-900">{plan.folderCount}</strong> folders</span>
      </div>

      {dialogLoading ? (
        <div className="rounded-md border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-500">
          Loading students…
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(15rem,0.9fr)_minmax(20rem,1.25fr)_minmax(22rem,1.15fr)]">
          <div className="rounded-md border border-gray-200 bg-white p-4">
            <ExportBuilderFilters
              records={records}
              filters={profile.filters}
              disabled={exporting}
              onChange={(filters) => updateProfile({ ...profile, filters })}
            />
          </div>
          <div className="rounded-md border border-gray-200 bg-white p-4">
            <ExportBuilderStudents
              matchingRecords={matchingRecords}
              selectedSubmissionIds={selectedSubmissionIds}
              disabled={exporting}
              onToggle={toggleSelected}
              onSelectAll={() => setSelectedSubmissionIds((current) => [
                ...new Set([...current, ...matchingRecords.map((record) => record.identity.submissionId)]),
              ])}
              onClear={() => setSelectedSubmissionIds([])}
            />
          </div>
          <div className="space-y-4">
            <div className="rounded-md border border-gray-200 bg-white p-4">
              <ExportBuilderStructure
                profile={profile}
                records={records}
                disabled={exporting}
                onChange={updateProfile}
              />
            </div>
            <div className="rounded-md border border-gray-200 bg-white p-4">
              <ExportBuilderPreview plan={plan} />
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
