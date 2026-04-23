# Screen Violation Clips (Google Drive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the student’s *entire monitor* during the exam, but only **retain/upload** short video clips around **medium+ violations**; upload clips to an **organization Google Drive** (server-side Drive API).

**Architecture:** The student browser requests screen-share permission once (user gesture), keeps a rolling in-memory buffer of recent video chunks, and when a violation occurs it flushes a pre/post clip to the backend. The backend spools the clip to disk and a background worker uploads it to Google Drive, then stores the Drive link on the existing `media_assets` table.

**Tech Stack:** Vite + React + Vitest (frontend), Axum + SQLx + Tokio (backend), Rust worker, Google Drive API (service account).

---

## File/Module Map (Lock boundaries before coding)

**Frontend**
- Modify: `src/types.ts` (add config fields under `ExamConfig.security`)
- Modify: `src/constants/examDefaults.ts` (default config)
- Modify: `src/components/student/providers/StudentRuntimeProvider.tsx` (allow caller-supplied violation id)
- Modify: `src/components/student/providers/StudentProctoringProvider.tsx` (generate UUID per violation, include it in audit payload, trigger clip capture for medium+)
- Modify: `src/components/student/StudentAppWrapper.tsx` (wrap providers)
- Modify: `src/components/student/PreCheck.tsx` (add “Start screen share” UX when enabled; warn/flag if skipped)
- Create: `src/components/student/providers/StudentScreenRecordingProvider.tsx` (screen capture + ring buffer + clip capture)
- Create: `src/services/studentScreenClipService.ts` (upload clip Blob to backend)
- Test: `src/components/student/__tests__/PreCheck.test.tsx` (precheck UX)
- Test: `src/components/student/providers/__tests__/StudentProctoringProvider.test.tsx` (violationId propagation + clip trigger)
- Test: `src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx` (optional: add_violation accepts id)

**Backend (API)**
- Modify: `backend/crates/api/src/routes/student.rs` (respect client `violationId` UUID for `VIOLATION_DETECTED`)
- Create: `backend/crates/api/src/routes/screen_clips.rs` (new endpoint to accept clip bytes for a violation)
- Modify: `backend/crates/api/src/routes/mod.rs` (export new route module)
- Modify: `backend/crates/api/src/router.rs` (add route)
- Modify: `backend/crates/infrastructure/src/config.rs` (Drive env vars)
- Create: `backend/crates/infrastructure/src/drive.rs` (Drive client: service account JWT + upload)
- Create: `backend/crates/infrastructure/src/local_spool.rs` (write/read/delete local spool files under `OBJECT_STORAGE_LOCAL_ROOT`)
- Modify: `backend/crates/infrastructure/src/lib.rs` (export new modules)
- Modify: `backend/crates/infrastructure/Cargo.toml` (add Drive deps; bump rust-version to match workspace)
- Test: `backend/tests/contracts/student_contract.rs` (violationId roundtrip + clip endpoint stores media_assets row)

**Backend (Worker)**
- Create: `backend/crates/worker/src/jobs/drive_uploads.rs` (upload pending violation clips to Drive)
- Modify: `backend/crates/worker/src/lib.rs` (export job)
- Modify: `backend/crates/worker/src/main.rs` (invoke job each cycle)
- (Optional) Test: `backend/crates/worker/tests/...` (unit test Drive uploader behind a trait; skip if too expensive)

**Config**
- Modify: `backend/.env.example` (add Drive env vars)

---

## Data Model (Use existing `media_assets`)

We will store each clip as a `media_assets` row:
- `owner_kind = 'student_violation_event'`
- `owner_id = <violation_id UUID string>`
- `content_type = 'video/webm'` (default; record the actual browser mime if different)
- `file_name = 'screen-clip-<scheduleId>-<attemptId>-<violationId>.webm'`
- `upload_status`:
  - `pending`: clip bytes exist locally, Drive upload not yet complete
  - `finalized`: Drive upload complete, `download_url` is a Drive view URL
- `object_key`:
  - while pending: `local:<absolute_or_relative_spool_path>`
  - after Drive upload: `drive:<drive_file_id>`
- `download_url`: set to a Drive link after upload

No schema migration required.

---

## HTTP API Contract

### Student → Backend: upload a violation clip

`POST /api/v1/student/sessions/:scheduleId/violations/:violationId/screen-clips`

Auth: Attempt bearer token (same as other student endpoints).

Headers:
- `Content-Type: video/webm` (or whatever the `MediaRecorder` produces)
- `X-Clip-File-Name: <optional>` (fallback: server generates)

Body: raw bytes (the clip Blob).

Response:
```json
{
  "success": true,
  "data": {
    "assetId": "uuid",
    "status": "pending"
  }
}
```

---

## Task 1: Add configurable screen-recording policy to exam config

**Files:**
- Modify: `src/types.ts`
- Modify: `src/constants/examDefaults.ts`
- (Optional UI) Modify: `src/features/builder/components/SecurityTab.tsx`

- [ ] **Step 1: Add types**

Add to `ExamConfig.security` in `src/types.ts`:
```ts
export type ScreenRecordingExpectedSurface = 'monitor' | 'any';
export type ScreenRecordingAction = 'warn' | 'block';

export interface ScreenRecordingPolicy {
  enabled: boolean;
  expectedSurface: ScreenRecordingExpectedSurface; // 'monitor' for entire screen
  onSurfaceMismatch: ScreenRecordingAction; // for "window/tab" selection
  onStopSharing: ScreenRecordingAction; // when track ends
  triggerSeverity: 'medium'; // hard-coded for this feature
  preRollSeconds: number;
  postRollSeconds: number;
  mergeWindowSeconds: number; // group repeated violations close together
  chunkMs: number; // MediaRecorder timeslice
  videoBitsPerSecond: number;
  maxClipsPerAttempt: number; // safety cap to prevent abuse
}
```

Then extend `ExamConfig.security`:
```ts
screenRecording?: ScreenRecordingPolicy | undefined;
```

- [ ] **Step 2: Add defaults**

In `src/constants/examDefaults.ts`, set defaults under `security`:
```ts
screenRecording: {
  enabled: false,
  expectedSurface: 'monitor',
  onSurfaceMismatch: 'warn',
  onStopSharing: 'warn',
  triggerSeverity: 'medium',
  preRollSeconds: 20,
  postRollSeconds: 20,
  mergeWindowSeconds: 30,
  chunkMs: 2000,
  videoBitsPerSecond: 800_000,
  maxClipsPerAttempt: 25,
},
```

- [ ] **Step 3: (Optional) Add builder UI controls**

If you add UI now, keep it minimal:
- checkbox: “Screen recording (violation clips)”
- number inputs: preRollSeconds / postRollSeconds
- select: expectedSurface (“Entire screen recommended”)
- select: actions for mismatch/stop (“Warn/Flag” vs “Block”)

Implement by editing `SecurityTab.tsx` similarly to how `proctoringFlags` toggles are handled:
```ts
updateConfig('security', { screenRecording: { ...config.security.screenRecording, enabled: true } })
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/constants/examDefaults.ts src/features/builder/components/SecurityTab.tsx
git commit -m "feat(security): add screen recording policy config"
```

---

## Task 2: Propagate stable `violationId` UUID end-to-end (frontend → backend)

**Files:**
- Modify: `src/components/student/providers/StudentRuntimeProvider.tsx`
- Modify: `src/components/student/providers/StudentProctoringProvider.tsx`
- Modify: `src/services/studentAuditService.ts`
- Test: `src/components/student/providers/__tests__/StudentProctoringProvider.test.tsx`
- Modify: `backend/crates/api/src/routes/student.rs`
- Test: `backend/tests/contracts/student_contract.rs`

- [ ] **Step 1: Make runtime accept a caller-supplied violation id**

In `StudentRuntimeProvider.tsx`, update the `addViolation` action signature:
```ts
addViolation: (type: string, severity: ViolationSeverity, description: string, id?: string) => void;
```

Update reducer case to use provided `id`:
```ts
const newViolation: Violation = {
  id: action.id ?? `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  ...
};
```

- [ ] **Step 2: Generate a UUID per violation and include it in the audit payload**

In `StudentProctoringProvider.tsx`, inside `handleViolation(...)`:
```ts
const violationId = typeof crypto?.randomUUID === 'function'
  ? crypto.randomUUID()
  : `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;

runtimeActions.addViolation(type, severity, message, violationId);
void saveStudentAuditEvent(scheduleId, 'VIOLATION_DETECTED', {
  violationId,
  severity,
  message,
  violationType: type,
}, attemptState.attemptId ?? undefined);
```

Also: when severity is `medium|high|critical` **and** `config.security.screenRecording?.enabled` is true, call the screen recording provider (added in Task 3):
```ts
if (severity !== 'low') {
  void screenRecording.captureViolationClip({ violationId, violationType: type, severity });
}
```

- [ ] **Step 3: Ensure `studentAuditService` doesn’t drop unknown keys**

No code change needed if payload is passed through; just ensure `violationId` is included as shown above.

- [ ] **Step 4: Backend: respect client-provided `violationId` when inserting `student_violation_events`**

In `backend/crates/api/src/routes/student.rs` `record_audit`:
- Read `violationId` from `payload_value.get("violationId")`
- If parseable as UUID, use it as `violation_id`; else generate as today.
- If the insert fails with duplicate primary key, **skip** snapshot update too (avoid duplicating).

Concrete code change (drop-in structure for the existing `if req.action_type == "VIOLATION_DETECTED" { ... }` block):
```rust
let violation_id = payload_value
    .get("violationId")
    .and_then(Value::as_str)
    .and_then(|raw| Uuid::parse_str(raw).ok())
    .unwrap_or_else(Uuid::new_v4);

let insert_result = sqlx::query(
    r#"
    INSERT INTO student_violation_events (
        id, schedule_id, attempt_id, violation_type, severity, description, payload, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    "#,
)
.bind(violation_id.to_string())
.bind(schedule_id.to_string())
.bind(&attempt_id)
.bind(&violation_type)
.bind(&severity)
.bind(&description)
.bind(payload_value.clone())
.execute(&state.db_pool())
.await;

match insert_result {
    Ok(_) => {
        let violation_json = json!({
            "id": violation_id,
            "type": violation_type,
            "severity": severity,
            "timestamp": client_timestamp.unwrap_or_else(Utc::now),
            "description": description
        });
        sqlx::query(
            r#"
            UPDATE student_attempts
            SET
                violations_snapshot = JSON_MERGE_PRESERVE(COALESCE(violations_snapshot, JSON_ARRAY()), ?),
                updated_at = NOW(),
                revision = revision + 1
            WHERE id = ? AND schedule_id = ?
            "#,
        )
        .bind(violation_json)
        .bind(&attempt_id)
        .bind(schedule_id.to_string())
        .execute(&state.db_pool())
        .await
        .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?;
    }
    Err(sqlx::Error::Database(db_err)) if db_err.code().as_deref() == Some("1062") => {
        // Duplicate violation id (likely retry). Do nothing (avoid double-snapshotting).
    }
    Err(err) => {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "DATABASE_ERROR",
            &err.to_string(),
        ));
    }
}
```

- [ ] **Step 5: Frontend test: ProctoringProvider includes `violationId` in audit payload**

In `StudentProctoringProvider.test.tsx`, stub `saveStudentAuditEvent` and assert payload contains `violationId` and that it is a UUID-like string.

Example test snippet:
```ts
import * as audit from '@services/studentAuditService';
vi.spyOn(audit, 'saveStudentAuditEvent').mockResolvedValue();

// trigger violation...
expect(audit.saveStudentAuditEvent).toHaveBeenCalledWith(
  expect.anything(),
  'VIOLATION_DETECTED',
  expect.objectContaining({ violationId: expect.stringMatching(/[0-9a-f-]{36}/i) }),
  expect.anything(),
);
```

- [ ] **Step 6: Backend contract test: `violationId` controls `student_violation_events.id`**

Add a new test near `student_audit_inserts_session_log_and_violation_event`:
```rust
let violation_id = Uuid::new_v4();
// send audit payload including violationId: violation_id.to_string()
let count: i64 = sqlx::query_scalar(
  "SELECT COUNT(*) FROM student_violation_events WHERE id = ?"
)
.bind(violation_id.to_string())
.fetch_one(database.pool())
.await
.unwrap();
assert_eq!(count, 1);
```

- [ ] **Step 7: Run tests**

Frontend: `npm run test:run`
Expected: PASS (at least the touched test files)

Backend: `cd backend && cargo test -q`
Expected: PASS (or run only `student_contract` if suite is large)

- [ ] **Step 8: Commit**

```bash
git add src/components/student/providers/StudentRuntimeProvider.tsx \
  src/components/student/providers/StudentProctoringProvider.tsx \
  src/services/studentAuditService.ts \
  src/components/student/providers/__tests__/StudentProctoringProvider.test.tsx \
  backend/crates/api/src/routes/student.rs \
  backend/tests/contracts/student_contract.rs
git commit -m "feat(proctoring): propagate violationId UUID to backend"
```

---

## Task 3: Implement rolling buffer screen recording + clip capture provider (frontend)

**Files:**
- Create: `src/components/student/providers/StudentScreenRecordingProvider.tsx`
- Modify: `src/components/student/StudentAppWrapper.tsx`
- Modify: `src/components/student/PreCheck.tsx`
- Create: `src/services/studentScreenClipService.ts`
- Test: `src/components/student/__tests__/PreCheck.test.tsx`

- [ ] **Step 1: Create `StudentScreenRecordingProvider` context**

Create `StudentScreenRecordingProvider.tsx`:
```tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { saveStudentAuditEvent } from '@services/studentAuditService';
import { uploadViolationScreenClip } from '@services/studentScreenClipService';
import type { ExamConfig } from '../../../types';
import { useStudentAttempt } from './StudentAttemptProvider';
import { useStudentRuntime } from './StudentRuntimeProvider';

export type ScreenClipRequest = {
  violationId: string;
  violationType: string;
  severity: 'medium' | 'high' | 'critical';
};

type ScreenRecordingState = {
  status: 'idle' | 'needs-permission' | 'capturing' | 'stopped' | 'error';
  lastError: string | null;
  surface: 'monitor' | 'window' | 'browser' | 'application' | 'unknown';
  clipCount: number;
};

type ScreenRecordingActions = {
  requestPermissionAndStart: () => Promise<void>;
  captureViolationClip: (req: ScreenClipRequest) => Promise<void>;
  stop: () => void;
};

type ScreenRecordingContextValue = {
  state: ScreenRecordingState;
  actions: ScreenRecordingActions;
};

const ScreenRecordingContext = createContext<ScreenRecordingContextValue | null>(null);

type ProviderProps = {
  children: ReactNode;
  config: ExamConfig;
  scheduleId?: string | undefined;
};

type BufferedChunk = { at: number; blob: Blob };
type ActiveClip = {
  violationId: string;
  until: number;
  chunks: Blob[];
};

function resolveDisplaySurface(track: MediaStreamTrack): ScreenRecordingState['surface'] {
  const settings = track.getSettings?.() as { displaySurface?: unknown } | undefined;
  const raw = settings?.displaySurface;
  if (raw === 'monitor' || raw === 'window' || raw === 'browser' || raw === 'application') {
    return raw;
  }
  return 'unknown';
}

export function StudentScreenRecordingProvider({ children, config, scheduleId }: ProviderProps) {
  const { state: runtimeState } = useStudentRuntime();
  const { state: attemptState } = useStudentAttempt();
  const policy = config.security.screenRecording;
  const enabled = Boolean(policy?.enabled) && Boolean(config.security.proctoringFlags.screen);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const bufferRef = useRef<BufferedChunk[]>([]);
  const activeRef = useRef<ActiveClip | null>(null);
  const finalizeTimerRef = useRef<number | null>(null);

  const [state, setState] = useState<ScreenRecordingState>({
    status: enabled ? 'needs-permission' : 'idle',
    lastError: null,
    surface: 'unknown',
    clipCount: 0,
  });

  const stop = useCallback(() => {
    if (finalizeTimerRef.current) {
      window.clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = null;
    }
    recorderRef.current?.stop?.();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    activeRef.current = null;
    bufferRef.current = [];
    setState((current) => ({
      ...current,
      status: enabled ? 'needs-permission' : 'idle',
      surface: 'unknown',
    }));
  }, [enabled]);

  const requestPermissionAndStart = useCallback(async () => {
    if (!enabled || !policy) {
      return;
    }
    if (!scheduleId || !attemptState.attemptId) {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 10,
          width: { ideal: 854 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      const surface = track ? resolveDisplaySurface(track) : 'unknown';
      setState((current) => ({ ...current, status: 'capturing', lastError: null, surface }));

      if (track) {
        track.onended = () => {
          setState((current) => ({ ...current, status: 'stopped' }));
          void saveStudentAuditEvent(
            scheduleId,
            'VIOLATION_DETECTED',
            {
              violationType: 'SCREEN_RECORDING_STOPPED',
              severity: 'medium',
              message: 'Screen sharing stopped during the exam.',
            },
            attemptState.attemptId ?? undefined,
          );
        };
      }

      const recorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp8,opus',
        videoBitsPerSecond: policy.videoBitsPerSecond,
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) {
          return;
        }
        const now = Date.now();
        bufferRef.current.push({ at: now, blob: event.data });
        const cutoff = now - policy.preRollSeconds * 1000;
        bufferRef.current = bufferRef.current.filter((entry) => entry.at >= cutoff);

        const active = activeRef.current;
        if (active) {
          active.chunks.push(event.data);
        }
      };

      recorder.start(policy.chunkMs);
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        lastError: error instanceof Error ? error.message : 'Screen capture failed',
      }));
    }
  }, [attemptState.attemptId, enabled, policy, scheduleId]);

  const captureViolationClip = useCallback(async (req: ScreenClipRequest) => {
    if (!enabled || !policy) return;
    if (!scheduleId || !attemptState.attemptId) return;
    if (state.clipCount >= policy.maxClipsPerAttempt) return;
    if (!recorderRef.current) return; // no permission/no recording yet; still flagged via audit elsewhere

    const now = Date.now();
    const mergeUntil = now + policy.mergeWindowSeconds * 1000;

    const active = activeRef.current;
    if (active && now < active.until) {
      active.until = Math.max(active.until, mergeUntil);
      return;
    }

    const preRoll = bufferRef.current.map((entry) => entry.blob);
    activeRef.current = {
      violationId: req.violationId,
      until: now + policy.postRollSeconds * 1000,
      chunks: [...preRoll],
    };
    setState((current) => ({ ...current, clipCount: current.clipCount + 1 }));

    const checkFinalize = async () => {
      const activeClip = activeRef.current;
      if (!activeClip) return;
      if (Date.now() < activeClip.until) {
        finalizeTimerRef.current = window.setTimeout(() => void checkFinalize(), 500);
        return;
      }
      activeRef.current = null;

      const mime = recorderRef.current?.mimeType || 'video/webm';
      const blob = new Blob(activeClip.chunks, { type: mime });
      await uploadViolationScreenClip({
        scheduleId,
        attemptId: attemptState.attemptId,
        violationId: activeClip.violationId,
        blob,
      });
    };

    finalizeTimerRef.current = window.setTimeout(() => void checkFinalize(), 500);
  }, [attemptState.attemptId, enabled, policy, scheduleId, state.clipCount]);

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }
    if (runtimeState.phase !== 'exam') {
      // Stop capture when leaving the exam phase to reduce risk of over-recording.
      stop();
    }
  }, [enabled, runtimeState.phase, stop]);

  const actions = useMemo<ScreenRecordingActions>(() => ({
    requestPermissionAndStart,
    captureViolationClip,
    stop,
  }), [captureViolationClip, requestPermissionAndStart, stop]);

  return (
    <ScreenRecordingContext.Provider value={{ state, actions }}>
      {children}
    </ScreenRecordingContext.Provider>
  );
}

export function useStudentScreenRecording() {
  const value = useContext(ScreenRecordingContext);
  if (!value) {
    throw new Error('useStudentScreenRecording must be used within StudentScreenRecordingProvider');
  }
  return value;
}
```

Implementation rules:
- Only run when `config.security.screenRecording?.enabled === true`
- Must require a **user gesture** for `getDisplayMedia` → expose `requestPermissionAndStart()` and call it from a button click (PreCheck / banner)
- Keep a ring buffer of `Blob` chunks:
  - configure `MediaRecorder` with `timeslice = policy.chunkMs` (default 2000ms)
  - on each `dataavailable`, push chunk and prune chunks older than `preRollSeconds`
- Detect surface mismatch:
  - read `track.getSettings().displaySurface` when available
  - if it’s not `'monitor'` and policy.expectedSurface is `'monitor'`, then:
    - log audit + (in Task 2) proctoring provider will also create a violation
    - do **not** block exam in this plan (action is warn/flag by default)
- Detect stop sharing:
  - `track.onended = () => { ... }` → mark status `stopped`

- [ ] **Step 2: Implement clip capture logic (merge window)**

When `captureViolationClip(...)` is called:
- Enforce `maxClipsPerAttempt`
- Merge behavior:
  - If a clip capture is already in progress and `now < activeClip.until`, extend `until = now + mergeWindowSeconds`
  - Otherwise start a new active clip:
    - snapshot ring buffer into `activeClip.chunks`
    - set `activeClip.until = now + postRollSeconds`
- While active clip exists, append every new chunk into `activeClip.chunks`
- When `now >= activeClip.until`, finalize:
```ts
const blob = new Blob(activeClip.chunks, { type: recorder.mimeType || 'video/webm' });
await uploadViolationScreenClip({ scheduleId, attemptId, violationId: activeClip.violationId, blob });
```

Important: because we merge, choose the **first** violationId that opened the clip as the owner. (Later enhancement: store an array of associated violationIds in payload.)

- [ ] **Step 3: Add upload service**

Create `src/services/studentScreenClipService.ts`:
```ts
import { tryBuildAttemptAuthorizationHeader } from './studentAttemptRepository';

export async function uploadViolationScreenClip(params: {
  scheduleId: string;
  attemptId: string;
  violationId: string;
  blob: Blob;
}): Promise<void> {
  const headers = tryBuildAttemptAuthorizationHeader(params.scheduleId, params.attemptId);
  if (!headers) return;

  await fetch(`/api/v1/student/sessions/${params.scheduleId}/violations/${params.violationId}/screen-clips`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      ...headers,
      'Content-Type': params.blob.type || 'video/webm',
    },
    body: params.blob,
  });
}
```

- [ ] **Step 4: Wire provider into student app**

Modify `src/components/student/StudentAppWrapper.tsx` to wrap `ProctoringProvider`:
```tsx
<StudentScreenRecordingProvider config={state.config} scheduleId={scheduleId}>
  <ProctoringProvider config={state.config} scheduleId={scheduleId}>
    ...
  </ProctoringProvider>
</StudentScreenRecordingProvider>
```

- [ ] **Step 5: Add PreCheck UI button (permission + instructions)**

In `PreCheck.tsx`, when `config.security.screenRecording?.enabled`:
- Render a section with:
  - “Start screen sharing (Entire screen)”
  - a button wired to `screenRecording.requestPermissionAndStart`
  - current status text (capturing / stopped / needs permission)
  - reminder that the student should pick “Entire screen”

If student continues without capturing:
- call `saveStudentAuditEvent(..., 'VIOLATION_DETECTED', { violationType: 'SCREEN_RECORDING_NOT_STARTED', severity: 'medium', message: ... })`
- (This will generate a violation and thus start capturing a clip if already permitted; if not permitted, it at least flags.)

- [ ] **Step 6: Test PreCheck renders the new controls**

In `PreCheck.test.tsx`:
- Provide a config with `security.screenRecording.enabled = true`
- Assert the button “Start screen sharing” is present.

Example:
```ts
expect(screen.getByRole('button', { name: /start screen sharing/i })).toBeInTheDocument();
```

- [ ] **Step 7: Run tests**

Run: `npm run test:run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/components/student/providers/StudentScreenRecordingProvider.tsx \
  src/components/student/StudentAppWrapper.tsx \
  src/components/student/PreCheck.tsx \
  src/services/studentScreenClipService.ts \
  src/components/student/__tests__/PreCheck.test.tsx
git commit -m "feat(student): capture screen clips on medium+ violations"
```

---

## Task 4: Backend endpoint to accept clip bytes and create a `media_assets` row

**Files:**
- Create: `backend/crates/api/src/routes/screen_clips.rs`
- Modify: `backend/crates/api/src/routes/mod.rs`
- Modify: `backend/crates/api/src/router.rs`
- Create: `backend/crates/infrastructure/src/local_spool.rs`
- Modify: `backend/crates/infrastructure/src/lib.rs`
- Modify: `backend/.env.example`
- Test: `backend/tests/contracts/student_contract.rs`

- [ ] **Step 1: Implement local spool helper**

Create `backend/crates/infrastructure/src/local_spool.rs`:
```rust
use std::{env, fs, path::{PathBuf}};
use uuid::Uuid;

pub fn spool_root() -> PathBuf {
    env::var("OBJECT_STORAGE_LOCAL_ROOT")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("./.data/object-store"))
}

pub fn clip_path(asset_id: Uuid) -> PathBuf {
    spool_root().join("proctoring").join("screen-clips").join(format!("{asset_id}.webm"))
}

pub fn write_clip(asset_id: Uuid, bytes: &[u8]) -> Result<PathBuf, std::io::Error> {
    let path = clip_path(asset_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, bytes)?;
    Ok(path)
}
```

Export it from `backend/crates/infrastructure/src/lib.rs`:
```rust
pub mod local_spool;
```

- [ ] **Step 2: Add Drive dependencies (and bump crate rust-version)**

In `backend/crates/infrastructure/Cargo.toml`, align `rust-version` with the workspace toolchain (the API crate already requires Rust 1.88):
```toml
rust-version = "1.88"
```

Then add dependencies:
```toml
reqwest = { version = "0.12.15", default-features = false, features = ["json", "multipart", "rustls-tls"] }
yup-oauth2 = "11.0.0"
thiserror = "2.0.16"
```

- [ ] **Step 2: Add Drive env vars to `.env.example`**

Append to `backend/.env.example`:
```env
# Google Drive (service account) for violation clip uploads
GOOGLE_DRIVE_ENABLED=false
GOOGLE_DRIVE_FOLDER_ID=
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON=
```

- [ ] **Step 3: Implement route `POST .../screen-clips`**

Create `backend/crates/api/src/routes/screen_clips.rs`:
- Extract `AttemptPrincipal` and ensure `scheduleId` matches claims (same pattern as other student routes)
- Read body as `bytes::Bytes`
- Insert `media_assets` row with:
  - id = new UUID
  - owner_kind = `student_violation_event`
  - owner_id = violationId string
  - content_type = request `Content-Type` header fallback `video/webm`
  - file_name = generated
  - upload_status = `pending`
  - object_key = `local:<path>`
  - upload_url = dummy (`"local"`) (required by schema)
  - size_bytes = bytes.len
  - delete_after_at = NOW() + 7 days (cleanup)
- Write clip bytes to disk using `local_spool::write_clip(asset_id, &bytes)`
- Return asset id

Concrete handler skeleton (compile-first; fill SQL + error mapping next):
```rust
use axum::{
    body::Bytes,
    extract::{Extension, Path, State},
    http::{header, HeaderMap, StatusCode},
};
use uuid::Uuid;

use crate::{
    http::{
        auth::AttemptPrincipal,
        request_id::RequestId,
        response::{ApiError, ApiResponse},
    },
    state::AppState,
};

pub async fn upload_violation_screen_clip(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    principal: AttemptPrincipal,
    headers: HeaderMap,
    Path((schedule_id, violation_id)): Path<(Uuid, Uuid)>,
    body: Bytes,
) -> Result<ApiResponse<serde_json::Value>, ApiError> {
    let attempt_id = principal.authorization.claims.attempt_id.clone();
    let claims_schedule_id = principal.authorization.claims.schedule_id.clone();

    if claims_schedule_id != schedule_id.to_string() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            "Attempt credential does not match the schedule.",
        ));
    }

    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("video/webm")
        .to_owned();

    let asset_id = Uuid::new_v4();
    let file_name = format!("screen-clip-{schedule_id}-{attempt_id}-{violation_id}.webm");

    let spool_path = ielts_backend_infrastructure::local_spool::write_clip(asset_id, &body)
        .map_err(|err| {
            ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "SPOOL_WRITE_FAILED",
                &err.to_string(),
            )
        })?;

    let object_key = format!("local:{}", spool_path.display());

    sqlx::query(
        r#"
        INSERT INTO media_assets (
            id, owner_kind, owner_id, content_type, file_name, upload_status,
            object_key, size_bytes, upload_url, delete_after_at, created_at, updated_at
        )
        VALUES (?, 'student_violation_event', ?, ?, ?, 'pending', ?, ?, 'local', NOW() + INTERVAL 7 DAY, NOW(), NOW())
        "#,
    )
    .bind(asset_id.to_string())
    .bind(violation_id.to_string())
    .bind(&content_type)
    .bind(&file_name)
    .bind(&object_key)
    .bind(i64::try_from(body.len()).unwrap_or(i64::MAX))
    .execute(&state.db_pool())
    .await
    .map_err(|err| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR", &err.to_string()))?;

    Ok(ApiResponse::success_with_request_id(
        serde_json::json!({ "assetId": asset_id, "status": "pending" }),
        request_id.0,
    ))
}
```

- [ ] **Step 4: Wire the route**

In `backend/crates/api/src/routes/mod.rs`:
```rust
pub mod screen_clips;
```

In `backend/crates/api/src/router.rs`, nest under `/api/v1/student`:
```rust
.route(
  "/api/v1/student/sessions/:schedule_id/violations/:violation_id/screen-clips",
  post(screen_clips::upload_violation_screen_clip),
)
```

- [ ] **Step 5: Contract test: uploading creates `media_assets`**

In `backend/tests/contracts/student_contract.rs` add:
- bootstrap attempt, obtain attempt token
- call the new endpoint with a small body:
```rust
let body = Body::from(vec![1u8, 2, 3, 4, 5]);
```
- assert `StatusCode::OK`
- query:
```sql
SELECT COUNT(*) FROM media_assets WHERE owner_kind='student_violation_event' AND owner_id=?
```

- [ ] **Step 6: Run backend tests**

Run: `cd backend && cargo test -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/crates/api/src/routes/screen_clips.rs \
  backend/crates/api/src/routes/mod.rs \
  backend/crates/api/src/router.rs \
  backend/crates/infrastructure/src/local_spool.rs \
  backend/crates/infrastructure/src/lib.rs \
  backend/.env.example \
  backend/tests/contracts/student_contract.rs
git commit -m "feat(api): accept violation screen clip uploads"
```

---

## Task 5: Implement Google Drive uploader (backend worker)

**Files:**
- Modify: `backend/crates/infrastructure/src/config.rs`
- Create: `backend/crates/infrastructure/src/drive.rs`
- Modify: `backend/crates/infrastructure/src/lib.rs`
- Create: `backend/crates/worker/src/jobs/drive_uploads.rs`
- Modify: `backend/crates/worker/src/lib.rs`
- Modify: `backend/crates/worker/src/main.rs`

- [ ] **Step 1: Add Drive config to `AppConfig`**

In `backend/crates/infrastructure/src/config.rs`, add fields:
```rust
pub google_drive_enabled: bool,
pub google_drive_folder_id: Option<String>,
pub google_drive_service_account_json: Option<String>,
```

Parse env vars:
```rust
google_drive_enabled: env::var("GOOGLE_DRIVE_ENABLED").ok().and_then(|v| parse_bool(&v)).unwrap_or(false),
google_drive_folder_id: env::var("GOOGLE_DRIVE_FOLDER_ID").ok().filter(|v| !v.trim().is_empty()),
google_drive_service_account_json: env::var("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON").ok().filter(|v| !v.trim().is_empty()),
```

- [ ] **Step 2: Implement minimal Drive client using service account**

Create `backend/crates/infrastructure/src/drive.rs`.

Important ops note: the Drive **folder must be shared** with the service account email, otherwise uploads will fail with 403.

Concrete implementation (multipart upload, good enough for small clips):
```rust
use std::{env, fs};

use reqwest::multipart;
use serde::Deserialize;
use thiserror::Error;
use yup_oauth2::{ServiceAccountAuthenticator, ServiceAccountKey};

const DRIVE_SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
const DRIVE_UPLOAD_URL: &str = "https://www.googleapis.com/upload/drive/v3/files";

#[derive(Debug, Error)]
pub enum DriveError {
    #[error("Drive auth missing")]
    MissingAuth,
    #[error("Drive auth parse failed: {0}")]
    AuthParse(String),
    #[error("Drive token failed: {0}")]
    Token(String),
    #[error("Drive upload failed: {0}")]
    Upload(String),
}

#[derive(Debug, Deserialize)]
struct DriveUploadResponse {
    id: String,
    #[serde(rename = "webViewLink")]
    web_view_link: Option<String>,
}

fn load_service_account_key() -> Result<ServiceAccountKey, DriveError> {
    let raw = env::var("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON")
        .map_err(|_| DriveError::MissingAuth)?;
    let json = if raw.trim_start().starts_with('{') {
        raw
    } else {
        fs::read_to_string(raw).map_err(|err| DriveError::AuthParse(err.to_string()))?
    };
    serde_json::from_str(&json).map_err(|err| DriveError::AuthParse(err.to_string()))
}

pub struct DriveClient {
    http: reqwest::Client,
    auth: ServiceAccountAuthenticator,
}

impl DriveClient {
    pub async fn from_env() -> Result<Self, DriveError> {
        let key = load_service_account_key()?;
        let auth = ServiceAccountAuthenticator::builder(key)
            .build()
            .await
            .map_err(|err| DriveError::Token(err.to_string()))?;
        Ok(Self {
            http: reqwest::Client::new(),
            auth,
        })
    }

    pub async fn upload(
        &self,
        folder_id: &str,
        file_name: &str,
        content_type: &str,
        bytes: Vec<u8>,
    ) -> Result<(String, String), DriveError> {
        let token = self
            .auth
            .token(&[DRIVE_SCOPE])
            .await
            .map_err(|err| DriveError::Token(err.to_string()))?;
        let access_token = token.as_str();

        let metadata = serde_json::json!({
            "name": file_name,
            "parents": [folder_id],
        })
        .to_string();

        let form = multipart::Form::new()
            .part(
                "metadata",
                multipart::Part::text(metadata)
                    .mime_str("application/json")
                    .map_err(|err| DriveError::Upload(err.to_string()))?,
            )
            .part(
                "file",
                multipart::Part::bytes(bytes)
                    .file_name(file_name.to_owned())
                    .mime_str(content_type)
                    .map_err(|err| DriveError::Upload(err.to_string()))?,
            );

        let res = self
            .http
            .post(format!("{DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,webViewLink"))
            .bearer_auth(access_token)
            .multipart(form)
            .send()
            .await
            .map_err(|err| DriveError::Upload(err.to_string()))?;

        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(DriveError::Upload(format!("{status}: {body}")));
        }

        let payload: DriveUploadResponse = res
            .json()
            .await
            .map_err(|err| DriveError::Upload(err.to_string()))?;

        let link = payload
            .web_view_link
            .unwrap_or_else(|| format!("https://drive.google.com/file/d/{}/view", payload.id));

        Ok((payload.id, link))
    }
}
```

- [ ] **Step 3: Worker job: find pending local clips and upload**

Create `backend/crates/worker/src/jobs/drive_uploads.rs`:
- If `GOOGLE_DRIVE_ENABLED` is false, exit early.
- Query:
```sql
SELECT id, owner_id, content_type, file_name, object_key
FROM media_assets
WHERE owner_kind='student_violation_event'
  AND upload_status='pending'
ORDER BY created_at ASC
LIMIT 25
```
- For each row:
  - parse `object_key` expecting `local:<path>`
  - read bytes from disk
  - upload to Drive folder (from config or from per-exam config later)
  - update row:
```sql
UPDATE media_assets
SET upload_status='finalized',
    object_key=?,
    download_url=?,
    updated_at=NOW()
WHERE id=?
```
  - delete local file

Return a report struct `{ uploaded: u64, failed: u64, duration_ms: u64 }` and log with tracing.

Concrete job skeleton (keep Drive failures non-fatal; only DB failures should return `Err`):
```rust
use std::time::Instant;

use ielts_backend_infrastructure::{config::AppConfig, drive::DriveClient};
use sqlx::MySqlPool;
use sqlx::Row;
use uuid::Uuid;

const BATCH_LIMIT: i64 = 25;

#[derive(Debug, Clone, Copy, Default)]
pub struct DriveUploadReport {
    pub uploaded: u64,
    pub failed: u64,
    pub duration_ms: u64,
}

#[tracing::instrument(skip(pool, config))]
pub async fn run_once(pool: MySqlPool, config: AppConfig) -> Result<DriveUploadReport, sqlx::Error> {
    let started = Instant::now();
    if !config.google_drive_enabled {
        return Ok(DriveUploadReport::default());
    }
    let Some(folder_id) = config.google_drive_folder_id.clone() else {
        tracing::warn!("GOOGLE_DRIVE_FOLDER_ID not set; skipping");
        return Ok(DriveUploadReport::default());
    };

    let drive = match DriveClient::from_env().await {
        Ok(client) => client,
        Err(err) => {
            tracing::warn!(error = %err, "Drive client init failed; skipping");
            return Ok(DriveUploadReport::default());
        }
    };

    let rows = sqlx::query(
        r#"
        SELECT id, content_type, file_name, object_key
        FROM media_assets
        WHERE owner_kind='student_violation_event'
          AND upload_status='pending'
        ORDER BY created_at ASC
        LIMIT ?
        "#,
    )
    .bind(BATCH_LIMIT)
    .fetch_all(&pool)
    .await?;

    let mut report = DriveUploadReport::default();

    for row in rows {
        let id_raw: String = row.get("id");
        let content_type: String = row.get("content_type");
        let file_name: String = row.get("file_name");
        let object_key: String = row.get("object_key");

        let Ok(asset_id) = Uuid::parse_str(&id_raw) else {
            report.failed += 1;
            continue;
        };

        let Some(local_path) = object_key.strip_prefix("local:") else {
            report.failed += 1;
            continue;
        };

        let bytes = match tokio::fs::read(local_path).await {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!(asset_id = %asset_id, error = %err, "Failed to read local clip");
                report.failed += 1;
                continue;
            }
        };

        let (drive_id, drive_link) = match drive.upload(&folder_id, &file_name, &content_type, bytes).await {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!(asset_id = %asset_id, error = %err, "Drive upload failed");
                report.failed += 1;
                continue;
            }
        };

        sqlx::query(
            r#"
            UPDATE media_assets
            SET upload_status='finalized',
                object_key=?,
                download_url=?,
                updated_at=NOW()
            WHERE id=?
            "#,
        )
        .bind(format!("drive:{drive_id}"))
        .bind(&drive_link)
        .bind(asset_id.to_string())
        .execute(&pool)
        .await?;

        let _ = tokio::fs::remove_file(local_path).await;
        report.uploaded += 1;
    }

    report.duration_ms = started.elapsed().as_millis() as u64;
    Ok(report)
}
```

- [ ] **Step 4: Wire job into worker main loop**

In `backend/crates/worker/src/lib.rs`:
```rust
pub mod jobs {
  ...
  pub mod drive_uploads;
}
```

In `backend/crates/worker/src/main.rs` call it in `run_outbox_cycle` and `run_maintenance_cycle`:
```rust
let drive = jobs::drive_uploads::run_once(pool.clone(), config.clone()).await?;
```
and include it in tracing log fields.

- [ ] **Step 5: Build + test**

Run: `cd backend && cargo test -q`
Expected: PASS

Run: `cd backend && cargo build -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/crates/infrastructure/src/config.rs \
  backend/crates/infrastructure/src/drive.rs \
  backend/crates/infrastructure/src/lib.rs \
  backend/crates/worker/src/jobs/drive_uploads.rs \
  backend/crates/worker/src/lib.rs \
  backend/crates/worker/src/main.rs
git commit -m "feat(worker): upload violation clips to Google Drive"
```

---

## Task 6 (Optional but recommended): Show Drive links in the proctor UI

This can be a follow-up plan if you want to keep scope small. Minimal approach:
- Add `GET /api/v1/proctor/violations/:violationId/media` returning `media_assets` rows where `owner_kind='student_violation_event'` and `owner_id=:violationId`.
- In proctor dashboard UI, render a “View clip” link next to a violation after fetching it lazily.

---

## Manual Verification Checklist (non-test)

- Start frontend `npm run dev` and backend (API + worker).
- Configure an exam with:
  - `security.screenRecording.enabled=true`
  - `expectedSurface='monitor'`
  - `onSurfaceMismatch='warn'`
- Student enters PreCheck:
  - Click “Start screen sharing” → select **Entire screen** → status shows capturing.
  - Trigger a violation (tab switch) → after ~postRoll seconds, backend receives a clip upload.
- Worker uploads to Drive:
  - `media_assets.download_url` becomes a Drive link.
  - Local spool file is deleted.
