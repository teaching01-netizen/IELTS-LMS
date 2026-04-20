import fs from 'node:fs';
import path from 'node:path';

export const GENERATED_DIR = path.resolve(process.cwd(), 'e2e/.generated');
export const MANIFEST_PATH = path.join(GENERATED_DIR, 'backend-e2e-manifest.json');
export const BUILDER_STORAGE_STATE_PATH = path.join(
  GENERATED_DIR,
  'builder.storage-state.json',
);
export const STUDENT_STORAGE_STATE_PATH = path.join(
  GENERATED_DIR,
  'student.storage-state.json',
);
export const UNREGISTERED_STUDENT_STORAGE_STATE_PATH = path.join(
  GENERATED_DIR,
  'unregistered-student.storage-state.json',
);
export const ADMIN_STORAGE_STATE_PATH = path.join(
  GENERATED_DIR,
  'admin.storage-state.json',
);

export interface BackendE2EManifest {
  frontendOrigin: string;
  generatedAt: string;
  builder: {
    examId: string;
    examSlug: string;
    draftVersionId: string;
    initialRevision: number;
    initialVersionCount: number;
    storageStatePath: string;
  };
  student: {
    examId: string;
    examSlug: string;
    publishedVersionId: string;
    scheduleId: string;
    candidateId: string;
    questionId: string;
    expectedAnswer: string;
    storageStatePath: string;
  };
  studentSelfPaced: {
    examId: string;
    examSlug: string;
    publishedVersionId: string;
    scheduleId: string;
  };
  unregisteredStudent: {
    email: string;
    password: string;
    candidateId: string;
    storageStatePath: string;
  };
  auth: {
    adminLifecycle: {
      email: string;
      activationToken: string;
      activationPassword: string;
      passwordResetToken: string;
      passwordResetPassword: string;
    };
  };
}

export function readBackendE2EManifest(): BackendE2EManifest {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw) as BackendE2EManifest;
}
