import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { proctorGateway } from '../../../features/proctor/infrastructure/proctorGateway';
import { copyText } from '../../../features/exam-authoring/ui/access-links/accessLinkUi';
import { SatRoomSurface } from './room/SatRoomSurface';

interface StartCodeView {
  code: string;
  generation: number;
  cohortName: string;
  examTitle: string;
  opensAt: string;
  closesAt: string;
  acceptingNewStarts: boolean;
}

export function SatStartCodePanel({ scheduleId, blocked, onCodeChange }: {
  scheduleId: string;
  blocked: boolean;
  onCodeChange?: (code: string | null) => void;
}) {
  const [view, setView] = useState<StartCodeView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [present, setPresent] = useState(false);
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const identity = useRef(scheduleId);
  identity.current = scheduleId;
  const inFlight = useRef(false);
  const endpoint = `/v1/proctor/sessions/${encodeURIComponent(scheduleId)}/start-code`;
  const reveal = useCallback(async () => {
    if (inFlight.current || blocked) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await proctorGateway.backendGet<StartCodeView>(endpoint);
      if (identity.current === scheduleId) { setView(next); setCopied(false); onCodeChange?.(next.code); }
    } catch (cause) {
      if (identity.current === scheduleId) { setView(null); onCodeChange?.(null); setError(cause instanceof Error ? cause.message : 'Code could not be revealed.'); }
    } finally {
      inFlight.current = false;
      if (identity.current === scheduleId) setBusy(false);
    }
  }, [blocked, endpoint, onCodeChange, scheduleId]);
  useEffect(() => {
    setView(null);
    setPresent(false);
    setRotateConfirm(false);
    setCopied(false);
    setError(null);
    onCodeChange?.(null);
  }, [onCodeChange, scheduleId]);
  useEffect(() => {
    if (!blocked && !view && !busy && !error) void reveal();
  }, [blocked, busy, error, reveal, view]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && view) void reveal(); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [reveal, view]);
  const rotate = async () => {
    if (!view || inFlight.current || blocked) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setRotateConfirm(false);
    try {
      const next = await proctorGateway.backendPost<StartCodeView>(`${endpoint}/rotate`, { expectedGeneration: view.generation }, { retries: 0 });
      if (identity.current === scheduleId) { setView(next); setCopied(false); onCodeChange?.(next.code); }
    } catch (cause) {
      if (identity.current === scheduleId) { setView(null); onCodeChange?.(null); setPresent(false); setError(cause instanceof Error ? cause.message : 'Rotation could not be confirmed. Reveal the current code before retrying.'); }
    } finally {
      inFlight.current = false;
      if (identity.current === scheduleId) setBusy(false);
    }
  };
  const quiet = 'sat-btn sat-btn--quiet sat-press px-3';
  const secondary = 'sat-btn sat-btn--secondary sat-press px-3';
  const window = view ? `${new Date(view.opensAt).toLocaleString()} – ${new Date(view.closesAt).toLocaleString()}` : '';
  // The code is what students copy from the front of the room, so it is the
  // largest figure in the room's context column, on its own card.
  return <SatRoomSurface aria-label="Exam start code" className="p-4">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.01em] text-[var(--sat-staff-text-primary,#1d1d1f)]">Exam start code</h2>
      {view ? <span className={`inline-flex items-center gap-1.5 text-[14px] font-medium ${view.acceptingNewStarts ? 'text-[var(--sat-staff-success-text,#067647)]' : 'text-[var(--sat-staff-warning-text,#92400e)]'}`}>
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${view.acceptingNewStarts ? 'bg-[var(--sat-staff-success-dot,#059669)]' : 'bg-[var(--sat-staff-warning-dot,#d97706)]'}`} />
        {view.acceptingNewStarts ? 'New starts are available.' : 'New starts are currently blocked.'}
      </span> : null}
    </div>
    {view ? <div className="@container mt-3 rounded-[var(--sat-staff-radius-card,14px)] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] px-3 py-5 text-center">
      <p aria-label="6-digit exam start code" className="whitespace-nowrap font-mono text-[clamp(2.25rem,17cqi,3.5rem)] font-semibold leading-none tracking-[0.18em] tabular-nums text-[var(--sat-staff-text-primary,#1d1d1f)]">{view.code}</p>
      <p className="mt-3 text-[14px] tabular-nums text-[var(--sat-staff-text-tertiary,#6e6e73)]">{window}</p>
    </div> : busy ? <p role="status" className="mt-3 text-[14px] text-[var(--sat-staff-text-tertiary,#6e6e73)]">Checking the current code…</p> : null}
    <p className="mt-3 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Anyone with this session code who is admitted can begin. Revealing or presenting it does not start a clock.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {view ? <>
        <button type="button" className="sat-btn sat-btn--primary sat-press" disabled={busy || blocked} onClick={() => { setPresent(true); void reveal(); }}>Present code</button>
        <button type="button" className={secondary} disabled={busy || blocked} onClick={() => { setError(null); void copyText(view.code).then(() => setCopied(true), () => setError('Code could not be copied.')); }}>{copied ? 'Copied' : 'Copy code'}</button>
        <button type="button" className={quiet} disabled={busy || blocked} onClick={() => void reveal()}>{busy ? 'Checking…' : 'Refresh code'}</button>
        <button type="button" className={quiet} disabled={busy || blocked || !view.acceptingNewStarts} onClick={() => setRotateConfirm(true)}>Rotate code</button>
      </> : <button type="button" className={secondary} disabled={busy || blocked} onClick={() => void reveal()}>{busy ? 'Checking…' : 'Reveal code'}</button>}
    </div>
    {rotateConfirm ? <div className="mt-3 rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-warning-tint,rgba(217,119,6,0.1))] p-3 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]" role="group" aria-label="Confirm code rotation">
      <p>Replace the shared code? Started students keep their clocks; distribute the replacement to students who have not started.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={secondary} onClick={() => void rotate()}>Replace code</button>
        <button type="button" className={quiet} onClick={() => setRotateConfirm(false)}>Cancel</button>
      </div>
    </div> : null}
    {error ? <p role="alert" className="mt-3 text-[14px] font-medium text-[var(--sat-staff-danger,#b42318)]">{error}</p> : null}
    <Dialog.Root open={present} onOpenChange={setPresent}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[111] bg-black/40" /><Dialog.Content className="sat-product fixed inset-0 z-[112] flex flex-col items-center justify-center gap-6 bg-[var(--sat-staff-surface,#fff)] p-6 text-center text-[var(--sat-staff-text-primary,#1d1d1f)]">
      <Dialog.Title className="text-3xl font-semibold tracking-[-0.02em]">{view?.cohortName ?? 'Exam start code'}</Dialog.Title>
      <Dialog.Description className="text-[16px] text-[var(--sat-staff-text-secondary,#515154)]">{view?.examTitle} · Anyone with this session code who is admitted can begin.</Dialog.Description>
      <p className="font-mono text-[clamp(3rem,15vw,10rem)] font-semibold tracking-[0.15em] tabular-nums">{busy || blocked ? 'Checking…' : view?.code ?? 'Unavailable'}</p><p className="tabular-nums text-[var(--sat-staff-text-secondary,#515154)]">{window}</p>
      <Dialog.Close className={secondary}>Close presentation</Dialog.Close>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </SatRoomSurface>;
}
