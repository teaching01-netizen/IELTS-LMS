import { useState } from 'react';
import { Check, Copy, Presentation, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useQrCodeDataUrl } from '../../../features/exam-authoring/ui/access-links/AccessLinkShareSheet';
import { copyText } from '../../../features/exam-authoring/ui/access-links/accessLinkUi';
import { useTransientFlag } from '../../../features/exam-authoring/ui/access-links/useTransientValue';

function useCopyLink(url: string) {
  const { active: copied, trigger } = useTransientFlag(1800);
  const [error, setError] = useState<string | null>(null);
  const copy = async () => {
    setError(null);
    try {
      await copyText(url);
      trigger();
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Link could not be copied.');
    }
  };
  return { copied, error, copy };
}

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))]';

function CopyButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <button type="button" onClick={onCopy} className="sat-btn sat-btn--secondary sat-press px-3">
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      <span aria-live="polite">{copied ? 'Copied' : 'Copy link'}</span>
    </button>
  );
}

function QrImage({ dataUrl, error, label }: { dataUrl: string | null; error: string | null; label: string }) {
  return dataUrl
    ? <img src={dataUrl} alt={label} className="h-full w-full" />
    : <span role="status" className="px-3 text-center text-[14px] text-[var(--sat-staff-text-tertiary,#6e6e73)]">{error ?? 'Generating QR code…'}</span>;
}

export function SatStudentLinkPresent({
  open,
  url,
  examTitle,
  cohortName,
  startCode,
  joinedCount,
  activeCount,
  onClose,
}: {
  open: boolean;
  /** The room's entry URL, from roomEntryUrl. */
  url: string;
  examTitle: string;
  cohortName: string;
  startCode?: string | null;
  joinedCount: number;
  activeCount: number;
  onClose: () => void;
}) {
  const { dataUrl, error } = useQrCodeDataUrl(open ? url : null, 900);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Content className="sat-product fixed inset-0 z-[112] flex flex-col bg-[var(--sat-staff-surface,#fff)] text-[var(--sat-staff-text-primary,#1d1d1f)]">
          <header className="flex items-start justify-between gap-4 px-6 py-5">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-[var(--sat-staff-text-tertiary,#6e6e73)]">{examTitle}</p>
              <Dialog.Title className="mt-1 truncate text-2xl font-semibold tracking-[-0.03em]">{cohortName}</Dialog.Title>
              <Dialog.Description className="sr-only">QR code and link students use to join this room.{startCode ? ' The exam start code is also shown.' : ''}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close presentation" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--sat-staff-fill-chip,rgba(0,0,0,0.04))] text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-chip-hover,rgba(0,0,0,0.07))] ${FOCUS_RING}`}>
                <X size={18} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
            <p className="text-xl font-semibold text-[var(--sat-staff-text-secondary,#515154)]">Scan to join</p>
            <div className={`mt-5 flex items-center justify-center rounded-[32px] bg-white p-6 ring-1 ring-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] ${startCode ? 'h-[min(42vh,440px)] w-[min(42vh,440px)]' : 'h-[min(55vh,520px)] w-[min(55vh,520px)]'}`}>
              <QrImage dataUrl={dataUrl} error={error} label={`QR code for ${cohortName}`} />
            </div>
            <p className="mt-5 max-w-full select-all break-all font-mono text-[clamp(15px,2vw,24px)] font-medium text-[var(--sat-staff-text-secondary,#515154)]">{url}</p>
            {startCode ? <div className="mt-6 text-center">
              <p className="text-[16px] font-medium text-[var(--sat-staff-text-tertiary,#6e6e73)]">Exam start code · enter after check-in</p>
              <p className="mt-2 font-mono text-[clamp(3rem,8vw,6rem)] font-semibold leading-none tracking-[0.18em] tabular-nums">{startCode}</p>
            </div> : null}
            <div className="mt-7 flex items-center gap-10 text-left" aria-live="polite">
              <PresentMetric value={joinedCount} label="Joined" />
              <PresentMetric value={activeCount} label="Active" />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PresentMetric({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-4xl font-semibold tabular-nums tracking-[-0.04em]">{value}</p>
      <p className="mt-1 text-[14px] font-medium text-[var(--sat-staff-text-tertiary,#6e6e73)]">{label}</p>
    </div>
  );
}

/**
 * The room link at a glance: a QR students can scan from the projector, the URL
 * itself, and the two things staff do with it. Counts live in the room summary.
 */
export function SatStudentLinkCard({
  url,
  cohortName,
  onOpenShare,
  onPresent,
}: {
  /** The room's entry URL, from roomEntryUrl. */
  url: string;
  cohortName: string;
  onOpenShare: () => void;
  onPresent: () => void;
}) {
  const { dataUrl, error: qrError } = useQrCodeDataUrl(url, 320);
  const { copied, error, copy } = useCopyLink(url);
  return (
    <div className="mt-4" data-sat-room-student-link>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onOpenShare}
          aria-label="Show larger QR code and sharing options"
          className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-[var(--sat-staff-radius-control,10px)] bg-white p-1 ring-1 ring-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] transition-shadow duration-150 hover:ring-[var(--sat-staff-text-tertiary,#6e6e73)] ${FOCUS_RING}`}
        >
          <QrImage dataUrl={dataUrl} error={qrError} label={`QR code for ${cohortName}`} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">Student link</p>
          <p className="mt-0.5 break-all font-mono text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{url}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <CopyButton copied={copied} onCopy={() => void copy()} />
        <button type="button" onClick={onPresent} className="sat-btn sat-btn--quiet sat-press"><Presentation size={16} aria-hidden="true" />Present QR</button>
      </div>
      {error ? <p role="alert" className="mt-2 text-[14px] font-medium text-[var(--sat-staff-danger,#b42318)]">{error}</p> : null}
    </div>
  );
}
