import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { ExamSessionRuntime } from "../../../types/domain";
import {
  SatBlockingOverlay,
  SatControlBanner,
  SatLeaseConflictNotice,
  SatTimeoutOverlay,
} from "../../../features/student-delivery/ui/feedback/SatControlFeedback";
import { SatIntegrityWarning } from "../../../features/student-delivery/ui/feedback/SatIntegrityWarning";
import { SatSaveStatus } from "../../../features/student-delivery/ui/feedback/SatSaveStatus";
import { SatRoomNotices } from "../../../products/sat/ui/SatRoomNotices";
import { SatRoomEntryPanel } from "../../../products/sat/ui/room/SatRoomEntryPanel";
import { SatSessionContextBar } from "../../../products/sat/ui/SatSessionContextBar";

/**
 * Dev-only gallery of every SAT banner, used by e2e/sat-banners.spec.ts to
 * capture review screenshots. Not reachable in production: the route is
 * registered only under `import.meta.env.DEV`.
 *
 * `?only=integrity|paused|timeout` renders one full-screen notice so the
 * screenshot is not covered by another overlay.
 */
export function SatBannerGalleryRoute() {
  const [params] = useSearchParams();
  const only = params.get("only");
  if (only === "integrity") return <SatIntegrityWarning open onContinue={() => undefined} />;
  if (only === "paused") return <SatBlockingOverlay note="Your proctor paused this exam to check your device." />;
  if (only === "timeout") {
    return (
      <SatTimeoutOverlay
        saveFailureKind={null}
        saveFailure={null}
        onRetrySave={() => undefined}
        onRetryClose={() => undefined}
      />
    );
  }

  return (
    <div className="sat-product min-h-screen bg-[var(--sat-staff-canvas,#f7f7f8)] px-6 py-8 text-[var(--sat-staff-text-primary,#1d1d1f)]">
      <main className="mx-auto w-full max-w-[920px] space-y-8">
        <header>
          <h1 className="text-[24px] font-semibold tracking-tight">SAT banner gallery</h1>
          <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
            Dev-only. Each notice is captured by e2e/sat-banners.spec.ts.
          </p>
        </header>

        <section className="sat-ui space-y-6 rounded-[14px] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))] bg-[var(--sat-surface,#fff)] p-5">
          <SectionHeading title="Student exam notices" note="Module + review notice row, below the timer." />
          <Row id="student-proctor-warning" title="Proctor message — warning">
            <SatControlBanner tone="warning" onDismiss={() => undefined}>
              Proctor message: Please keep your eyes on your own screen.
            </SatControlBanner>
          </Row>
          <Row id="student-exam-error" title="Exam error — error">
            <SatControlBanner tone="error" onDismiss={() => undefined}>
              Your answers could not be confirmed. Keep this screen open and retry the save.
            </SatControlBanner>
          </Row>
          <Row id="student-unsynced-warning" title="Unsynced answers — slow">
            <SatControlBanner tone="warning" testId="sat-unsynced-notice" onDismiss={() => undefined}>
              Still saving your last answers — keep this screen open.
            </SatControlBanner>
          </Row>
          <Row id="student-unsynced-offline" title="Unsynced answers — offline">
            <SatControlBanner tone="warning" testId="sat-unsynced-notice" onDismiss={() => undefined}>
              Your last answers are only on this device. Reconnect to send them.
            </SatControlBanner>
          </Row>
          <Row id="student-lease-conflict" title="Opened on another device — action + dismiss">
            <SatLeaseConflictNotice
              error="Save ownership changed to another browser."
              isTakingOver={false}
              onTakeOver={() => undefined}
              onDismiss={() => undefined}
            />
          </Row>
          <Row id="student-save-failed" title="Save failed — retry + dismiss">
            <SatSaveStatus state="failed" saveFailure="The last save did not reach the exam." onRetrySave={() => undefined} />
          </Row>
          <Row id="student-save-superseded" title="Superseded — take over + dismiss">
            <SatSaveStatus state="superseded" onTakeOver={() => undefined} />
          </Row>
        </section>

        <section className="space-y-6 rounded-[14px] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))] bg-[var(--sat-staff-surface,#fff)] p-5">
          <SectionHeading title="Staff room notices" note="The room's notice strip: creation, stale data, action results." />
          <Row id="staff-room-created" title="Room created">
            <SatRoomNotices
              createdRoom
              isStale={false}
              message={null}
              onRetry={() => undefined}
              onDismissCreation={() => undefined}
            />
          </Row>
          <Row id="staff-stale-data" title="Data may be out of date — retry + dismiss">
            <SatRoomNotices
              createdRoom={false}
              isStale
              staleKey="Network unavailable"
              message={null}
              onRetry={() => undefined}
              onDismissCreation={() => undefined}
            />
          </Row>
          <Row id="staff-action-error" title="Action failed — dismiss">
            <SatRoomNotices
              createdRoom={false}
              isStale={false}
              message={{ kind: "error", text: "Could not add 5 minutes. Retry to confirm the room state." }}
              onRetry={() => undefined}
              onDismissCreation={() => undefined}
            />
          </Row>
          <Row id="staff-action-success" title="Action succeeded — dismiss">
            <SatRoomNotices
              createdRoom={false}
              isStale={false}
              message={{ kind: "success", text: "Added 5 minutes to Reading & Writing." }}
              onRetry={() => undefined}
              onDismissCreation={() => undefined}
            />
          </Row>
        </section>

        <section className="space-y-6 rounded-[14px] border border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.08))] bg-[var(--sat-staff-surface,#fff)] p-5">
          <SectionHeading title="Staff room warnings" note="Context bar and inline warnings." />
          <Row id="staff-overrun" title="Overrun">
            <SatSessionContextBar
              runtime={mockRuntime}
              scheduledStartAt="2026-10-31T02:00:00.000Z"
              joinedCount={24}
              activeCount={22}
              readyCount={null}
              attentionCount={2}
              openAlerts={1}
              isStale={false}
              lastUpdatedLabel="09:42:10 ICT"
              onNeedsAttention={() => undefined}
            />
          </Row>
          <Row id="staff-reconnecting" title="Stale data — Reconnecting">
            <SatSessionContextBar
              runtime={mockReconnectingRuntime}
              scheduledStartAt="2026-10-31T02:00:00.000Z"
              joinedCount={24}
              activeCount={22}
              readyCount={null}
              attentionCount={2}
              openAlerts={1}
              isStale
              lastUpdatedLabel="09:42:10 ICT"
              onNeedsAttention={() => undefined}
            />
          </Row>
          <Row id="staff-entry-load-error" title="Student joining details failed">
            <SatRoomEntryPanel
              entryUrl={null}
              cohortName="Morning cohort"
              status="error"
              identificationInstructions=""
              startInstructions=""
              onRetry={() => undefined}
              onOpenShare={() => undefined}
              onPresent={() => undefined}
            />
          </Row>
        </section>
      </main>
    </div>
  );
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <h2 className="text-[18px] font-semibold leading-6 tracking-[-0.01em]">{title}</h2>
      <p className="mt-0.5 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{note}</p>
    </div>
  );
}

function Row({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-[var(--sat-staff-text-tertiary,#6e6e73)]">{title}</h3>
      <div data-banner-id={id}>{children}</div>
    </div>
  );
}

const mockRuntime = {
  id: "runtime-1",
  scheduleId: "schedule-1",
  status: "live",
  revision: 7,
  actualStartAt: "2026-10-31T02:00:00.000Z",
  actualEndAt: null,
  isOverrun: true,
} as unknown as ExamSessionRuntime;

const mockReconnectingRuntime = {
  ...mockRuntime,
  isOverrun: false,
} as ExamSessionRuntime;
