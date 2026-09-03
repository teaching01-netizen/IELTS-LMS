import { useEffect, useState } from "react";
import { Check, Copy, Download, ExternalLink, Presentation, Share2, X } from "lucide-react";
import type { AssessmentAccessLink } from "../../contracts/accessLinks";
import { copyText, studentJoinUrl } from "./accessLinkUi";
import { AuthoringDialog } from "../authoringPrimitives";
export function useAccessLinkQrCode(linkId: string | null, size = 640) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!linkId) {
      setDataUrl(null);
      setError(null);
      return;
    }
    const url = studentJoinUrl(linkId);
    void import("qrcode")
      .then((module) => module.toDataURL(url, { width: size, margin: 2, errorCorrectionLevel: "M" }))
      .then((next) => { if (!cancelled) { setDataUrl(next); setError(null); } })
      .catch(() => { if (!cancelled) setError("QR code could not be generated."); });
    return () => { cancelled = true; };
  }, [linkId, size]);
  return { dataUrl, error };
}

export function AccessLinkShareSheet({ open, link, onClose, onPresent }: { open: boolean; link: AssessmentAccessLink | null; onClose: () => void; onPresent: () => void }) {
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const { dataUrl, error: qrError } = useAccessLinkQrCode(open ? link?.id ?? null : null, 640);
  useEffect(() => { if (open) { setCopied(false); setShareError(null); } }, [open, link?.id]);
  if (!link) return null;
  const url = studentJoinUrl(link.id);
  const copy = async () => {
    try {
      await copyText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "Link could not be copied.");
    }
  };
  const share = async () => {
    setShareError(null);
    try {
      if (navigator.share) {
        await navigator.share({ title: link.name, text: `${link.examTitle} · Version ${link.versionNumber}`, url });
      } else {
        await copy();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareError(error instanceof Error ? error.message : "Share could not be opened.");
    }
  };
  return (
    <AuthoringDialog
      open={open}
      title={`Share ${link.name}`}
      description="Copy or present this Student Link to learners."
      onClose={onClose}
      showHeader={false}
      contentClassName="w-[calc(100vw-2rem)] max-w-[440px] overflow-hidden rounded-[22px] p-0"
    >
          <header className="flex items-center gap-3 border-b border-au-separator px-5 py-4"><div className="min-w-0 flex-1"><p className="text-[10px] font-medium text-slate-400">Share with students</p><h2 className="truncate text-[16px] font-semibold text-slate-950">{link.name}</h2></div><button type="button" aria-label="Close share sheet" onClick={onClose} className="authoring-icon-button"><X size={15} aria-hidden="true"/></button></header>
          <div className="p-5">
            <div className="mx-auto flex h-52 w-52 items-center justify-center rounded-[18px] bg-au-fill p-3">{dataUrl ? <img src={dataUrl} alt={`QR code for ${link.name}`} className="h-full w-full" /> : <span className="text-[11px] text-slate-400">{qrError ?? "Generating QR code…"}</span>}</div>
            <div className="mt-4 rounded-xl bg-au-fill px-3 py-2.5"><p className="truncate font-mono text-[11px] text-slate-600">{url}</p></div>
            <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => void share()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-au-accent px-3 text-[12px] font-semibold text-white hover:bg-au-accent-hover"><Share2 size={15} aria-hidden="true"/>Share</button><button type="button" onClick={() => void copy()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-au-fill px-3 text-[12px] font-semibold text-slate-700 hover:bg-au-fill-strong">{copied ? <Check size={15} className="text-au-success" aria-hidden="true"/> : <Copy size={15} aria-hidden="true"/>} {copied ? "Copied" : "Copy Link"}</button></div>
            <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={onPresent} className="flex min-h-10 items-center justify-center gap-2 rounded-xl text-[11px] font-semibold text-slate-600 hover:bg-au-fill"><Presentation size={14} aria-hidden="true"/>Present</button>{dataUrl ? <a href={dataUrl} download={`${link.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "student-link"}-qr.png`} className="flex min-h-10 items-center justify-center gap-2 rounded-xl text-[11px] font-semibold text-slate-600 hover:bg-au-fill"><Download size={14} aria-hidden="true"/>Download QR</a> : <span />}</div>
            <a href={url} target="_blank" rel="noreferrer" className="mt-2 flex min-h-10 items-center justify-center gap-2 rounded-xl text-[11px] font-semibold text-slate-500 hover:bg-au-fill"><ExternalLink size={13} aria-hidden="true"/>Open student link</a>
            {shareError ? <p role="alert" className="mt-3 rounded-xl bg-au-danger-tint px-3 py-2 text-[11px] text-au-danger-text">{shareError}</p> : null}
          </div>
    </AuthoringDialog>
  );
}

export function AccessLinkPresentView({ open, link, onClose }: { open: boolean; link: AssessmentAccessLink | null; onClose: () => void }) {
  const { dataUrl } = useAccessLinkQrCode(open ? link?.id ?? null : null, 900);
  if (!link || !open) return null;
  const url = studentJoinUrl(link.id);
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
        </div>
        <button type="button" onClick={onClose} aria-label="Close presentation" className="authoring-icon-button h-11 w-11 bg-au-fill text-slate-500 hover:bg-au-fill-strong">
          <X size={18} aria-hidden="true"/>
        </button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
        <p className="text-lg font-semibold text-slate-700">Scan to join</p>
        <div className="mt-5 flex h-[min(52vh,500px)] w-[min(52vh,500px)] items-center justify-center rounded-[32px] bg-au-fill p-7">
          {dataUrl ? <img src={dataUrl} alt={`QR code for ${link.name}`} className="h-full w-full" /> : <span className="text-sm text-slate-400">Preparing QR code…</span>}
        </div>
        <p className="mt-5 font-mono text-[clamp(14px,2vw,22px)] font-medium text-slate-700">{url}</p>
        <div className="mt-7 flex items-center gap-8 text-left"><Metric value={link.metrics.registered} label="Joined"/><Metric value={link.metrics.started} label="Started"/><Metric value={link.metrics.submitted} label="Submitted"/></div>
      </main>
    </AuthoringDialog>
  );
}
function Metric({ value, label }: { value: number; label: string }) { return <div><p className="text-3xl font-semibold tabular-nums tracking-[-0.04em]">{value}</p><p className="mt-1 text-[11px] font-medium text-slate-400">{label}</p></div>; }
