import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Download, ExternalLink, Presentation, Share2, X } from "lucide-react";
import type { AssessmentAccessLink } from "../../contracts/accessLinks";
import { copyText, studentJoinUrl } from "./accessLinkUi";

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
    <AnimatePresence>
      {open ? <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <motion.section role="dialog" aria-modal="true" aria-labelledby="share-student-link-title" initial={{ opacity: 0, scale: 0.98, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: 8 }} transition={{ duration: 0.18 }} className="w-full max-w-[440px] overflow-hidden rounded-[22px] border border-black/[0.08] bg-white shadow-[0_24px_80px_rgba(0,0,0,0.2)]">
          <header className="flex items-center gap-3 border-b border-black/[0.055] px-5 py-4"><div className="min-w-0 flex-1"><p className="text-[10px] font-medium text-slate-400">Share with students</p><h2 id="share-student-link-title" className="truncate text-[16px] font-semibold text-slate-950">{link.name}</h2></div><button type="button" aria-label="Close share sheet" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"><X size={15}/></button></header>
          <div className="p-5">
            <div className="mx-auto flex h-52 w-52 items-center justify-center rounded-[18px] bg-[#f5f5f7] p-3">{dataUrl ? <img src={dataUrl} alt={`QR code for ${link.name}`} className="h-full w-full" /> : <span className="text-[11px] text-slate-400">{qrError ?? "Generating QR code…"}</span>}</div>
            <div className="mt-4 rounded-xl bg-[#f5f5f7] px-3 py-2.5"><p className="truncate font-mono text-[11px] text-slate-600">{url}</p></div>
            <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => void share()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0071e3] px-3 text-[12px] font-semibold text-white hover:bg-[#0077ed]"><Share2 size={15}/>Share</button><button type="button" onClick={() => void copy()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#f5f5f7] px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-200/70">{copied ? <Check size={15} className="text-emerald-600"/> : <Copy size={15}/>} {copied ? "Copied" : "Copy Link"}</button></div>
            <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={onPresent} className="flex min-h-10 items-center justify-center gap-2 rounded-xl text-[11px] font-semibold text-slate-600 hover:bg-[#f5f5f7]"><Presentation size={14}/>Present</button>{dataUrl ? <a href={dataUrl} download={`${link.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "student-link"}-qr.png`} className="flex min-h-10 items-center justify-center gap-2 rounded-xl text-[11px] font-semibold text-slate-600 hover:bg-[#f5f5f7]"><Download size={14}/>Download QR</a> : <span />}</div>
            <a href={url} target="_blank" rel="noreferrer" className="mt-2 flex min-h-10 items-center justify-center gap-2 rounded-xl text-[11px] font-semibold text-slate-500 hover:bg-[#f5f5f7]"><ExternalLink size={13}/>Open student link</a>
            {shareError ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[11px] text-red-700">{shareError}</p> : null}
          </div>
        </motion.section>
      </motion.div> : null}
    </AnimatePresence>
  );
}

export function AccessLinkPresentView({ open, link, onClose }: { open: boolean; link: AssessmentAccessLink | null; onClose: () => void }) {
  const { dataUrl } = useAccessLinkQrCode(open ? link?.id ?? null : null, 900);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);
  if (!link || !open) return null;
  const url = studentJoinUrl(link.id);
  return <div className="fixed inset-0 z-[130] flex flex-col bg-white text-slate-950" role="dialog" aria-modal="true" aria-label={`Present ${link.name} to students`}>
    <header className="flex items-center justify-between px-6 py-5"><div><p className="text-[12px] font-medium text-slate-400">{link.examTitle} · Version {link.versionNumber}</p><h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{link.name}</h2></div><button type="button" onClick={onClose} aria-label="Close presentation" className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f5f5f7] text-slate-500 hover:bg-slate-200"><X size={18}/></button></header>
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-10 text-center"><p className="text-lg font-semibold text-slate-700">Scan to join</p><div className="mt-5 flex h-[min(52vh,500px)] w-[min(52vh,500px)] items-center justify-center rounded-[32px] bg-[#f5f5f7] p-7">{dataUrl ? <img src={dataUrl} alt={`QR code for ${link.name}`} className="h-full w-full" /> : <span className="text-sm text-slate-400">Preparing QR code…</span>}</div><p className="mt-5 font-mono text-[clamp(14px,2vw,22px)] font-medium text-slate-700">{url}</p><div className="mt-7 flex items-center gap-8 text-left"><Metric value={link.metrics.registered} label="Joined"/><Metric value={link.metrics.started} label="Started"/><Metric value={link.metrics.submitted} label="Submitted"/></div></main>
  </div>;
}
function Metric({ value, label }: { value: number; label: string }) { return <div><p className="text-3xl font-semibold tabular-nums tracking-[-0.04em]">{value}</p><p className="mt-1 text-[11px] font-medium text-slate-400">{label}</p></div>; }
