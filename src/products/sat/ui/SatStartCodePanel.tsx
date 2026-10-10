import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { backendGet, backendPost } from '../../../services/backendBridge';
import { copyText } from '../../../features/exam-authoring/ui/access-links/accessLinkUi';

interface StartCodeView {
  code: string;
  generation: number;
  cohortName: string;
  examTitle: string;
  opensAt: string;
  closesAt: string;
  acceptingNewStarts: boolean;
}

export function SatStartCodePanel({ scheduleId, blocked }: { scheduleId: string; blocked: boolean }) {
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
      const next = await backendGet<StartCodeView>(endpoint);
      if (identity.current === scheduleId) { setView(next); setCopied(false); }
    } catch (cause) {
      if (identity.current === scheduleId) { setView(null); setError(cause instanceof Error ? cause.message : 'Code could not be revealed.'); }
    } finally {
      inFlight.current = false;
      if (identity.current === scheduleId) setBusy(false);
    }
  }, [blocked, endpoint, scheduleId]);
  useEffect(() => { setView(null); setPresent(false); setRotateConfirm(false); setCopied(false); setError(null); }, [scheduleId]);
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
      const next = await backendPost<StartCodeView>(`${endpoint}/rotate`, { expectedGeneration: view.generation }, { retries: 0 });
      if (identity.current === scheduleId) { setView(next); setCopied(false); }
    } catch (cause) {
      if (identity.current === scheduleId) { setView(null); setPresent(false); setError(cause instanceof Error ? cause.message : 'Rotation could not be confirmed. Reveal the current code before retrying.'); }
    } finally {
      inFlight.current = false;
      if (identity.current === scheduleId) setBusy(false);
    }
  };
  const button = 'sat-btn sat-btn--quiet sat-press min-h-11 px-3';
  const window = view ? `${new Date(view.opensAt).toLocaleString()} – ${new Date(view.closesAt).toLocaleString()}` : '';
  return <section aria-label="Exam start code" className="mt-5 rounded-2xl border border-[var(--sat-staff-border-hairline)] p-4">
    <h2 className="text-lg font-semibold">Exam start code</h2>
    <p className="mt-2 text-sm">Anyone with this session code who is admitted can begin. Revealing or presenting it does not start a clock.</p>
    {view ? <><p aria-label="6-digit exam start code" className="my-4 font-mono text-4xl tracking-[0.3em]">{view.code}</p><p className="text-sm">{window}</p><p className="text-sm">{view.acceptingNewStarts ? 'New starts are available.' : 'New starts are currently blocked.'}</p></> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy || blocked} onClick={() => void reveal()}>{busy ? 'Checking…' : view ? 'Refresh code' : 'Reveal code'}</button>
      {view ? <><button type="button" className={button} disabled={busy || blocked} onClick={() => { setError(null); void copyText(view.code).then(() => setCopied(true), () => setError('Code could not be copied.')); }}>{copied ? 'Copied' : 'Copy code'}</button>
      <button type="button" className={button} disabled={busy || blocked} onClick={() => { setPresent(true); void reveal(); }}>Present code</button>
      <button type="button" className={button} disabled={busy || blocked || !view.acceptingNewStarts} onClick={() => setRotateConfirm(true)}>Rotate code</button></> : null}
    </div>
    {rotateConfirm ? <div className="mt-3" role="group" aria-label="Confirm code rotation"><p>Replace the shared code? Started students keep their clocks; distribute the replacement to students who have not started.</p><button type="button" className={button} onClick={() => void rotate()}>Replace code</button><button type="button" className={button} onClick={() => setRotateConfirm(false)}>Cancel</button></div> : null}
    {error ? <p role="alert" className="mt-3">{error}</p> : null}
    <Dialog.Root open={present} onOpenChange={setPresent}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[111] bg-black/40" /><Dialog.Content className="sat-product fixed inset-0 z-[112] flex flex-col items-center justify-center gap-6 bg-[var(--sat-staff-surface)] p-6 text-center text-[var(--sat-staff-text-primary)]">
      <Dialog.Title className="text-3xl font-semibold">{view?.cohortName ?? 'Exam start code'}</Dialog.Title>
      <Dialog.Description>{view?.examTitle} · Anyone with this session code who is admitted can begin.</Dialog.Description>
      <p className="font-mono text-[clamp(3rem,15vw,10rem)] tracking-[0.15em]">{busy || blocked ? 'Checking…' : view?.code ?? 'Unavailable'}</p><p>{window}</p>
      <Dialog.Close className={button}>Close presentation</Dialog.Close>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}
