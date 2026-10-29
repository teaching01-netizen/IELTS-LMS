import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { Dialog } from "../../../components/ui/Dialog";
import { Button } from "../../../components/ui/Button";
import { Input } from "../../../components/ui/Input";
import { Select } from "../../../components/ui/Select";
import { useAsyncPolling } from "../../../shared/hooks/useAsyncPolling";
import { useAuthoritativeDeadlineClock } from "../../../shared/hooks/useAuthoritativeDeadlineClock";
import { usePageVisible } from "../../../shared/hooks/usePageVisible";
import { useQrCodeDataUrl } from "../../../shared/hooks/useQrCodeDataUrl";
import {
  parseRecoveryAward,
  recoveryClock,
  recoveryErrorCopy,
  recoveryErrorReason,
  recoveryGateway,
  recoveryGrantStateLabel,
  recoveryTargetKey,
  type RecoveryGrantState,
  type RecoveryIssued,
  type RecoveryOptions,
} from "../../student/api/deviceRecovery";

type IssueRequest = Parameters<typeof recoveryGateway.issue>[2];
type Pending = "idle" | "issuing" | "restoring";

const POLL_MS = 5_000;
const DIALOG_TITLE = "ย้ายเครื่อง / ให้ทำต่อ";
// Once Continue commits or staff restore, nothing here can change on its own.
const settledStates = new Set<RecoveryGrantState>(["started", "restored"]);

function awardValidation(value: string): string | null {
  try {
    parseRecoveryAward(value);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "เวลาไม่ถูกต้อง";
  }
}

export function DeviceRecoveryDialog({
  scheduleId,
  attemptId,
  isOpen,
  onClose,
}: {
  scheduleId: string;
  attemptId: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={DIALOG_TITLE} size="lg">
      {/* Mounted only while open: closing discards every draft and timer. */}
      {isOpen && (
        <DeviceRecoveryPanel
          key={`${scheduleId}:${attemptId}`}
          scheduleId={scheduleId}
          attemptId={attemptId}
        />
      )}
    </Dialog>
  );
}

function DeviceRecoveryPanel({ scheduleId, attemptId }: { scheduleId: string; attemptId: string }) {
  const id = useId();
  const visible = usePageVisible();
  const [options, setOptions] = useState<RecoveryOptions | null>(null);
  const [targetKey, setTargetKey] = useState("");
  const [award, setAward] = useState("");
  // "resume": continue exactly where the student is, on the original clock.
  // "adjust": staff explicitly choose the section and/or a new time allowance.
  const [mode, setMode] = useState<"resume" | "adjust">("resume");
  const [issued, setIssued] = useState<RecoveryIssued | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>("idle");
  const [feedback, setFeedback] = useState("");
  // Retained across an ambiguous failure so a retry replays the same operation.
  const pendingIssue = useRef<IssueRequest | null>(null);
  const restoreOperation = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await recoveryGateway.options(scheduleId, attemptId);
    setOptions(next);
    if (next.issuance) setIssued(next.issuance);
    setTargetKey((current) => {
      if (current) return current;
      const initial =
        next.targets.find((stage) => stage.current && stage.eligibility.eligible) ??
        next.targets.find((stage) => stage.eligibility.eligible);
      return initial ? recoveryTargetKey(initial) : "";
    });
  }, [scheduleId, attemptId]);

  const grant = options?.grant ?? issued?.grant;
  const settled = grant !== undefined && settledStates.has(grant.state);
  useAsyncPolling(
    async () => {
      try {
        await refresh();
      } catch (err) {
        setError(recoveryErrorCopy(err, "โหลดสถานะไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ"));
        throw err; // lets the poller back off
      }
    },
    { enabled: visible && !settled, intervalMs: POLL_MS, maxIntervalMs: POLL_MS * 6 }
  );

  const target = options?.targets.find((stage) => recoveryTargetKey(stage) === targetKey);
  const remaining = useAuthoritativeDeadlineClock({
    deadlineAt: target?.originalDeadlineAt ?? null,
    serverNow: options?.serverNow ?? null,
    fallbackSeconds: 0,
    running: !!target?.originalDeadlineAt,
  });
  const awardError = award.trim() ? awardValidation(award) : null;
  const liveIssued =
    issued && grant?.grantId === issued.grant.grantId && grant.state === "issued" ? issued : null;
  const link = liveIssued?.recoveryPath
    ? new URL(liveIssued.recoveryPath, window.location.origin).href
    : null;
  const qr = useQrCodeDataUrl(link, 480);
  const busy = pending !== "idle";
  // The issued QR/code sits below the form; reveal it once per new grant.
  const issuedPanel = useRef<HTMLElement>(null);
  const revealedGrant = useRef<string | null>(null);
  useEffect(() => {
    if (!liveIssued || revealedGrant.current === liveIssued.grant.grantId) return;
    revealedGrant.current = liveIssued.grant.grantId;
    issuedPanel.current?.scrollIntoView({ block: "nearest" });
    issuedPanel.current?.focus({ preventScroll: true });
  }, [liveIssued]);

  // A stale epoch can never succeed on retry: drop the operation and reload.
  const recoverFrom = async (err: unknown, fallback: string, drop: () => void) => {
    setError(recoveryErrorCopy(err, fallback));
    if (recoveryErrorReason(err) === "RECOVERY_STALE") {
      drop();
      await refresh().catch(() => undefined);
    }
  };

  const issue = async () => {
    if (!options || !target || busy || !options.issuanceEnabled || awardError) return;
    setError(null);
    setFeedback("");
    setPending("issuing");
    try {
      if (!pendingIssue.current) {
        const remainingSeconds = parseRecoveryAward(award);
        pendingIssue.current = {
          operationId: crypto.randomUUID(),
          expectedLeaseEpoch: options.leaseEpoch,
          expectedControlEpoch: options.controlEpoch,
          target: {
            sectionKey: target.sectionKey,
            ...(target.moduleId
              ? { moduleId: target.moduleId, moduleAttemptId: target.moduleAttemptId }
              : {}),
          },
          ...(remainingSeconds === undefined ? {} : { remainingSeconds }),
        };
      }
      const result = await recoveryGateway.issue(scheduleId, attemptId, pendingIssue.current);
      pendingIssue.current = null;
      setIssued(result);
      await refresh();
    } catch (err) {
      await recoverFrom(err, "สร้างรหัสไม่สำเร็จ กดอีกครั้งเพื่อลองคำขอเดิม", () => {
        pendingIssue.current = null;
      });
    } finally {
      setPending("idle");
    }
  };

  const restore = async () => {
    if (!options || busy) return;
    setError(null);
    setFeedback("");
    setPending("restoring");
    restoreOperation.current ??= crypto.randomUUID();
    try {
      const result = await recoveryGateway.restore(scheduleId, attemptId, {
        operationId: restoreOperation.current,
        expectedLeaseEpoch: options.leaseEpoch,
        expectedControlEpoch: options.controlEpoch,
      });
      restoreOperation.current = null;
      setOptions(result);
      setIssued(null);
      setFeedback("รอให้เครื่องเดิมกดทำข้อสอบต่อ");
    } catch (err) {
      await recoverFrom(err, "คืนสิทธิ์ไม่สำเร็จ กดอีกครั้งเพื่อลองคำขอเดิม", () => {
        restoreOperation.current = null;
      });
    } finally {
      setPending("idle");
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setFeedback("คัดลอกลิงก์แล้ว");
    } catch {
      setError("คัดลอกไม่สำเร็จ เลือกและคัดลอกลิงก์ด้านล่าง");
    }
  };

  // Edits change the decision, so they also discard any pending retry.
  const editDecision = (apply: () => void) => {
    apply();
    pendingIssue.current = null;
  };

  if (!options) {
    return (
      <div className="space-y-3">
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : (
          <p role="status" className="text-sm text-gray-600">
            กำลังโหลด…
          </p>
        )}
      </div>
    );
  }

  const countdownUrgent = !!target?.originalDeadlineAt && remaining <= 60;
  const currentStage = options.targets.find((stage) => stage.current);
  const clock = (
    // Deliberately not a live region: a per-second tick must not be announced.
    <span
      className={`font-semibold tabular-nums ${countdownUrgent ? "text-red-700" : "text-gray-900"}`}
    >
      {target?.originalDeadlineAt ? recoveryClock(remaining) : "—"}
    </span>
  );
  const chooseMode = (next: "resume" | "adjust") =>
    editDecision(() => {
      setMode(next);
      if (next === "resume") {
        setAward("");
        const initial =
          currentStage?.eligibility.eligible
            ? currentStage
            : options.targets.find((stage) => stage.eligibility.eligible);
        setTargetKey(initial ? recoveryTargetKey(initial) : "");
      }
    });
  const modeOption = (value: "resume" | "adjust", title: string, hint: string) => (
    <label
      htmlFor={`${id}-mode-${value}`}
      className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${mode === value ? "border-blue-600 bg-blue-50" : "border-gray-200"}`}
    >
      <input
        id={`${id}-mode-${value}`}
        type="radio"
        aria-label={title}
        name={`${id}-mode`}
        className="mt-1"
        checked={mode === value}
        disabled={busy}
        onChange={() => chooseMode(value)}
      />
      <span>
        <span className="block font-semibold text-gray-900">{title}</span>
        <span className="block text-xs text-gray-600">{hint}</span>
      </span>
    </label>
  );
  return (
    <div className="space-y-5">
      <header className="min-w-0">
        <p className="truncate text-base font-semibold text-gray-900">{options.candidateName}</p>
        <p className="truncate text-sm text-gray-600">{options.examTitle}</p>
      </header>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold text-gray-900">ให้นักเรียนทำต่ออย่างไร</legend>
        {modeOption("resume", "ทำต่อจากจุดเดิม", "ส่วนเดิม เวลาเดิมที่นับต่ออยู่ ไม่ต้องตั้งค่าอะไร")}
        {modeOption("adjust", "ปรับส่วนหรือเวลาเอง", "เลือกส่วนข้อสอบ และ/หรือ กำหนดเวลาเหลือใหม่")}
      </fieldset>

      {mode === "resume" ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg bg-gray-50 p-4 text-sm">
          <dt className="text-gray-600">ส่วนที่ทำต่อ</dt>
          <dd className="text-gray-900">{target?.label ?? "ไม่มีส่วนที่ทำต่อได้"}</dd>
          <dt className="text-gray-600">เวลาคงเหลือ</dt>
          <dd className="text-lg">{clock}</dd>
          {target?.originalDeadlineAt && remaining <= 0 && (
            <dd className="col-span-2 text-red-700">
              หมดเวลาแล้ว เลือก “ปรับส่วนหรือเวลาเอง” เพื่อกำหนดเวลาใหม่
            </dd>
          )}
        </dl>
      ) : (
        <div className="space-y-4 rounded-lg border border-gray-200 p-4">
          <Select
            id={`${id}-target`}
            label="ส่วนที่จะให้ทำต่อ"
            fullWidth
            value={targetKey}
            disabled={busy}
            placeholder="เลือกส่วนข้อสอบ"
            options={options.targets.map((stage) => ({
              value: recoveryTargetKey(stage),
              label: stage.eligibility.eligible
                ? stage.label
                : `${stage.label} — ${stage.eligibility.reason ?? "ไม่สามารถทำต่อได้"}`,
              disabled: !stage.eligibility.eligible,
            }))}
            onChange={(event) => editDecision(() => setTargetKey(event.target.value))}
          />
          <p className="text-sm text-gray-600">เวลาเดิมของส่วนนี้: {clock}</p>
          <div className="space-y-1.5">
            <Input
              id={`${id}-time`}
              label="กำหนดเวลาเหลือใหม่ (นาที:วินาที)"
              fullWidth
              placeholder="08:00"
              inputMode="numeric"
              autoComplete="off"
              value={award}
              disabled={busy}
              aria-invalid={awardError ? true : undefined}
              aria-describedby={`${id}-time-help`}
              onChange={(event) => editDecision(() => setAward(event.target.value))}
            />
            <p
              id={`${id}-time-help`}
              className={`text-xs ${awardError ? "font-medium text-red-700" : "text-gray-600"}`}
            >
              {awardError ??
                (award.trim()
                  ? "เวลานี้เริ่มนับเมื่อนักเรียนกดทำข้อสอบต่อ"
                  : "เว้นว่างเพื่อใช้เวลาเดิมของส่วนนี้")}
            </p>
          </div>
        </div>
      )}

      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p>
          เมื่อสร้าง QR และรหัส เครื่องเดิมจะหยุดทำข้อสอบทันที เวลายังคงนับต่อ
          ข้อมูลที่เครื่องเดิมยังไม่ส่งจะไม่ย้ายมา
        </p>
        <p className="mt-1 text-amber-800">
          {options.lastServerSaveAt
            ? `บันทึกล่าสุด: ${new Date(options.lastServerSaveAt).toLocaleString()}`
            : "ยังไม่มีข้อมูลการบันทึกจากเซิร์ฟเวอร์"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => void issue()}
          isLoading={pending === "issuing"}
          disabled={
            busy || !target?.eligibility.eligible || !options.issuanceEnabled || !!awardError
          }
        >
          {pending === "issuing" ? "กำลังสร้าง…" : grant ? "ออกรหัสใหม่" : "สร้าง QR และรหัส"}
        </Button>
        {grant && (
          <Button
            variant="outline"
            onClick={() => void restore()}
            isLoading={pending === "restoring"}
            disabled={busy}
          >
            กลับไปใช้เครื่องเดิม
          </Button>
        )}
      </div>

      {!options.issuanceEnabled && (
        <p role="status" className="text-sm text-gray-600">
          ยังไม่เปิดใช้งานการออกรหัสบนระบบนี้
        </p>
      )}
      {grant && (
        <p role="status" className="text-sm font-medium text-gray-900">
          {recoveryGrantStateLabel[grant.state] ?? grant.state}
        </p>
      )}

      {liveIssued && (
        <section
          ref={issuedPanel}
          tabIndex={-1}
          aria-label="QR และรหัสสำหรับเครื่องใหม่"
          className="grid gap-4 rounded-lg border border-gray-200 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[auto_1fr]"
        >
          <div className="flex size-[200px] items-center justify-center bg-white">
            {qr.dataUrl ? (
              <img
                src={qr.dataUrl}
                alt="QR สำหรับเปิดข้อสอบต่อบนเครื่องใหม่"
                width={200}
                height={200}
              />
            ) : qr.error ? (
              <p role="alert" className="text-sm text-red-700">
                {qr.error}
              </p>
            ) : (
              <span className="text-sm text-gray-500">กำลังสร้าง QR…</span>
            )}
          </div>
          <div className="min-w-0 space-y-3">
            <p className="text-sm text-gray-600">
              รหัสครั้งเดียว
              <strong className="mt-1 block font-mono text-3xl tracking-[0.3em] text-gray-900 tabular-nums">
                {liveIssued.code}
              </strong>
            </p>
            <p className="text-sm text-gray-600">
              หมดอายุ: {new Date(liveIssued.grant.expiresAt).toLocaleTimeString()}
            </p>
            <a
              className="block break-all text-sm text-blue-700 underline"
              href={link ?? undefined}
              referrerPolicy="no-referrer"
            >
              {link}
            </a>
            <Button variant="secondary" size="sm" onClick={() => void copy()}>
              คัดลอกลิงก์
            </Button>
          </div>
        </section>
      )}

      {feedback && (
        <p role="status" className="text-sm text-green-800">
          {feedback}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function DeviceRecoveryAction({
  scheduleId,
  attemptId,
  disabled = false,
}: {
  scheduleId: string;
  attemptId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<MonitorSmartphone size={14} aria-hidden="true" />}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {DIALOG_TITLE}
      </Button>
      <DeviceRecoveryDialog
        scheduleId={scheduleId}
        attemptId={attemptId}
        isOpen={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
