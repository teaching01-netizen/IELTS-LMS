import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { PdfImagePurpose, PdfLayoutAsset } from "@shared/sat/pdfLayout";
import { SatButton } from "../../../../../products/sat/ui/SatPage";
import type { SatPdfLayoutApi } from "../../../api/satPdfLayoutApi";

export const pdfInputClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";

export function pdfErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function PdfLayoutImageForm({
  examId, purpose, title, description, requireDescription, placementNote, uploadImage, onCancel, onUploaded, onDenied,
}: {
  examId: string;
  purpose: PdfImagePurpose;
  title: string;
  description: string;
  requireDescription: boolean;
  placementNote?: string | undefined;
  uploadImage: SatPdfLayoutApi["upload"];
  onCancel: () => void;
  onUploaded: (asset: PdfLayoutAsset, description: string) => void;
  onDenied: (error: unknown) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState(description);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [thumbnail, setThumbnail] = useState("");
  const request = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const controlId = useId();
  const limit = purpose === "slide" ? 4 : 1;
  useEffect(() => {
    fileInput.current?.focus();
    return () => request.current?.abort();
  }, []);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setThumbnail(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || request.current || (requireDescription && !text.trim())) return;
    const controller = new AbortController();
    request.current = controller;
    setUploading(true);
    setError("");
    try {
      const asset = await uploadImage(examId, purpose, file, controller.signal);
      if (!controller.signal.aborted) onUploaded(asset, text.trim());
    } catch (error) {
      if (controller.signal.aborted) return;
      onDenied(error);
      setError(pdfErrorMessage(error, "The upload failed. Try again."));
    } finally {
      if (!controller.signal.aborted) setUploading(false);
      if (request.current === controller) request.current = null;
    }
  };

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      <h3 className="text-lg font-semibold">{title}</h3>
      {purpose === "slide" ? <p className="text-sm text-muted-foreground">{placementNote ?? "This image becomes one page in the PDF."}</p> : null}
      <label className="block space-y-2 text-sm" htmlFor={controlId + "-file"}>
        <span>Choose a PNG or JPEG up to {limit} MiB</span>
        <input
          className={pdfInputClass}
          ref={fileInput}
          id={controlId + "-file"}
          aria-label="Choose image"
          type="file"
          accept="image/png,image/jpeg"
          disabled={uploading}
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!selected) return;
            if (selected.size > limit * 1024 * 1024 || !["image/png", "image/jpeg"].includes(selected.type)) {
              setError(`Choose a PNG or JPEG up to ${limit} MiB.`);
              return;
            }
            setError("");
            setFile(selected);
          }}
        />
      </label>
      {purpose === "slide" ? (
        <p className="text-sm text-muted-foreground">The whole image is scaled to fit. An A4 landscape image fills the page edge to edge.</p>
      ) : null}
      {file && purpose === "slide" ? (
        <figure className="space-y-2">
          {thumbnail ? (
            <div className="relative aspect-[297/210] overflow-hidden rounded-md border border-border bg-white">
              <img className="absolute inset-0 h-full w-full object-contain" src={thumbnail} alt="Slide fitted to an A4 landscape page" />
            </div>
          ) : null}
          <figcaption className="break-all text-sm">{file.name}</figcaption>
        </figure>
      ) : file ? (
        <div className="flex items-center gap-3 break-all text-sm">
          {thumbnail ? <img className="h-16 w-24 rounded object-contain" src={thumbnail} alt="" /> : null}
          {file.name}
        </div>
      ) : null}
      {requireDescription ? (
        <label className="block space-y-2 text-sm" htmlFor={controlId + "-description"}>
          <span>{purpose === "slide" ? "Image description" : "Logo description"}</span>
          <textarea
            id={controlId + "-description"}
            aria-label={purpose === "slide" ? "Image description" : "Logo description"}
            className={pdfInputClass}
            value={text}
            maxLength={240}
            required
            disabled={uploading}
            onChange={(event) => setText(event.currentTarget.value)}
          />
          <span className="block text-muted-foreground">Describe the image content for readers using assistive technology.</span>
        </label>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <SatButton variant="secondary" onClick={onCancel}>{uploading ? "Cancel upload" : "Cancel"}</SatButton>
        <SatButton variant="primary" type="submit" disabled={uploading || !file || (requireDescription && !text.trim())}>
          {uploading ? "Uploading…" : error && file ? "Retry upload" : "Use image"}
        </SatButton>
      </div>
      <p className="sr-only" role="status">{uploading && file ? `Uploading ${file.name}` : ""}</p>
    </form>
  );
}
