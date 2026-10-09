import { useEffect, useState } from "react";
import { Check, Copy, Download, Presentation, X } from "lucide-react";
import { accessLinkSectionStudentCopy, effectiveAccessLinkSections, type AssessmentAccessLink } from "../../contracts/accessLinks";
import { copyText, describeAccessLinkAudience, formatAccessLinkStatus, roomEntryUrl, studentJoinUrl } from "./accessLinkUi";
import { useTransientFlag } from "./useTransientValue";
import { AuthoringDialog } from "../authoringPrimitives";
export function useQrCodeDataUrl(url: string | null, size = 640) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setDataUrl(null);
      setError(null);
      return;
    }
    void import("qrcode")
      .then((module) => module.toDataURL(url, { width: size, margin: 2, errorCorrectionLevel: "M" }))
      .then((next) => { if (!cancelled) { setDataUrl(next); setError(null); } })
      .catch(() => { if (!cancelled) setError("QR code could not be generated."); });
    return () => { cancelled = true; };
  }, [url, size]);
  return { dataUrl, error };
}

export function useAccessLinkQrCode(linkId: string | null, size = 640) {
  return useQrCodeDataUrl(linkId ? studentJoinUrl(linkId) : null, size);
}

export interface StudentShareDialogProps {
  open: boolean;
  url: string;
  roomName: string;
  examTitle: string;
  versionNumber?: number | null;
  /** "Anyone with link" / "Listed students · N"; omitted when the viewer cannot read the room's access. */
  audience?: string | null;
  /** "Check-in open", "Check-in opens later"…; omitted when unknown. */
  checkIn?: string | null;
  /** False when check-in is not open right now, so the copy never promises entry. */
  checkInOpen?: boolean;
  sectionCopy?: string | null;
  /** Shown instead of the link when the room cannot be shared as configured. */
  blockedMessage?: string | null;
  onClose: () => void;
  onPresent: () => void;
}

/** "Share with students": the one sharing surface for a room, from the exam's Rooms tab or the room itself. */
export function StudentShareDialog({ open, url, roomName, examTitle, versionNumber, audience, checkIn, checkInOpen = true, sectionCopy, blockedMessage, onClose, onPresent }: StudentShareDialogProps) {
  const { active: copied, trigger: confirmCopied, clear: clearCopied } = useTransientFlag(1800);
  const [copyError, setCopyError] = useState<string | null>(null);
  const { dataUrl, error: qrError } = useQrCodeDataUrl(open && !blockedMessage ? url : null, 640);
  useEffect(() => { if (open) { clearCopied(); setCopyError(null); } }, [open, url, clearCopied]);
  const copy = async () => {
    setCopyError(null);
    try {
      await copyText(url);
      confirmCopied();
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "Link could not be copied.");
    }
  };
  const fileName = `${roomName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "room"}-qr.png`;
  return (
    <AuthoringDialog
      open={open}
      title={`Share ${roomName} with students`}
      description="Copy the student link or show its QR code."
      onClose={onClose}
      showHeader={false}
      contentClassName="w-[calc(100vw-2rem)] max-w-[440px] overflow-hidden rounded-[22px] p-0"
    >
      <header className="flex items-center gap-3 border-b border-au-separator px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-slate-500">Share with students</p>
          <h2 className="truncate text-[16px] font-semibold text-slate-950">{roomName}</h2>
          <p className="mt-0.5 truncate text-[12px] text-slate-500">{examTitle}{versionNumber ? ` · Version ${versionNumber}` : ""}{sectionCopy ? ` · ${sectionCopy}` : ""}</p>
        </div>
        <button type="button" aria-label="Close share sheet" onClick={onClose} className="authoring-icon-button h-11 w-11"><X size={15} aria-hidden="true"/></button>
      </header>
      <div className="p-5">
        {audience || checkIn ? (
          <dl className="mb-4 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-[12px] leading-5">
            {audience ? <><dt className="font-medium text-slate-500">Who can join</dt><dd className="text-slate-900">{audience}</dd></> : null}
            {checkIn ? <><dt className="font-medium text-slate-500">Check-in</dt><dd className="text-slate-900">{checkIn}</dd></> : null}
          </dl>
        ) : null}
        {blockedMessage ? <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-900">{blockedMessage}</p> : <>
          <p className="text-[13px] leading-5 text-slate-600">{checkInOpen ? "Students can check in now. They wait until you start the exam." : "Students can check in once check-in opens. They wait until you start the exam."}</p>
          <div className="mx-auto mt-4 flex h-52 w-52 items-center justify-center rounded-[18px] bg-au-fill p-3">{dataUrl ? <img src={dataUrl} alt={`QR code for ${roomName}`} className="h-full w-full" /> : <span role="status" className="px-4 text-center text-[12px] text-slate-500">{qrError ?? "Generating QR code…"}</span>}</div>
          <div className="mt-4 rounded-xl bg-au-fill px-3 py-2.5"><p className="break-all font-mono text-[12px] leading-5 text-slate-600 select-all">{url}</p></div>
          <button type="button" onClick={() => void copy()} className="sat-press sat-press-fill-accent mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-au-accent px-3 text-[13px] font-semibold text-white hover:bg-au-accent-hover">{copied ? <Check size={15} aria-hidden="true"/> : <Copy size={15} aria-hidden="true"/>}<span aria-live="polite">{copied ? "Copied" : "Copy link"}</span></button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={onPresent} className="sat-press sat-press-fill flex min-h-11 items-center justify-center gap-2 rounded-xl bg-au-fill text-[12px] font-semibold text-slate-700 hover:bg-au-fill-strong"><Presentation size={14} aria-hidden="true"/>Present QR</button>
            {dataUrl ? <a href={dataUrl} download={fileName} className="sat-press sat-press-fill flex min-h-11 items-center justify-center gap-2 rounded-xl bg-au-fill text-[12px] font-semibold text-slate-700 hover:bg-au-fill-strong"><Download size={14} aria-hidden="true"/>Download QR</a> : <span />}
          </div>
        </>}
        {copyError ? <p role="alert" className="mt-3 rounded-xl bg-au-danger-tint px-3 py-2 text-[12px] text-au-danger-text">{copyError}</p> : null}
      </div>
    </AuthoringDialog>
  );
}

export function AccessLinkShareSheet({ open, link, onClose, onPresent }: { open: boolean; link: AssessmentAccessLink | null; onClose: () => void; onPresent: () => void }) {
  if (!link) return null;
  const sectionCopy = accessLinkSectionStudentCopy(link.enabledSections, link.publishScope);
  const hasAvailableSections = effectiveAccessLinkSections(link.enabledSections, link.publishScope).length > 0;
  return (
    <StudentShareDialog
      open={open}
      url={roomEntryUrl({ accessLinkId: link.id, scheduleId: link.scheduleId })}
      roomName={link.name}
      examTitle={link.examTitle}
      versionNumber={link.versionNumber}
      audience={describeAccessLinkAudience(link)}
      checkIn={formatAccessLinkStatus(link.status)}
      checkInOpen={link.status === "live"}
      sectionCopy={sectionCopy}
      blockedMessage={hasAvailableSections ? null : `${sectionCopy} Update this room’s sections before sharing.`}
      onClose={onClose}
      onPresent={onPresent}
    />
  );
}

export function AccessLinkPresentView({ open, link, onClose }: { open: boolean; link: AssessmentAccessLink | null; onClose: () => void }) {
  const { dataUrl } = useAccessLinkQrCode(open ? link?.id ?? null : null, 900);
  if (!link || !open) return null;
  const url = studentJoinUrl(link.id);
  const sectionCopy = accessLinkSectionStudentCopy(link.enabledSections, link.publishScope);
  const hasAvailableSections = effectiveAccessLinkSections(link.enabledSections, link.publishScope).length > 0;
  return (
    <AuthoringDialog
      open={open}
      title={`Present ${link.name} to students`}
      description="Show the QR code and joining URL for this Student Link."
      onClose={onClose}
      showHeader={false}
      contentClassName="authoring-dialog-content--fullscreen"
    >
      <header className="flex items-center justify-between px-6 py-5">
        <div>
          <p className="text-[12px] font-medium text-slate-400">{link.examTitle} · Version {link.versionNumber}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{link.name}</h2>
          {sectionCopy ? <p className="mt-1 text-sm font-semibold text-slate-500">{sectionCopy}</p> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Close presentation" className="authoring-icon-button h-11 w-11 bg-au-fill text-slate-500 hover:bg-au-fill-strong">
          <X size={18} aria-hidden="true"/>
        </button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
        {!hasAvailableSections ? <p role="alert" className="max-w-xl rounded-2xl bg-amber-50 px-6 py-5 text-base leading-7 text-amber-900">{sectionCopy} Update this room’s sections before presenting it.</p> : <>
        <p className="text-lg font-semibold text-slate-700">Scan to join</p>
        <div className="mt-5 flex h-[min(52vh,500px)] w-[min(52vh,500px)] items-center justify-center rounded-[32px] bg-au-fill p-7">
          {dataUrl ? <img src={dataUrl} alt={`QR code for ${link.name}`} className="h-full w-full" /> : <span className="text-sm text-slate-400">Preparing QR code…</span>}
        </div>
        <p className="mt-5 max-w-full break-all px-2 font-mono text-[clamp(14px,2vw,22px)] font-medium text-slate-700 select-all">{url}</p>
        <div className="mt-7 flex items-center gap-8 text-left"><Metric value={link.metrics.registered} label="Joined"/><Metric value={link.metrics.started} label="Started"/><Metric value={link.metrics.submitted} label="Submitted"/></div>
        </>}
      </main>
    </AuthoringDialog>
  );
}
function Metric({ value, label }: { value: number; label: string }) { return <div><p className="text-3xl font-semibold tabular-nums tracking-[-0.04em]">{value}</p><p className="mt-1 text-[12px] font-medium text-slate-400">{label}</p></div>; }
