import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@components/ui/Button";
import { Input } from "@components/ui/Input";
import { useAuthSession } from "../../auth/api/authSession";
import { recoveryGateway } from "../infrastructure/deviceRecoveryGateway";
import {
  isTerminalRecoveryError,
  normalizeRecoveryCode,
  recoveryClock,
  recoveryErrorCopy,
  type RecoveryReady,
} from "../application/deviceRecovery";
import { useAsyncPolling } from "../../../shared/hooks/useAsyncPolling";
import { useAuthoritativeDeadlineClock } from "../../../shared/hooks/useAuthoritativeDeadlineClock";
import { usePageVisible } from "../../../shared/hooks/usePageVisible";

const POLL_MS = 5_000;

interface PendingRecovery {
  browserProof: string;
  claimOperation: string;
  beginOperation: string;
  linkSecret: string;
  claimed: boolean;
  grantId?: string;
}

const storageKeyFor = (identity: string) => `staff-device-recovery:${identity}`;

function isPendingRecovery(value: unknown): value is PendingRecovery {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["browserProof"] === "string" &&
    typeof v["claimOperation"] === "string" &&
    typeof v["beginOperation"] === "string" &&
    typeof v["linkSecret"] === "string" &&
    typeof v["claimed"] === "boolean"
  );
}

function readSaved(storageKey: string): PendingRecovery | null {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPendingRecovery(parsed) ? parsed : null;
  } catch {
    return null; // corrupt entry: start a fresh, unclaimed preparation
  }
}

/**
 * Loads (or creates) this browser's proof and stable operation IDs, adopts the
 * link secret from the URL fragment, then strips the fragment from history.
 * The six-digit code is never persisted.
 */
function pendingRecovery(identity: string): PendingRecovery {
  const storageKey = storageKeyFor(identity);
  const fragment = window.location.hash.slice(1);
  const secret = fragment.startsWith("key=")
    ? (new URLSearchParams(fragment).get("key") ?? "")
    : fragment;
  let saved = readSaved(storageKey);
  if (!saved) {
    const random = crypto.getRandomValues(new Uint8Array(32));
    saved = {
      browserProof: Array.from(random, (value) => value.toString(16).padStart(2, "0")).join(""),
      claimOperation: crypto.randomUUID(),
      beginOperation: crypto.randomUUID(),
      linkSecret: secret,
      claimed: false,
    };
  } else if (secret && secret !== saved.linkSecret) saved = { ...saved, linkSecret: secret };
  sessionStorage.setItem(storageKey, JSON.stringify(saved));
  if (fragment) history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  return saved;
}

/** Keeps this private page out of Referer headers while it is mounted. */
function useNoReferrer() {
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
    const previous = meta?.content;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "referrer";
      document.head.append(meta);
    }
    meta.content = "no-referrer";
    return () => {
      if (previous === undefined) meta?.remove();
      else if (meta) meta.content = previous;
    };
  }, []);
}

export function StudentDeviceRecoveryRoute() {
  const { grantId = "", scheduleId, attemptId } = useParams();
  const original = !!scheduleId && !!attemptId;
  const storageIdentity = original ? `original:${scheduleId}:${attemptId}` : grantId;
  const navigate = useNavigate();
  const auth = useAuthSession();
  const visible = usePageVisible();
  const [pending, setPending] = useState<PendingRecovery | null>(null);
  const [ready, setReady] = useState<RecoveryReady | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A terminal refusal (expired, locked, replaced) can never recover by retrying.
  const [terminal, setTerminal] = useState(false);
  const alive = useRef(true);
  useNoReferrer();

  useEffect(() => {
    alive.current = true;
    try {
      setPending(pendingRecovery(storageIdentity));
    } catch {
      setError("เปิดใช้งานพื้นที่เก็บข้อมูลของเบราว์เซอร์ แล้วโหลดหน้านี้ใหม่");
    }
    return () => {
      alive.current = false;
    };
  }, [storageIdentity]);

  const fail = (err: unknown, fallback: string) => {
    if (!alive.current) return;
    setError(recoveryErrorCopy(err, fallback));
    if (isTerminalRecoveryError(err)) setTerminal(true);
  };

  const markClaimed = (value: RecoveryReady, from: PendingRecovery) => {
    const next = { ...from, claimed: true, grantId: value.grantId };
    sessionStorage.setItem(storageKeyFor(storageIdentity), JSON.stringify(next));
    setReady(value);
    setPending(next);
  };

  const onOriginalReady = useEffectEvent(markClaimed);
  const onOriginalFailed = useEffectEvent((err: unknown) => fail(err, "ขอให้เจ้าหน้าที่ออกรหัสใหม่"));
  // Original browser: staff designated it, so its signed binding replaces the code.
  useEffect(() => {
    if (!original || !scheduleId || !attemptId || !pending || pending.claimed) return;
    let cancelled = false;
    void recoveryGateway
      .original(scheduleId, attemptId, pending.claimOperation, pending.browserProof)
      .then((value) => {
        if (!cancelled) onOriginalReady(value, pending);
      })
      .catch((err: unknown) => {
        if (!cancelled) onOriginalFailed(err);
      });
    return () => {
      cancelled = true;
    };
  }, [original, scheduleId, attemptId, pending]);

  const activeGrant = grantId || pending?.grantId || "";
  // Claim already returned the ready view, so polling waits one interval.
  useAsyncPolling(
    async () => {
      if (!pending) return;
      try {
        const value = await recoveryGateway.ready(activeGrant, pending.browserProof);
        if (!alive.current) return;
        setReady(value);
        setError(null);
      } catch (err) {
        fail(err, "โหลดสถานะไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ");
        throw err;
      }
    },
    {
      enabled: visible && !terminal && !busy && !!pending?.claimed && !!activeGrant,
      intervalMs: POLL_MS,
      maxIntervalMs: POLL_MS * 6,
      runImmediately: !ready,
    }
  );

  const remaining = useAuthoritativeDeadlineClock({
    deadlineAt: ready?.timePolicy.originalDeadlineAt ?? null,
    serverNow: ready?.serverNow ?? null,
    fallbackSeconds: ready?.timePolicy.remainingSeconds ?? 0,
    running: !!ready?.timePolicy.originalDeadlineAt,
  });

  const claim = async () => {
    if (!pending || busy || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const value = await recoveryGateway.claim(grantId, {
        operationId: pending.claimOperation,
        browserProof: pending.browserProof,
        linkSecret: pending.linkSecret,
        code,
      });
      if (alive.current) {
        setCode("");
        markClaimed(value, pending);
      }
    } catch (err) {
      fail(err, "ตรวจสอบรหัสไม่สำเร็จ กดอีกครั้งเพื่อลองใหม่");
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const begin = async () => {
    if (!pending || !ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Same operation on every retry: a lost response replays, never restarts the clock.
      const result = await recoveryGateway.begin(
        activeGrant || ready.grantId,
        pending.beginOperation,
        pending.browserProof,
        ready.grantRevision
      );
      await recoveryGateway.installIdentity(result);
      const session = await auth.refresh();
      if (!session) throw new Error("session unavailable");
      if (alive.current) {
        sessionStorage.removeItem(storageKeyFor(storageIdentity));
        navigate(result.recovery.routePath, { replace: true });
      }
    } catch (err) {
      fail(err, "เริ่มทำต่อไม่สำเร็จ กดอีกครั้งเพื่อลองคำขอเดิม");
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const awarded = ready?.timePolicy.awardedSeconds;
  const outOfTime = !!ready && awarded === undefined && remaining <= 0;
  const missingAudio =
    !!ready && ready.target.sectionKey === "listening" && !ready.checkpoint.audio?.length;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-gray-900">ทำข้อสอบต่อบนเครื่องนี้</h1>
        {!ready && !original && (
          <p className="text-sm text-gray-600">กรอกรหัสครั้งเดียวที่ได้รับจากเจ้าหน้าที่</p>
        )}
      </header>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        {!ready && original ? (
          <p role="status" className="text-sm text-gray-700">
            กำลังตรวจสอบสิทธิ์เครื่องเดิม หากหมดอายุ ให้เจ้าหน้าที่ออก QR และรหัสใหม่
          </p>
        ) : !ready ? (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void claim();
            }}
          >
            <Input
              id="recovery-code"
              label="รหัส 6 หลัก"
              fullWidth
              className="h-14 text-center font-mono text-2xl tracking-[0.4em] tabular-nums"
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="go"
              maxLength={7}
              value={code}
              disabled={busy || terminal}
              onChange={(event) => setCode(normalizeRecoveryCode(event.target.value))}
            />
            <Button
              type="submit"
              fullWidth
              size="lg"
              isLoading={busy}
              disabled={busy || terminal || !pending || code.length !== 6}
            >
              {busy ? "กำลังตรวจสอบ…" : "ตรวจสอบรหัส"}
            </Button>
          </form>
        ) : (
          <div className="space-y-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-gray-600">ผู้สอบ</dt>
              <dd className="font-semibold text-gray-900">{ready.candidateName}</dd>
              <dt className="text-gray-600">ข้อสอบ</dt>
              <dd className="text-gray-900">{ready.examTitle}</dd>
              <dt className="text-gray-600">ส่วนที่ทำต่อ</dt>
              <dd className="text-gray-900">{ready.target.label}</dd>
              <dt className="text-gray-600">บันทึกแล้ว</dt>
              <dd className="text-gray-900">{ready.checkpoint.responsesSaved} ข้อ</dd>
            </dl>
            <div className="rounded-md bg-gray-50 p-4 text-center">
              <p className="text-sm text-gray-600">เวลาคงเหลือ</p>
              {/* Not a live region: the countdown must not announce every second. */}
              <p
                className={`text-3xl font-semibold tabular-nums ${outOfTime ? "text-red-700" : "text-gray-900"}`}
              >
                {recoveryClock(awarded ?? remaining)}
              </p>
              {awarded !== undefined && (
                <p className="mt-1 text-xs text-gray-600">
                  นักเรียนจะได้รับเวลานี้เมื่อกดทำข้อสอบต่อ
                </p>
              )}
            </div>
            {missingAudio && (
              <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                ยังไม่มีตำแหน่งเสียงที่บันทึกไว้ กรุณาแจ้งเจ้าหน้าที่
              </p>
            )}
            <Button
              fullWidth
              size="lg"
              onClick={() => void begin()}
              isLoading={busy}
              disabled={busy || terminal || outOfTime}
            >
              {busy ? "กำลังเชื่อมต่อ…" : "ทำข้อสอบต่อ"}
            </Button>
            {outOfTime && (
              <p role="status" className="text-sm text-red-700">
                หมดเวลาแล้ว ขอให้เจ้าหน้าที่ออกรหัสใหม่พร้อมกำหนดเวลา
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </main>
  );
}
