import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pdfTargetKey, type PdfLayout, type PdfLayoutAsset, type PdfLayoutEditorData, type PdfLogoSlot, type PdfSide, type PdfSlide, type PdfTarget, type PdfTargetOption } from "@shared/sat/pdfLayout";
import { ArrowDown, ArrowLeft, ArrowUp, Plus } from "lucide-react";
import { ApiError } from "@shared/api-client/errors";
import { SatButton } from "../../../../../products/sat/ui/SatPage";
import { satPdfLayoutApi, type SatPdfLayoutApi } from "../../../api/satPdfLayoutApi";
import { PdfLayoutImageForm, pdfErrorMessage, pdfInputClass } from "./PdfLayoutImageForm";
import { PdfSectionSample, usePdfSampleBook } from "./PdfSectionSample";
import { PdfLayoutPreview } from "./PdfLayoutPreview";
import { orderedPdfItems, PdfPageStrip } from "./PdfPageStrip";

const slots: Record<PdfLogoSlot, string> = {
  cover: "Cover logo",
  leftWatermark: "Left watermark",
  rightWatermark: "Right watermark",
};

const coverSample: PdfTarget = { kind: "cover" };
const scoreSample: PdfTarget = { kind: "scoreReport" };

type EditImage =
  | { kind: "slide"; option: PdfTargetOption; side: PdfSide; existing?: PdfSlide }
  | { kind: "logo"; slot: PdfLogoSlot };

const slotLocations: Record<PdfLogoSlot, string> = {
  cover: "On the cover page",
  leftWatermark: "Small, repeated marks on the left",
  rightWatermark: "One large mark on the right",
};

const bucket = (slide: PdfSlide) => pdfTargetKey(slide.target) + ":" + slide.side;
const maxLayoutBytes = 6 * 1024 * 1024;

function layoutSignature(layout: PdfLayout) {
  const slides = [...layout.slides].sort((a, b) => bucket(a).localeCompare(bucket(b)));
  return JSON.stringify({ slides, logos: layout.logos });
}

export function ExamPdfLayoutEditor({ examId, examTitle, canEdit, onDirtyChange, onBack, leave, api = satPdfLayoutApi }: {
  examId: string;
  examTitle: string;
  canEdit: boolean;
  onDirtyChange: (value: boolean) => void;
  onBack: () => void;
  leave?: { stay: () => void; proceed: () => void } | undefined;
  api?: SatPdfLayoutApi | undefined;
}) {
  const [sampleGeneration, setSampleGeneration] = useState(0);
  const [saved, setSaved] = useState<PdfLayoutEditorData | null>(null);
  const [draft, setDraft] = useState<PdfLayout | null>(null);
  const [assets, setAssets] = useState<Record<string, PdfLayoutAsset>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const [expired, setExpired] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [tab, setTab] = useState<"pages" | "branding">("pages");
  const [logoPosition, setLogoPosition] = useState<PdfLogoSlot>("cover");
  const [targetKey, setTargetKey] = useState("cover");
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [upload, setUpload] = useState<EditImage | null>(null);
  const [preview, setPreview] = useState(false);
  const [openImageSettings, setOpenImageSettings] = useState<string | null>(null);
  const [move, setMove] = useState<{ slide: PdfSlide; target: string; side: PdfSide } | null>(null);
  const [removed, setRemoved] = useState<{ slide: PdfSlide; index: number } | null>(null);
  const request = useRef<AbortController | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const leaveHeading = useRef<HTMLHeadingElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const outlineHeading = useRef<HTMLHeadingElement>(null);
  const placementHeading = useRef<HTMLHeadingElement>(null);
  const operationOrigin = useRef<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(["examReview"]));
  const dirty = Boolean(saved && draft && layoutSignature(saved.layout) !== layoutSignature(draft));
  const writable = canEdit && !accessLost;
  const draftLogos = draft?.logos;
  const sampleLayout = useMemo(() => writable && draftLogos ? { slides: [], logos: draftLogos } : undefined, [draftLogos, writable]);

  const acceptLayout = useCallback((value: PdfLayoutEditorData) => {
    setSaved(value);
    setSampleGeneration((previous) => previous + 1);
    setDraft(value.layout);
    setAssets(Object.fromEntries(value.assets.map((asset) => [asset.id, asset])));
    setConflict(false);
    setExpired([]);
    setMissing([]);
    setRemoved(null);
    setSelectedSlideId((id) => value.layout.slides.some((slide) => slide.id === id) ? id : null);
  }, []);
  const reload = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setLoadError("");
    try {
      const value = await api.load(examId, controller.signal);
      if (!controller.signal.aborted) {
        acceptLayout(value);
        setError("");
        setStatus("");
        setTargetKey("cover");
        setSelectedSlideId(null);
      }
    } catch (error) {
      if (!controller.signal.aborted) setLoadError(pdfErrorMessage(error, "Couldn’t load this layout."));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }, [acceptLayout, api, examId]);
  useEffect(() => {
    void reload();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [reload]);
  useEffect(() => {
    onDirtyChange(dirty || upload !== null);
  }, [dirty, onDirtyChange, upload]);
  const leaving = leave !== undefined;
  useEffect(() => {
    if (leaving) leaveHeading.current?.focus();
  }, [leaving]);

  const onDenied = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && (cause.status === 403 || cause.status === 401)) {
      setAccessLost(true);
      setError("You no longer have edit access to this layout.");
    }
  }, []);

  const samples = usePdfSampleBook({
    enabled: Boolean(saved) && !loading && !accessLost,
    identity: JSON.stringify([examId, examTitle, sampleGeneration, writable, draftLogos]),
    examId, layout: sampleLayout, previewLayout: api.preview, onDenied,
  });

  const save = async (afterSave?: () => void) => {
    if (!saved || !draft || request.current || !dirty || !writable || conflict) return;
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const value = await api.save(examId, saved.revision, draft, controller.signal);
      if (!controller.signal.aborted) {
        acceptLayout(value);
        setStatus("Layout saved. New PDFs use this layout.");
        afterSave?.();
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      onDenied(cause);
      if (cause instanceof ApiError && cause.status === 409) {
        setConflict(true);
        setStatus("Another person changed this layout.");
      } else {
        const assetId = cause instanceof ApiError ? cause.details?.["assetId"] : null;
        if (typeof assetId === "string") setExpired((ids) => [...ids, assetId]);
        setError(pdfErrorMessage(cause, "Couldn’t save. Your edits are still here."));
        requestAnimationFrame(() => workspaceRef.current?.querySelector<HTMLElement>("[data-pdf-error]")?.focus());
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setSaving(false);
      }
    }
  };

  const restoreActionFocus = () => {
    requestAnimationFrame(() => {
      const origin = operationOrigin.current;
      const equivalent = origin?.getAttribute("aria-label");
      if (origin?.isConnected) origin.focus();
      else if (equivalent) {
        const matching = [...(workspaceRef.current?.querySelectorAll<HTMLElement>("[aria-label]") ?? [])]
          .find((element) => element.getAttribute("aria-label") === equivalent);
        matching?.focus();
      }
    });
  };
  const closePanel = () => {
    setPreview(false);
    setUpload(null);
    restoreActionFocus();
  };

  const focusRow = (id: string) => {
    requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 767px)").matches) placementHeading.current?.focus();
      else document.getElementById("pdf-slide-" + id)?.focus();
    });
  };
  const edit = (next: PdfLayout, announcement?: string) => {
    setDraft(next);
    setError("");
    setStatus(announcement ?? "");
  };
  const uploaded = (asset: PdfLayoutAsset, description: string) => {
    if (!draft || !upload || !writable) return;
    setAssets((value) => ({ ...value, [asset.id]: asset }));
    if (upload.kind === "logo") {
      const logo = { assetId: asset.id, ...(description ? { description } : {}) };
      edit({ ...draft, logos: { ...draft.logos, [upload.slot]: logo } }, slots[upload.slot] + " updated in the draft.");
      restoreActionFocus();
    } else {
      const slide: PdfSlide = {
        id: upload.existing?.id ?? crypto.randomUUID(),
        assetId: asset.id, description,
        target: upload.option.target, side: upload.side,
      };
      const slides = upload.existing ? draft.slides.map((old) => old.id === slide.id ? slide : old) : [...draft.slides, slide];
      edit({ ...draft, slides }, "Image page added " + slide.side + " " + upload.option.label + ".");
      selectTarget(pdfTargetKey(slide.target), slide.id);
      focusRow(slide.id);
    }
    setUpload(null);
  };
  const options = [...(saved?.targets ?? [])];
  const knownTargets = new Set(options.map((option) => pdfTargetKey(option.target)));
  for (const slide of draft?.slides ?? []) {
    const key = pdfTargetKey(slide.target);
    if (!options.some((option) => pdfTargetKey(option.target) === key)) {
      const name = "moduleKey" in slide.target ? slide.target.moduleKey : "sectionKey" in slide.target ? slide.target.sectionKey : slide.target.kind;
      options.push({ target: slide.target, label: name + " (unavailable)" });
    }
  }
  const selected = options.find((option) => pdfTargetKey(option.target) === targetKey) ?? options[0];
  const selectedKey = selected ? pdfTargetKey(selected.target) : "";
  const brandingTarget = logoPosition === "cover"
    ? coverSample
    : saved?.targets.find(({ target }) => target.kind === "reviewModule")?.target ?? scoreSample;
  const outlineLabel = (option: PdfTargetOption) => {
    if (option.target.kind !== "reviewModule") return option.label;
    const { sectionKey } = option.target;
    const subject = options.find(({ target }) => target.kind === "reviewSubject" && target.sectionKey === sectionKey);
    return subject ? subject.label + " · " + option.label : option.label;
  };
  const selectTarget = (key: string, slideId?: string) => {
    setTargetKey(key);
    setSelectedSlideId(slideId ?? null);
    const target = options.find((option) => pdfTargetKey(option.target) === key)?.target;
    if (target?.kind === "reviewModule" || target?.kind === "reviewSubject") {
      setCollapsed((previous) => {
        const next = new Set(previous);
        next.delete("examReview");
        if (target.kind === "reviewModule") next.delete(pdfTargetKey({ kind: "reviewSubject", sectionKey: target.sectionKey }));
        return next;
      });
    }
    setOpenImageSettings(null);
    setMove(null);
    if (window.matchMedia("(max-width: 767px)").matches) {
      requestAnimationFrame(() => placementHeading.current?.focus());
    }
  };
  const assetIds = new Set([
    ...(draft?.slides.map((page) => page.assetId) ?? []),
    ...Object.values(draft?.logos ?? {}).flatMap((logo) => logo ? [logo.assetId] : []),
  ]);
  const total = Array.from(assetIds).reduce((sum, id) => sum + (assets[id]?.bytes ?? 0), 0);
  const invalid = total > maxLayoutBytes || [...expired, ...missing].some((id) => assetIds.has(id)) ||
    Boolean(draft?.slides.some((slide) => !slide.description.trim()));
  const changeOrder = (page: PdfSlide, other: PdfSlide | undefined) => {
    if (!draft || !other) return;
    const slides = [...draft.slides];
    const from = slides.findIndex((slide) => slide.id === page.id);
    const to = slides.findIndex((slide) => slide.id === other.id);
    [slides[from], slides[to]] = [other, page];
    edit({ ...draft, slides }, "Image page moved.");
    focusRow(page.id);
  };

  const activeSlide = draft?.slides.find((slide) => slide.id === selectedSlideId && pdfTargetKey(slide.target) === selectedKey);
  const siblings = activeSlide ? draft?.slides.filter((slide) => bucket(slide) === bucket(activeSlide)) ?? [] : [];
  const position = siblings.findIndex((slide) => slide.id === selectedSlideId);
  const imageName = (slide: PdfSlide) => assets[slide.assetId]?.filename ?? "Image page";
  const selectUpload = (side: PdfSide, origin: HTMLElement) => {
    if (!selected) return;
    operationOrigin.current = origin;
    setUpload({ kind: "slide", option: selected, side });
  };
  const toggleCollapsed = (key: string) => {
    const target = selected?.target;
    if (!collapsed.has(key) && (
      (key === "examReview" && (target?.kind === "reviewSubject" || target?.kind === "reviewModule")) ||
      (target?.kind === "reviewModule" && key === pdfTargetKey({ kind: "reviewSubject", sectionKey: target.sectionKey }))
    )) selectTarget(key);
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const thumb = (assetId: string, description: string) => (
    expired.includes(assetId) ? <span className="text-sm text-destructive">Image unavailable</span>
      : missing.includes(assetId) ? (
        <SatButton variant="quiet" onClick={() => setMissing((ids) => ids.filter((id) => id !== assetId))}>Retry image</SatButton>
      ) : (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- onError reports a failed thumbnail request.
        <img className="absolute inset-0 h-full w-full bg-white object-contain"
          src={api.imageUrl(examId, assetId)} alt={description}
          onError={() => setMissing((ids) => ids.includes(assetId) ? ids : [...ids, assetId])} />
      )
  );

  const canSave = dirty && writable && !invalid && !saving && !conflict && !upload && !loading && !loadError;
  const uploadPanel = upload && writable && draft ? (
    <aside className="min-w-0 rounded-xl border border-border bg-background p-4" aria-label={upload.kind === "logo" ? "Upload a logo" : "Upload an image page"}>
      <PdfLayoutImageForm
          uploadImage={api.upload}
          examId={examId}
          title={upload.kind === "logo" ? "Replace " + slots[upload.slot].toLowerCase() : upload.existing ? "Replace slide image" : "Add image " + upload.side + " " + upload.option.label}
          purpose={upload.kind === "logo" ? "logo" : "slide"}
          placementNote={upload.kind === "slide" && ["scoreReport", "answerKey"].includes(upload.option.target.kind)
            ? "This image page appears only when the " + upload.option.label.toLowerCase() + " is released to the student."
            : undefined}
          description={upload.kind === "logo" ? draft.logos[upload.slot]?.description ?? "" : upload.existing?.description ?? ""}
          requireDescription={upload.kind === "slide" || upload.slot === "cover"}
          onCancel={closePanel}
          onUploaded={uploaded}
          onDenied={onDenied}
        />
    </aside>
  ) : null;

  return (
    <section ref={workspaceRef} aria-labelledby="sat-pdf-editor-title"
      className="sat-product min-h-dvh bg-[var(--sat-staff-canvas,#f7f7f8)] text-foreground md:grid md:h-dvh md:grid-rows-[auto_minmax(0,1fr)]">
      <header className="sticky top-0 z-10 border-b border-border bg-background">
        <div className="mx-auto max-w-[1440px] space-y-2 px-4 py-2 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0">
            <SatButton ref={backButton} variant="quiet" icon={<ArrowLeft />} onClick={onBack}>Back to settings</SatButton>
            <div>
              <h1 id="sat-pdf-editor-title" className="text-lg font-semibold">PDF editor</h1>
              <p className="text-sm text-muted-foreground">{examTitle}</p>
            </div>
          </div>
          {draft ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1" role="group" aria-label="PDF layout editor section">
                <SatButton variant={tab === "pages" && !preview ? "secondary" : "quiet"} aria-pressed={tab === "pages" && !preview} disabled={Boolean(upload)}
                  onClick={() => { setPreview(false); setTab("pages"); }}>Page order</SatButton>
                <SatButton variant={tab === "branding" && !preview ? "secondary" : "quiet"} aria-pressed={tab === "branding" && !preview} disabled={Boolean(upload)}
                  onClick={() => { setPreview(false); setTab("branding"); }}>Logos &amp; watermarks</SatButton>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="w-full text-sm text-muted-foreground sm:w-auto" role="status">{status || (dirty ? "Unsaved changes" : !writable ? "View only" : "All changes saved")}</p>
                {preview ? (
                  <SatButton variant="secondary" onClick={closePanel}>Back to editing</SatButton>
                ) : (
                  <SatButton variant="secondary" disabled={Boolean(upload) || saving || (writable && invalid)} aria-label="Preview PDF"
                    onClick={(event) => { operationOrigin.current = event.currentTarget; setPreview(true); }}>Preview PDF</SatButton>
                )}
                {writable ? <SatButton variant="primary" disabled={!canSave} onClick={() => void save()}>{saving ? "Saving…" : "Save layout"}</SatButton> : null}
              </div>
            </div>
          ) : null}
        </div>
      </header>
      <div className="min-w-0 md:overflow-y-auto">
        <div className="mx-auto max-w-[1440px] space-y-4 p-4 sm:px-6 sm:py-5">
          {leave ? (
            <section className="space-y-2 rounded-xl border border-border bg-background p-4" aria-labelledby="pdf-leave-title">
              <h2 ref={leaveHeading} id="pdf-leave-title" tabIndex={-1} className="font-semibold">Leave the PDF editor?</h2>
              <p className="text-sm text-muted-foreground">{upload ? "An image upload is in progress or waiting for a file." : "Your PDF layout has unsaved changes."}</p>
              <div className="flex flex-wrap gap-2">
                <SatButton variant="secondary" disabled={saving} onClick={() => { leave.stay(); backButton.current?.focus(); }}>Keep editing</SatButton>
                {writable ? <SatButton variant="primary" disabled={!canSave} onClick={() => void save(leave.proceed)}>Save and leave</SatButton> : null}
                <SatButton variant="danger-secondary" disabled={saving} onClick={leave.proceed}>Discard changes</SatButton>
              </div>
            </section>
          ) : null}
          {confirmReload ? (
            <section className="space-y-2 rounded-xl border border-border bg-background p-4" aria-labelledby="pdf-reload-title">
              <h2 id="pdf-reload-title" className="font-semibold">Discard edits and load the latest layout?</h2>
              <p className="text-sm text-muted-foreground">The latest saved layout will replace your draft.</p>
              <div className="flex flex-wrap gap-2">
                <SatButton variant="secondary" onClick={() => setConfirmReload(false)}>Keep editing</SatButton>
                <SatButton variant="primary" onClick={() => { setConfirmReload(false); void reload(); }}>Load latest layout</SatButton>
              </div>
            </section>
          ) : null}
          {loading ? <p role="status">Loading layout…</p> : null}
          {loadError ? (
            <div className="space-y-3">
              <p role="alert" className="text-destructive">{loadError}</p>
              <SatButton variant="secondary" onClick={() => void reload()}>Retry</SatButton>
              {draft ? <SatButton variant="secondary" onClick={() => setLoadError("")}>Review my edits</SatButton> : null}
            </div>
          ) : null}
          {conflict ? (
            <div className="flex flex-wrap gap-2">
              <SatButton variant="secondary" onClick={() => workspaceRef.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.focus()}>Review my edits</SatButton>
              <SatButton variant="secondary" onClick={() => setConfirmReload(true)}>Load latest layout</SatButton>
            </div>
          ) : null}
          {error ? <p tabIndex={-1} data-pdf-error role="alert" className="text-sm text-destructive">{error}</p> : null}
          {total > maxLayoutBytes ? <p role="alert" className="text-sm text-destructive">Reduce the layout to 6 MiB of images before saving.</p> : null}
          {!loading && !loadError && draft ? (
            preview ? (
              <PdfLayoutPreview previewLayout={api.preview} examId={examId} layout={writable ? draft : undefined} onDenied={onDenied} />
            ) : tab === "branding" ? (
            <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
              <ul className="divide-y divide-border rounded-xl border border-border bg-background">
                {(Object.keys(slots) as PdfLogoSlot[]).map((slot) => {
                  const logo = draft.logos[slot];
                  return (
                    <li key={slot} className="space-y-2 p-3">
                      <button type="button" aria-pressed={logoPosition === slot} disabled={Boolean(upload)}
                        className="min-h-11 w-full rounded-md px-2 text-left font-semibold aria-pressed:bg-muted"
                        onClick={() => setLogoPosition(slot)}>{slots[slot]}</button>
                      <div className="flex flex-wrap items-center justify-between gap-2 px-2">
                        <p className="break-words text-sm text-muted-foreground">{logo ? assets[logo.assetId]?.filename ?? "Custom image" : "Default image"}</p>
                        {writable ? (
                          <div className="flex flex-wrap gap-2">
                            <SatButton variant="secondary" disabled={Boolean(upload) || saving} aria-label={"Replace " + slots[slot].toLowerCase()}
                              onClick={(event) => { operationOrigin.current = event.currentTarget; setLogoPosition(slot); setUpload({ kind: "logo", slot }); }}>Replace</SatButton>
                            {logo ? <SatButton variant="quiet" disabled={Boolean(upload) || saving} aria-label={"Restore " + slots[slot].toLowerCase() + " default"} onClick={() => {
                              setLogoPosition(slot);
                              edit({ ...draft, logos: { ...draft.logos, [slot]: null } }, slots[slot] + " restored in this draft.");
                              requestAnimationFrame(() => workspaceRef.current?.querySelector<HTMLElement>(`[aria-label="Replace ${slots[slot].toLowerCase()}"]`)?.focus());
                            }}>Restore default</SatButton> : null}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="min-w-0 space-y-4">
                <section className="rounded-xl border border-border bg-muted/50 p-4" aria-label="Branding position">
                  <h2 className="font-semibold">{slots[logoPosition]} position</h2>
                  <p className="text-sm text-muted-foreground">{slotLocations[logoPosition]}</p>
                  <div className="mx-auto mt-4 max-w-[46rem]">
                    <PdfSectionSample target={brandingTarget} label={slots[logoPosition]} samples={samples} />
                  </div>
                </section>
                {uploadPanel}
              </div>
            </div>
          ) : selected ? (
            <div className={"grid min-w-0 items-start gap-4 md:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)] " +
              (uploadPanel ? "lg:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)_minmax(16rem,21rem)]" : "")}>
              <nav className="min-w-0 rounded-xl border border-border bg-background" aria-label="PDF outline">
                <div className="px-4 pb-2 pt-3">
                  <h3 ref={outlineHeading} tabIndex={-1} className="font-semibold">PDF pages</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Select a section or an image in PDF order.</p>
                </div>
                <PdfPageStrip items={orderedPdfItems(options, draft.slides, knownTargets, collapsed)}
                  selectedKey={selectedKey} selectedSlideId={selectedSlideId} collapsed={collapsed} label={outlineLabel}
                  assetLabel={imageName} imageUrl={(slide) => missing.includes(slide.assetId) || expired.includes(slide.assetId) ? undefined : api.imageUrl(examId, slide.assetId)}
                  disabled={Boolean(upload)} onSelect={selectTarget} onToggle={toggleCollapsed} />
              </nav>
              <section className="min-w-0 rounded-xl border border-border bg-muted/50 p-3 sm:p-5" aria-label={selected.label + " image pages"}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 ref={placementHeading} tabIndex={-1} className="break-words text-lg font-semibold">{activeSlide ? imageName(activeSlide) : outlineLabel(selected)}</h3>
                    {activeSlide ? (
                      <p className="text-sm text-muted-foreground">{activeSlide.side === "before" ? "Before " : "After "}{outlineLabel(selected)}</p>
                    ) : !knownTargets.has(selectedKey) ? (
                      <p className="text-sm text-muted-foreground">This section is unavailable in the current exam.</p>
                    ) : null}
                  </div>
                  <button type="button" className="min-h-11 rounded-lg px-2 text-sm underline md:hidden" onClick={() => outlineHeading.current?.focus()}>Back to pages</button>
                </div>
                <div className="mx-auto mt-4 max-w-[32rem] space-y-3">
                  {!activeSlide && writable && knownTargets.has(selectedKey) ? (
                    <div className="flex items-center gap-2">
                      <span className="h-px flex-1 bg-border" aria-hidden="true" />
                      <SatButton variant="secondary" icon={<Plus />} disabled={Boolean(upload) || saving || draft.slides.length >= 8} data-add-side="before"
                        aria-label={"Add image before " + selected.label} onClick={(event) => selectUpload("before", event.currentTarget)}>Add image before</SatButton>
                      <span className="h-px flex-1 bg-border" aria-hidden="true" />
                    </div>
                  ) : null}
                  {activeSlide && !upload ? (
                    <div className="space-y-3 rounded-lg border border-border bg-background p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {writable && siblings.length > 1 ? (
                          <>
                            <SatButton variant="quiet" icon={<ArrowUp />} disabled={saving || position === 0} onClick={() => changeOrder(activeSlide, siblings[position - 1])}>Move up</SatButton>
                            <SatButton variant="quiet" icon={<ArrowDown />} disabled={saving || position === siblings.length - 1} onClick={() => changeOrder(activeSlide, siblings[position + 1])}>Move down</SatButton>
                          </>
                        ) : null}
                        {writable ? (
                          <SatButton variant="secondary" disabled={saving} onClick={() => setMove({
                            slide: activeSlide, target: knownTargets.has(selectedKey) ? selectedKey : "cover", side: activeSlide.side,
                          })}>Change placement</SatButton>
                        ) : null}
                        <SatButton variant="quiet" aria-expanded={openImageSettings === activeSlide.id}
                          onClick={() => setOpenImageSettings(openImageSettings === activeSlide.id ? null : activeSlide.id)}>{writable ? "Image settings" : "Image description"}</SatButton>
                      </div>
                      {move?.slide.id === activeSlide.id && writable ? (
                        <div className="grid gap-2 border-t border-border pt-3">
                          <label className="text-sm" htmlFor="pdf-move-target">PDF section
                            <select id="pdf-move-target" className={pdfInputClass} value={move.target} onChange={(event) => setMove({ ...move, target: event.currentTarget.value })}>
                              {saved?.targets.map((option) => <option key={pdfTargetKey(option.target)} value={pdfTargetKey(option.target)}>{outlineLabel(option)}</option>)}
                            </select>
                          </label>
                          <label className="text-sm" htmlFor="pdf-move-side">Position
                            <select id="pdf-move-side" className={pdfInputClass} value={move.side} onChange={(event) => setMove({ ...move, side: event.currentTarget.value === "before" ? "before" : "after" })}>
                              <option value="before">Before</option><option value="after">After</option>
                            </select>
                          </label>
                          <div className="flex gap-2">
                            <SatButton variant="secondary" onClick={() => setMove(null)}>Cancel</SatButton>
                            <SatButton variant="primary" disabled={saving || (move.target === selectedKey && move.side === activeSlide.side)} onClick={() => {
                              const option = saved?.targets.find((candidate) => pdfTargetKey(candidate.target) === move.target);
                              if (!option) return;
                              edit({ ...draft, slides: [...draft.slides.filter((slide) => slide.id !== activeSlide.id), { ...activeSlide, target: option.target, side: move.side }] },
                                "Image page moved " + move.side + " " + option.label + ".");
                              selectTarget(move.target, activeSlide.id);
                              focusRow(activeSlide.id);
                            }}>Move page</SatButton>
                          </div>
                        </div>
                      ) : null}
                      {openImageSettings === activeSlide.id ? (
                        <div className="space-y-3 border-t border-border pt-3">
                          <label className="block space-y-1 text-sm" htmlFor="pdf-image-description">
                            <span>Image description</span>
                            <textarea id="pdf-image-description" aria-label="Image description" className={pdfInputClass} rows={2} maxLength={240} disabled={!writable || saving} value={activeSlide.description}
                              onChange={(event) => {
                                const description = event.currentTarget.value;
                                edit({ ...draft, slides: draft.slides.map((slide) => slide.id === activeSlide.id ? { ...slide, description } : slide) });
                              }} />
                          </label>
                          {writable ? (
                            <div className="flex flex-wrap gap-2">
                              <SatButton variant="secondary" disabled={Boolean(upload) || saving} aria-label={"Replace image " + imageName(activeSlide)}
                                onClick={(event) => { operationOrigin.current = event.currentTarget; setUpload({ kind: "slide", option: selected, side: activeSlide.side, existing: activeSlide }); }}>Replace image</SatButton>
                              <SatButton variant="danger-secondary" disabled={saving} onClick={() => {
                                setRemoved({ slide: activeSlide, index: draft.slides.findIndex((slide) => slide.id === activeSlide.id) });
                                edit({ ...draft, slides: draft.slides.filter((slide) => slide.id !== activeSlide.id) }, "Image page removed.");
                                selectTarget(selectedKey);
                                requestAnimationFrame(() => placementHeading.current?.focus());
                              }}>Remove</SatButton>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {activeSlide ? (
                    <div className="relative mx-auto grid aspect-[297/210] w-full place-items-center overflow-hidden rounded-md border border-border bg-background text-center shadow-sm"
                      style={{ maxWidth: "clamp(18.4rem, calc(141.4dvh - 33.94rem), 43.8rem)" }}>
                      {thumb(activeSlide.assetId, activeSlide.description)}
                    </div>
                  ) : knownTargets.has(selectedKey) ? (
                    <PdfSectionSample target={selected.target} label={outlineLabel(selected)} samples={samples} />
                  ) : null}
                  {!activeSlide && writable && knownTargets.has(selectedKey) ? (
                    <div className="flex items-center gap-2">
                      <span className="h-px flex-1 bg-border" aria-hidden="true" />
                      <SatButton variant="secondary" icon={<Plus />} disabled={Boolean(upload) || saving || draft.slides.length >= 8} data-add-side="after"
                        aria-label={"Add image after " + selected.label} onClick={(event) => selectUpload("after", event.currentTarget)}>Add image after</SatButton>
                      <span className="h-px flex-1 bg-border" aria-hidden="true" />
                    </div>
                  ) : null}
                  {!knownTargets.has(selectedKey) ? (
                    <p className="text-sm text-muted-foreground">Move attached images to an available section to include them in new PDFs.</p>
                  ) : ["scoreReport", "answerKey"].includes(selected.target.kind) ? (
                    <p className="text-sm text-muted-foreground">This section and its image pages appear only when released to the student.</p>
                  ) : ["reviewSubject", "reviewModule"].includes(selected.target.kind) ? (
                    <p className="text-sm text-muted-foreground">This section and its images appear when the student takes this part of the exam.</p>
                  ) : null}
                  {removed && writable ? <SatButton variant="secondary" disabled={Boolean(upload) || saving || draft.slides.length >= 8} onClick={() => {
                    const slides = [...draft.slides];
                    slides.splice(removed.index, 0, removed.slide);
                    edit({ ...draft, slides }, "Image page restored.");
                    selectTarget(pdfTargetKey(removed.slide.target), removed.slide.id);
                    setRemoved(null);
                    focusRow(removed.slide.id);
                  }}>Undo remove</SatButton> : null}
                  {draft.slides.length >= 8 ? <p className="text-sm text-muted-foreground">This layout has 8 image pages.</p> : null}
                </div>
              </section>
              {uploadPanel ? <div className="min-w-0 md:col-start-2 lg:col-start-auto">{uploadPanel}</div> : null}
            </div>
          ) : null
          ) : null}
        </div>
      </div>
    </section>
  );
}
