import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { Upload } from "lucide-react";
import type { PdfImagePurpose, PdfLayoutAsset, PdfSide, PdfTarget, PdfTargetOption } from "@shared/sat/pdfLayout";
import { SatButton, SatField } from "../../../../../products/sat/ui/SatPage";
import type { SatPdfLayoutApi } from "../../../api/satPdfLayoutApi";

/**
 * Adding one slide. The staff member brings a finished slide (PNG or JPEG),
 * says where it prints, and describes it for screen readers. Everything the
 * server will check is checked here first, so a rejected export never costs
 * an upload.
 */

const MAX_EDGE_PX = 4096;
const MAX_PIXELS = 12_000_000;

export function pdfErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image could not be read."));
    };
    image.src = url;
  });
}

export function PdfLayoutImageForm({
  examId,
  purpose,
  title,
  description,
  requireDescription,
  placementNote,
  targets,
  target,
  side,
  labelOf,
  uploadImage,
  onCancel,
  onUploaded,
  onDenied,
}: {
  examId: string;
  purpose: PdfImagePurpose;
  title: string;
  description: string;
  requireDescription: boolean;
  placementNote?: string | undefined;
  targets: PdfTargetOption[];
  target: PdfTarget;
  side: PdfSide;
  labelOf: (option: PdfTargetOption) => string;
  uploadImage: SatPdfLayoutApi["upload"];
  onCancel: () => void;
  onUploaded: (asset: PdfLayoutAsset, placement: { description: string; target: PdfTarget; side: PdfSide }) => void;
  onDenied: (error: unknown) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState(description);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [thumbnail, setThumbnail] = useState("");
  const [chosenTarget, setChosenTarget] = useState(target);
  const [chosenSide, setChosenSide] = useState<PdfSide>(side);
  const request = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const limit = purpose === "slide" ? 4 : 1;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!file) {
      setThumbnail("");
      return;
    }
    const url = URL.createObjectURL(file);
    setThumbnail(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const choose = async (selected: File | null) => {
    if (!selected) return;
    if (!["image/png", "image/jpeg"].includes(selected.type)) {
      setError("Choose a PNG or JPEG image.");
      return;
    }
    if (selected.size > limit * 1024 * 1024) {
      setError(`This image is ${(selected.size / (1024 * 1024)).toFixed(1)} MB. The limit is ${limit} MB.`);
      return;
    }
    try {
      const size = await readImageSize(selected);
      if (size.width > MAX_EDGE_PX || size.height > MAX_EDGE_PX) {
        setError(`This image is ${size.width}×${size.height} px. The limit is ${MAX_EDGE_PX} px on each side.`);
        return;
      }
      if (size.width * size.height > MAX_PIXELS) {
        setError(`This image is ${(size.width * size.height / 1_000_000).toFixed(1)} megapixels. The limit is 12 megapixels.`);
        return;
      }
    } catch (cause) {
      setError(pdfErrorMessage(cause, "This image could not be read."));
      return;
    }
    setError("");
    setFile(selected);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void choose(event.dataTransfer.files[0] ?? null);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const pasted = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
    if (!pasted) return;
    event.preventDefault();
    void choose(pasted);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || request.current || (requireDescription && !text.trim())) return;
    const controller = new AbortController();
    request.current = controller;
    setUploading(true);
    setError("");
    try {
      const asset = await uploadImage(examId, purpose, file, controller.signal);
      if (!controller.signal.aborted) {
        onUploaded(asset, { description: text.trim(), target: chosenTarget, side: chosenSide });
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      onDenied(cause);
      setError(pdfErrorMessage(cause, "The upload failed. Try again."));
    } finally {
      if (!controller.signal.aborted) setUploading(false);
      if (request.current === controller) request.current = null;
    }
  };

  return (
    <form className="space-y-5" onSubmit={(event) => void submit(event)}>
      <div>
        <h3 className="text-[length:var(--sat-staff-type-section-size,20px)] font-semibold leading-[var(--sat-staff-type-section-line,28px)] tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h3>
        {purpose === "slide" ? (
          <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{placementNote ?? "This slide prints as one landscape page of the report."}</p>
        ) : null}
      </div>
      {/* The drop zone is a drop target, not a control: the Choose image
          button below is the accessible way in. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- drop and paste target; the button beside it is the control. */}
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onPaste={onPaste}
        className="rounded-[var(--sat-staff-radius-card,16px)] border border-dashed border-[var(--sat-staff-border-strong,#00000017)] bg-[var(--sat-staff-surface-raised,#fbfbfd)] p-4"
      >
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = "";
            void choose(selected);
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
            Drop a PNG or JPEG here, paste one, or choose a file. Up to {limit} MB.
          </p>
          <SatButton variant="secondary" icon={<Upload size={16} />} disabled={uploading} onClick={() => fileInput.current?.click()}>
            Choose image
          </SatButton>
        </div>
        {file ? (
          <figure className="mt-4 flex items-center gap-4">
            <span className="grid h-20 w-28 shrink-0 place-items-center overflow-hidden rounded-[4px] border border-[var(--sat-staff-border-hairline,#0000000f)] bg-white">
              {thumbnail ? <img src={thumbnail} alt="" className="h-full w-full object-contain" /> : null}
            </span>
            <figcaption className="min-w-0 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
              <span className="block truncate font-medium text-[var(--sat-staff-text-primary,#1d1d1f)]">{file.name}</span>
              <span>{(file.size / 1024).toFixed(0)} KB</span>
            </figcaption>
          </figure>
        ) : null}
      </div>
      {purpose === "slide" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <SatField id="pdf-slide-target" label="Prints at">
            {(control) => (
              <select
                {...control}
                className="sat-select w-full rounded-[var(--sat-staff-radius-input,8px)] border border-[var(--sat-staff-border-control,#00000017)] bg-[var(--sat-staff-surface-solid-fallback,#fff)] px-3 py-2 text-[14px]"
                value={targetKeyOf(chosenTarget)}
                onChange={(event) => {
                  const chosen = targets.find((option) => targetKeyOf(option.target) === event.currentTarget.value);
                  if (chosen) setChosenTarget(chosen.target);
                }}
              >
                {targets.map((option) => (
                  <option key={targetKeyOf(option.target)} value={targetKeyOf(option.target)}>{labelOf(option)}</option>
                ))}
              </select>
            )}
          </SatField>
          <SatField id="pdf-slide-side" label="Position" help="Before or after that section.">
            {(control) => (
              <select
                {...control}
                className="sat-select w-full rounded-[var(--sat-staff-radius-input,8px)] border border-[var(--sat-staff-border-control,#00000017)] bg-[var(--sat-staff-surface-solid-fallback,#fff)] px-3 py-2 text-[14px]"
                value={chosenSide}
                onChange={(event) => setChosenSide(event.currentTarget.value === "before" ? "before" : "after")}
              >
                <option value="before">Before</option>
                <option value="after">After</option>
              </select>
            )}
          </SatField>
        </div>
      ) : null}
      {requireDescription ? (
        <SatField
          id="pdf-slide-description"
          label={purpose === "slide" ? "Describe this slide" : "Describe this mark"}
          help="Screen readers announce this when the slide is printed. Say what the slide shows or is for."
          error={null}
        >
          {(control) => (
            <textarea
              {...control}
              rows={3}
              maxLength={240}
              required
              disabled={uploading}
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
              className="sat-input w-full rounded-[var(--sat-staff-radius-input,8px)] border border-[var(--sat-staff-border-control,#00000017)] bg-[var(--sat-staff-surface-solid-fallback,#fff)] px-3 py-2 text-[14px]"
            />
          )}
        </SatField>
      ) : null}
      {error ? <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <SatButton variant="quiet" onClick={onCancel}>{uploading ? "Cancel upload" : "Cancel"}</SatButton>
        <SatButton variant="primary" type="submit" pending={uploading} disabled={uploading || !file || (requireDescription && !text.trim())}>
          {uploading ? "Uploading…" : "Use image"}
        </SatButton>
      </div>
    </form>
  );
}

function targetKeyOf(target: PdfTarget): string {
  if (target.kind === "reviewSubject") return `reviewSubject:${target.sectionKey}`;
  if (target.kind === "reviewModule") return `reviewModule:${target.sectionKey}:${target.moduleKey}`;
  return target.kind;
}
