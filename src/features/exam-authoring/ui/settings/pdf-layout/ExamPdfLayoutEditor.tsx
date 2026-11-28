import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  pdfTargetKey,
  type PdfLayout,
  type PdfLayoutAsset,
  type PdfLayoutEditorData,
  type PdfLogoSlot,
  type PdfSide,
  type PdfSlide,
  type PdfTarget,
  type PdfTargetOption,
} from "@shared/sat/pdfLayout";
import { Eye, Plus, RotateCcw } from "lucide-react";
import { ApiError } from "@shared/api-client/errors";
import { SatButton, SatSectionHeader, SatStatusPill, type SatStatusTone } from "../../../../../products/sat/ui/SatPage";
import { SatSegmentedControl } from "../../../../../products/sat/ui/SegmentedControl";
import { useOptionalAuthSession } from "../../../../auth/api/authSession";
import { AuthoringConfirmDialog, AuthoringDialog } from "../../authoringPrimitives";
import { satPdfLayoutApi, type SatPdfLayoutApi } from "../../../api/satPdfLayoutApi";
import { PdfInspector } from "./PdfInspector";
import { PdfLayoutImageForm, pdfErrorMessage } from "./PdfLayoutImageForm";
import { PdfLayoutPreviewDialog } from "./PdfLayoutPreview";
import { PdfPaperStage, type PdfZoom } from "./PdfPaperStage";
import { orderedPdfItems, PdfReportOutline } from "./PdfReportOutline";
import { usePdfSampleBook, useSectionSample } from "./PdfSectionSample";
import {
  slideCountLabel,
  slidePlacementLabel,
  targetCondition,
  targetConditionDetail,
  unavailableTargetLabel,
} from "./pdfLayoutLabels";

const MAX_SLIDES = 8;
const MAX_LAYOUT_BYTES = 6 * 1024 * 1024;

const slots: Record<PdfLogoSlot, string> = {
  cover: "Cover logo",
  leftWatermark: "Left watermark",
  rightWatermark: "Right watermark",
};

const slotLocations: Record<PdfLogoSlot, string> = {
  cover: "On the cover page",
  leftWatermark: "Small, repeated marks on the left of each page",
  rightWatermark: "One large mark on the right of each page",
};

type EditImage =
  | { kind: "slide"; option: PdfTargetOption; target: PdfTarget; side: PdfSide; existing?: PdfSlide; file?: File | undefined }
  | { kind: "logo"; slot: PdfLogoSlot; file?: File | undefined };

const bucket = (slide: PdfSlide) => pdfTargetKey(slide.target) + ":" + slide.side;

function layoutSignature(layout: PdfLayout) {
  const slides = [...layout.slides].sort((a, b) => bucket(a).localeCompare(bucket(b)));
  return JSON.stringify({ slides, logos: layout.logos });
}

function formatSavedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ExamPdfLayoutEditor({
  examId,
  examTitle,
  canEdit,
  onDirtyChange,
  onBack,
  leave,
  api = satPdfLayoutApi,
}: {
  examId: string;
  examTitle: string;
  canEdit: boolean;
  onDirtyChange: (value: boolean) => void;
  onBack: () => void;
  leave?: { stay: () => void; proceed: () => void } | undefined;
  api?: SatPdfLayoutApi | undefined;
}) {
  const [saved, setSaved] = useState<PdfLayoutEditorData | null>(null);
  const [draft, setDraft] = useState<PdfLayout | null>(null);
  const [assets, setAssets] = useState<Record<string, PdfLayoutAsset>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
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
  const [move, setMove] = useState<{ slide: PdfSlide; target: string; side: PdfSide } | null>(null);
  const [removed, setRemoved] = useState<{ slide: PdfSlide; index: number } | null>(null);
  const [zoom, setZoom] = useState<PdfZoom>("fit");
  const [dragSlideId, setDragSlideId] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [sampleGeneration, setSampleGeneration] = useState(0);
  const request = useRef<AbortController | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const operationOrigin = useRef<HTMLElement | null>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const outlineHeading = useRef<HTMLHeadingElement>(null);
  const placementHeading = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(["examReview"]));
  const authSession = useOptionalAuthSession();

  const dirty = Boolean(saved && draft && layoutSignature(saved.layout) !== layoutSignature(draft));
  const writable = canEdit && !accessLost;
  const draftLogos = draft?.logos;

  const acceptLayout = useCallback((value: PdfLayoutEditorData) => {
    setSaved(value);
    setSampleGeneration((previous) => previous + 1);
    setDraft(value.layout);
    setAssets(Object.fromEntries(value.assets.map((asset) => [asset.id, asset])));
    setConflict(false);
    setExpired([]);
    setMissing([]);
    setRemoved(null);
    setSelectedSlideId((id) => (value.layout.slides.some((slide) => slide.id === id) ? id : null));
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
        setAnnouncement("");
        setTargetKey("cover");
        setSelectedSlideId(null);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setLoadError(pdfErrorMessage(cause, "Couldn’t load this layout."));
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

  const onDenied = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && (cause.status === 403 || cause.status === 401)) {
      setAccessLost(true);
      setError("You no longer have edit access to this layout.");
    }
  }, []);

  const edit = (next: PdfLayout, message?: string) => {
    setDraft(next);
    setError("");
    setAnnouncement(message ?? "");
  };

  const options = useMemo<PdfTargetOption[]>(() => {
    const list: PdfTargetOption[] = [...(saved?.targets ?? [])];
    const known = new Set(list.map((option) => pdfTargetKey(option.target)));
    for (const slide of draft?.slides ?? []) {
      const key = pdfTargetKey(slide.target);
      if (known.has(key)) continue;
      known.add(key);
      list.push({ target: slide.target, label: unavailableTargetLabel(slide.target) });
    }
    return list;
  }, [draft, saved]);

  const knownTargets = useMemo(() => new Set((saved?.targets ?? []).map((option) => pdfTargetKey(option.target))), [saved]);
  const selected = options.find((option) => pdfTargetKey(option.target) === targetKey) ?? options[0];
  const selectedKey = selected ? pdfTargetKey(selected.target) : "";
  const outlineLabel = useCallback(
    (option: PdfTargetOption) => {
      if (option.target.kind !== "reviewModule") return option.label;
      const { sectionKey } = option.target;
      const subject = options.find(
        ({ target }) => target.kind === "reviewSubject" && target.sectionKey === sectionKey,
      );
      return subject ? subject.label + " · " + option.label : option.label;
    },
    [options],
  );
  const conditionFor = useCallback(
    (option: PdfTargetOption) => (knownTargets.has(pdfTargetKey(option.target)) ? targetCondition(option.target) : null),
    [knownTargets],
  );
  const conditionDetailFor = useCallback(
    (option: PdfTargetOption) =>
      knownTargets.has(pdfTargetKey(option.target)) ? targetConditionDetail(option.target) : null,
    [knownTargets],
  );

  const activeSlide = draft?.slides.find((slide) => slide.id === selectedSlideId && pdfTargetKey(slide.target) === selectedKey);
  const siblings = activeSlide ? draft?.slides.filter((slide) => bucket(slide) === bucket(activeSlide)) ?? [] : [];
  const position = siblings.findIndex((slide) => slide.id === selectedSlideId);
  const imageName = (slide: PdfSlide) => assets[slide.assetId]?.filename ?? "Slide";
  const assetIds = useMemo(
    () => [
      ...(draft?.slides.map((page) => page.assetId) ?? []),
      ...Object.values(draft?.logos ?? {}).flatMap((logo) => (logo ? [logo.assetId] : [])),
    ],
    [draft],
  );
  const totalBytes = assetIds.reduce((sum, id) => sum + (assets[id]?.bytes ?? 0), 0);

  const invalidReasons = useMemo(() => {
    const reasons: string[] = [];
    if (totalBytes > MAX_LAYOUT_BYTES) reasons.push("This layout uses more than 6 MB of images. Remove a slide to save it.");
    const undescribed = draft?.slides.find((slide) => !slide.description.trim());
    if (undescribed) reasons.push("Give every slide a description so screen readers can read it.");
    const broken = [...expired, ...missing].filter((id) => assetIds.includes(id));
    if (broken.length > 0) reasons.push("Replace the image that could not be loaded before saving.");
    if ((draft?.slides.length ?? 0) > MAX_SLIDES) reasons.push("This layout has more than 8 slides.");
    return reasons;
  }, [assetIds, draft, expired, missing, totalBytes]);

  const canSave = dirty && writable && invalidReasons.length === 0 && !saving && !conflict && !upload && !loading && !loadError;

  const sampleLayout = useMemo(
    () => (writable && draftLogos ? { slides: [], logos: draftLogos } : undefined),
    [draftLogos, writable],
  );
  const samples = usePdfSampleBook({
    enabled: tab === "pages" && Boolean(saved) && !loading && !accessLost,
    identity: JSON.stringify([examId, sampleGeneration, writable, draftLogos]),
    examId,
    layout: sampleLayout,
    previewLayout: api.preview,
    onDenied,
  });
  const brandingTarget = useMemo<PdfTarget>(() => {
    if (logoPosition === "cover") return { kind: "cover" };
    return saved?.targets.find(({ target }) => target.kind === "reviewModule")?.target ?? { kind: "cover" };
  }, [logoPosition, saved]);
  const brandingSample = useSectionSample({
    enabled: tab === "branding" && Boolean(saved) && !loading && !accessLost,
    identity: JSON.stringify([examId, sampleGeneration, writable, draftLogos, logoPosition]),
    examId,
    layout: sampleLayout,
    target: brandingTarget,
    previewLayout: api.preview,
    onDenied,
  });

  async function save(afterSave?: () => void) {
    if (!saved || !draft || request.current || !dirty || !writable || conflict) return;
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    setError("");
    setAnnouncement("");
    try {
      const value = await api.save(examId, saved.revision, draft, controller.signal);
      if (!controller.signal.aborted) {
        acceptLayout(value);
        setAnnouncement("Layout saved. New PDFs use this layout.");
        afterSave?.();
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      onDenied(cause);
      if (cause instanceof ApiError && cause.status === 409) {
        setConflict(true);
        setAnnouncement("Another person changed this layout.");
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
  }

  const restoreActionFocus = () => {
    requestAnimationFrame(() => {
      const origin = operationOrigin.current;
      const equivalent = origin?.getAttribute("aria-label");
      if (origin?.isConnected) origin.focus();
      else if (equivalent) {
        const matching = [...(workspaceRef.current?.querySelectorAll<HTMLElement>("[aria-label]") ?? [])].find(
          (element) => element.getAttribute("aria-label") === equivalent,
        );
        matching?.focus();
      }
    });
  };

  const closePanel = () => {
    setUpload(null);
    restoreActionFocus();
  };

  const focusRow = (id: string) => {
    requestAnimationFrame(() => {
      document.getElementById("pdf-slide-" + id)?.focus();
    });
  };

  const selectTarget = (key: string, slideId?: string) => {
    setTargetKey(key);
    setSelectedSlideId(slideId ?? null);
    const target = options.find((option) => pdfTargetKey(option.target) === key)?.target;
    if (target?.kind === "reviewModule" || target?.kind === "reviewSubject") {
      setCollapsed((previous) => {
        const next = new Set(previous);
        next.delete("examReview");
        if (target.kind === "reviewModule") {
          next.delete(pdfTargetKey({ kind: "reviewSubject", sectionKey: target.sectionKey }));
        }
        return next;
      });
    }
    setMove(null);
    setOutlineOpen(false);
  };

  const toggleCollapsed = (key: string) => {
    const target = selected?.target;
    if (
      !collapsed.has(key) &&
      ((key === "examReview" && (target?.kind === "reviewSubject" || target?.kind === "reviewModule")) ||
        (target?.kind === "reviewModule" &&
          key === pdfTargetKey({ kind: "reviewSubject", sectionKey: target.sectionKey })))
    ) {
      selectTarget(key);
    }
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openUpload = (next: EditImage, origin?: HTMLElement | null) => {
    if (!writable) return;
    if (origin) operationOrigin.current = origin;
    setUpload(next);
  };

  const uploaded = (
    asset: PdfLayoutAsset,
    placement: { description: string; target: PdfTarget; side: PdfSide },
  ) => {
    if (!draft || !upload || !writable) return;
    setAssets((value) => ({ ...value, [asset.id]: asset }));
    if (upload.kind === "logo") {
      const logo = { assetId: asset.id, ...(placement.description ? { description: placement.description } : {}) };
      edit({ ...draft, logos: { ...draft.logos, [upload.slot]: logo } }, slots[upload.slot] + " updated in the draft.");
      restoreActionFocus();
    } else {
      const slide: PdfSlide = {
        id: upload.existing?.id ?? crypto.randomUUID(),
        assetId: asset.id,
        description: placement.description,
        target: placement.target,
        side: placement.side,
      };
      const slides = upload.existing
        ? draft.slides.map((old) => (old.id === slide.id ? slide : old))
        : [...draft.slides, slide];
      const option = options.find((candidate) => pdfTargetKey(candidate.target) === pdfTargetKey(placement.target));
      edit(
        { ...draft, slides },
        "Slide added " + placement.side + " " + (option ? outlineLabel(option) : "this section") + ".",
      );
      selectTarget(pdfTargetKey(placement.target), slide.id);
      focusRow(slide.id);
    }
    setUpload(null);
  };

  function removeSlide(slide: PdfSlide) {
    if (!draft || !writable) return;
    setRemoved({ slide, index: draft.slides.findIndex((item) => item.id === slide.id) });
    edit({ ...draft, slides: draft.slides.filter((item) => item.id !== slide.id) }, "Slide removed.");
    selectTarget(selectedKey);
  }

  const undoRemove = () => {
    if (!draft || !removed) return;
    const slides = [...draft.slides];
    slides.splice(removed.index, 0, removed.slide);
    edit({ ...draft, slides }, "Slide restored.");
    selectTarget(pdfTargetKey(removed.slide.target), removed.slide.id);
    setRemoved(null);
    focusRow(removed.slide.id);
  };

  const changeOrder = (page: PdfSlide, other: PdfSlide | undefined) => {
    if (!draft || !other) return;
    const slides = [...draft.slides];
    const from = slides.findIndex((slide) => slide.id === page.id);
    const to = slides.findIndex((slide) => slide.id === other.id);
    if (from < 0 || to < 0) return;
    const moved = slides[from];
    const swapped = slides[to];
    if (!moved || !swapped) return;
    slides[from] = swapped;
    slides[to] = moved;
    edit({ ...draft, slides }, "Slide moved.");
    focusRow(page.id);
  };

  const resetLayout = () => {
    if (!draft || !writable) return;
    edit(
      { slides: [], logos: { cover: null, leftWatermark: null, rightWatermark: null } },
      "Layout reset to the default report.",
    );
    setResetOpen(false);
    setSelectedSlideId(null);
  };

  const saveRef = useRef(save);
  saveRef.current = save;
  const removeRef = useRef(removeSlide);
  removeRef.current = removeSlide;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveRef.current();
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (typing) return;
      if ((event.key === "Delete" || event.key === "Backspace") && activeSlide && writable) {
        event.preventDefault();
        removeRef.current(activeSlide);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const canAddSlide = writable && !upload && !saving && (draft?.slides.length ?? 0) < MAX_SLIDES;
  const slideCount = draft?.slides.length ?? 0;
  const replacedSlots = Object.values(draft?.logos ?? {}).filter(Boolean).length;
  const savedAt = formatSavedAt(saved?.updatedAt);
  const savedByMe = Boolean(saved?.updatedBy && authSession?.session?.user.id === saved.updatedBy);

  const statusTone: SatStatusTone = loading
    ? "neutral"
    : conflict
      ? "changes"
      : accessLost
        ? "invalidated"
        : dirty
          ? "changes"
          : (saved?.revision ?? 0) === 0
            ? "draft"
            : "published";
  const statusText = loading
    ? "Loading"
    : conflict
      ? "Someone else changed this layout"
      : !writable
        ? "View only"
        : dirty
          ? "Unsaved changes"
          : (saved?.revision ?? 0) === 0
            ? "Default layout"
            : "Saved · v" + (saved?.revision ?? 0);

  const sectionLabel = selected ? outlineLabel(selected) : "";
  const samplePage = samples.book?.pages[selectedKey];
  const stageHeading = activeSlide ? imageName(activeSlide) : sectionLabel;
  const stageSubheading = activeSlide
    ? slidePlacementLabel(activeSlide.side, sectionLabel)
    : selected
      ? knownTargets.has(selectedKey)
        ? "The printed page as it appears in the sample report"
        : "This section is no longer in the current exam"
      : null;
  const stageCaption = activeSlide
    ? samplePage
      ? "Prints " + activeSlide.side + " " + sectionLabel + " · sample page " + samplePage.number
      : "Prints " + activeSlide.side + " " + sectionLabel
    : samplePage
      ? "Sample page " + samplePage.number
      : null;

  const insertSlot = (side: PdfSide) => {
    if (!selected) return null;
    const at = side === "before" ? "before " + sectionLabel : "after " + sectionLabel;
    return (
      <button
        type="button"
        disabled={!canAddSlide}
        aria-label={"Add slide " + at}
        onClick={(event) => openUpload({ kind: "slide", option: selected, target: selected.target, side }, event.currentTarget)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));
          if (!file || !canAddSlide) return;
          openUpload({ kind: "slide", option: selected, target: selected.target, side, file });
        }}
        className="flex min-h-11 w-full items-center gap-3 rounded-[var(--sat-staff-radius-control,8px)] px-3 text-[14px] font-medium text-[var(--sat-staff-text-secondary,#515154)] transition-colors hover:bg-[var(--sat-staff-fill-faint,#7878800f)] hover:text-[var(--sat-staff-text-primary,#1d1d1f)] disabled:opacity-50"
      >
        <span className="h-px flex-1 bg-[var(--sat-staff-border-hairline,#0000000f)]" aria-hidden="true" />
        <span className="inline-flex items-center gap-1.5">
          <Plus size={15} aria-hidden="true" />
          Add slide {at}
        </span>
        <span className="h-px flex-1 bg-[var(--sat-staff-border-hairline,#0000000f)]" aria-hidden="true" />
      </button>
    );
  };

  const outlineItems = orderedPdfItems(options, draft?.slides ?? [], knownTargets, collapsed);

  return (
    <section
      ref={workspaceRef}
      aria-labelledby="sat-pdf-layout-title"
      className="sat-product bg-[var(--sat-staff-canvas,#f7f7f8)] text-[var(--sat-staff-text-primary,#1d1d1f)]"
    >
      <div className="mx-auto w-full max-w-[1240px] px-4 pb-16 pt-6 sm:px-6">
        <button
          ref={backButton}
          type="button"
          onClick={onBack}
          className="sat-btn sat-btn--quiet sat-press mb-3 -ml-3"
        >
          Back to settings
        </button>
        <SatSectionHeader
          title={<span id="sat-pdf-layout-title">Exam PDF layout</span>}
          description={
            "Slides and brand marks applied to every PDF prepared for " + examTitle + "."
          }
          actions={
            <>
              <SatStatusPill tone={statusTone}>{statusText}</SatStatusPill>
              <SatButton variant="secondary" icon={<Eye size={16} />} onClick={() => setPreview(true)}>
                Preview PDF
              </SatButton>
              {writable ? (
                <SatButton variant="primary" pending={saving} disabled={!canSave} onClick={() => void save()}>
                  Save layout
                </SatButton>
              ) : null}
            </>
          }
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
          <span>
            {slideCount} of {MAX_SLIDES} slides placed
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {replacedSlots} of 3 brand marks replaced
          </span>
          {savedAt && !dirty ? (
            <>
              <span aria-hidden="true">·</span>
              <span>Saved at {savedAt}{savedByMe ? " by you" : ""}</span>
            </>
          ) : null}
        </div>
        <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
          New PDFs use this layout. PDFs already prepared keep the version they were created with.
        </p>
        {invalidReasons.length > 0 ? (
          <p role="status" className="mt-3 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]">
            {invalidReasons[0]}
          </p>
        ) : null}
        <span role="status" className="sr-only">{announcement}</span>

        {leave ? (
          <div
            role="region"
            aria-labelledby="pdf-leave-title"
            className="mt-4 rounded-[var(--sat-staff-radius-card,16px)] border border-[var(--sat-staff-border-hairline,#0000000f)] bg-[var(--sat-staff-surface,#fff)] p-4"
          >
            <h2 id="pdf-leave-title" className="text-[length:var(--sat-staff-type-section-size,20px)] font-semibold leading-[var(--sat-staff-type-section-line,28px)] tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">
              Leave the exam PDF layout?
            </h2>
            <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
              {upload
                ? "An image upload is in progress or waiting for a file."
                : dirty
                  ? slideCountLabel(slideCount) +
                    " and " +
                    replacedSlots +
                    " replaced brand " +
                    (replacedSlots === 1 ? "mark" : "marks") +
                    " will be discarded."
                  : "Nothing is saved for this exam yet."}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <SatButton variant="secondary" disabled={saving} onClick={() => { leave.stay(); backButton.current?.focus(); }}>
                Keep editing
              </SatButton>
              {writable ? (
                <SatButton variant="primary" disabled={!canSave} onClick={() => void save(leave.proceed)}>
                  Save and leave
                </SatButton>
              ) : null}
              <SatButton variant="quiet" disabled={saving} onClick={leave.proceed}>
                Discard changes
              </SatButton>
            </div>
          </div>
        ) : null}

        {confirmReload ? (
          <div className="mt-4 rounded-[var(--sat-staff-radius-card,16px)] border border-[var(--sat-staff-border-hairline,#0000000f)] bg-[var(--sat-staff-surface,#fff)] p-4">
            <h2 className="text-[length:var(--sat-staff-type-section-size,20px)] font-semibold leading-[var(--sat-staff-type-section-line,28px)] tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">
              Discard your edits and load the latest layout?
            </h2>
            <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
              The saved layout replaces the changes you made in this tab.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <SatButton variant="secondary" onClick={() => setConfirmReload(false)}>Keep editing</SatButton>
              <SatButton variant="primary" onClick={() => { setConfirmReload(false); void reload(); }}>Load latest layout</SatButton>
            </div>
          </div>
        ) : null}

        {conflict ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[var(--sat-staff-radius-card,16px)] border border-[var(--sat-staff-warning-border,#d9770638)] bg-[var(--sat-staff-warning-tint,#d977061a)] p-4">
            <p className="min-w-0 flex-1 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]">
              <span className="font-semibold">Another person changed this layout.</span> Your edits are still here.
            </p>
            <SatButton variant="secondary" onClick={() => placementHeading.current?.focus()}>Review my edits</SatButton>
            <SatButton variant="primary" onClick={() => setConfirmReload(true)}>Load latest layout</SatButton>
          </div>
        ) : null}

        {error ? (
          <p tabIndex={-1} data-pdf-error role="alert" className="mt-4 text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">
            {error}
          </p>
        ) : null}
        {loadError ? (
          <div className="mt-4 space-y-3">
            <p role="alert" className="text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">{loadError}</p>
            <SatButton variant="secondary" onClick={() => void reload()}>Retry</SatButton>
            {draft ? <SatButton variant="quiet" onClick={() => setLoadError("")}>Review my edits</SatButton> : null}
          </div>
        ) : null}

        {loading ? (
          <p role="status" className="mt-6 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
            Loading the saved layout…
          </p>
        ) : null}

        {!loading && !loadError && draft ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[272px_minmax(0,1fr)_304px]">
            <div className="min-w-0">
              <button
                type="button"
                aria-expanded={outlineOpen}
                aria-label={(outlineOpen ? "Hide " : "Show ") + (tab === "pages" ? "report outline" : "brand marks")}
                onClick={() => setOutlineOpen((value) => !value)}
                className="flex min-h-11 w-full items-center justify-between rounded-[var(--sat-staff-radius-control,8px)] border border-[var(--sat-staff-border-hairline,#0000000f)] bg-[var(--sat-staff-surface,#fff)] px-3 text-[14px] font-semibold xl:hidden"
              >
                {tab === "pages" ? "Report outline" : "Brand marks"}
                <span className="text-[var(--sat-staff-text-tertiary,#6e6e73)]">{outlineOpen ? "Hide" : "Show"}</span>
              </button>
              <nav aria-label={tab === "pages" ? "Report outline" : "Brand marks"} className="mt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3
                    ref={outlineHeading}
                    tabIndex={-1}
                    className="text-[14px] font-semibold uppercase tracking-[0.04em] text-[var(--sat-staff-text-tertiary,#6e6e73)]"
                  >
                    {tab === "pages" ? "Report outline" : "Brand marks"}
                  </h3>
                  <SatSegmentedControl
                    label="Layout area"
                    value={tab}
                    options={[
                      { value: "pages", label: "Slides" },
                      { value: "branding", label: "Branding" },
                    ]}
                    onChange={(value) => {
                      setTab(value);
                      setOutlineOpen(false);
                    }}
                  />
                </div>
                {tab === "pages" ? (
                  <div className={"mt-3 " + (outlineOpen ? "" : "hidden") + " xl:block"}>
                    <PdfReportOutline
                      items={outlineItems}
                      selectedKey={selectedKey}
                      selectedSlideId={selectedSlideId}
                      collapsed={collapsed}
                      label={outlineLabel}
                      condition={conditionFor}
                      assetLabel={imageName}
                      imageUrl={(slide) =>
                        missing.includes(slide.assetId) || expired.includes(slide.assetId)
                          ? undefined
                          : api.imageUrl(examId, slide.assetId)
                      }
                      slideCount={(option) =>
                        draft.slides.filter((slide) => pdfTargetKey(slide.target) === pdfTargetKey(option.target)).length
                      }
                      disabled={Boolean(upload) || !writable}
                      onSelect={selectTarget}
                      onToggle={toggleCollapsed}
                      onAddSlide={(option) => openUpload({ kind: "slide", option, target: option.target, side: "after" })}
                      dragSlideId={dragSlideId}
                      onDragStartSlide={(slide) => setDragSlideId(slide.id)}
                      onDragOverSlide={() => undefined}
                      onDropSlide={(slide) => {
                        const dragged = dragSlideId ? draft.slides.find((item) => item.id === dragSlideId) : undefined;
                        setDragSlideId(null);
                        if (!dragged || dragged.id === slide.id) return;
                        if (bucket(dragged) !== bucket(slide)) return;
                        const slides = [...draft.slides];
                        const from = slides.findIndex((item) => item.id === dragged.id);
                        slides.splice(from, 1);
                        const insertAt = slides.findIndex((item) => item.id === slide.id);
                        slides.splice(insertAt, 0, dragged);
                        edit({ ...draft, slides }, "Slide moved.");
                        focusRow(dragged.id);
                      }}
                      onDragEndSlide={() => setDragSlideId(null)}
                    />
                  </div>
                ) : (
                  <ul className={"mt-3 space-y-1 " + (outlineOpen ? "" : "hidden") + " xl:block"}>
                    {(Object.keys(slots) as PdfLogoSlot[]).map((slot) => {
                      const logo = draft.logos[slot];
                      const selectedSlot = logoPosition === slot;
                      return (
                        <li key={slot}>
                          <button
                            type="button"
                            aria-current={selectedSlot ? "true" : undefined}
                            onClick={() => setLogoPosition(slot)}
                            className={
                              "flex w-full min-h-11 items-center gap-2 rounded-[var(--sat-staff-radius-control,8px)] px-2 py-1.5 text-left transition-colors " +
                              (selectedSlot
                                ? "bg-[var(--sat-staff-accent-tint,#0071e314)]"
                                : "hover:bg-[var(--sat-staff-fill-faint,#7878800f)]")
                            }
                          >
                            <span className="grid h-9 w-12 shrink-0 place-items-center overflow-hidden rounded-[4px] border border-[var(--sat-staff-border-hairline,#0000000f)] bg-white">
                              {logo && !missing.includes(logo.assetId) ? (
                                <img src={api.imageUrl(examId, logo.assetId)} alt="" className="h-full w-full object-contain" />
                              ) : (
                                <span className="px-1 text-center text-[11px] leading-3 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
                                  Default
                                </span>
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[14px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
                                {slots[slot]}
                              </span>
                              <span className="block truncate text-[13px] leading-4 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
                                {logo ? assets[logo.assetId]?.filename ?? "Custom image" : "Default mark"}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </nav>
            </div>

            {tab === "pages" ? (
              <div className="min-w-0">
                <PdfPaperStage
                  heading={stageHeading}
                  subheading={stageSubheading}
                  caption={stageCaption}
                  pageSrc={activeSlide ? undefined : samples.book?.pages[selectedKey]?.src}
                  pageAlt={activeSlide ? undefined : sectionLabel + " sample page"}
                  slideSrc={activeSlide ? api.imageUrl(examId, activeSlide.assetId) : undefined}
                  slideAlt={activeSlide ? activeSlide.description : undefined}
                  zoom={zoom}
                  onZoomChange={setZoom}
                  busy={samples.pending && !activeSlide}
                  error={samples.error}
                  onRetry={samples.retry}
                  before={insertSlot("before")}
                  after={insertSlot("after")}
                />
                {!canAddSlide && writable ? (
                  <p className="mt-3 text-center text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
                    You’ve used all {MAX_SLIDES} slides. Remove one to add another.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="min-w-0">
                <PdfPaperStage
                  heading={slots[logoPosition]}
                  subheading={slotLocations[logoPosition]}
                  caption={logoPosition === "cover" ? "Sample cover page" : "Sample review page"}
                  pageSrc={brandingSample.src}
                  pageAlt={slots[logoPosition] + " sample page"}
                  zoom={zoom}
                  onZoomChange={setZoom}
                  busy={brandingSample.pending}
                  error={brandingSample.error}
                  onRetry={brandingSample.retry}
                />
              </div>
            )}

            {tab === "pages" ? (
              <PdfInspector
                canEdit={writable}
                saving={saving}
                section={
                  selected
                    ? {
                        label: sectionLabel,
                        condition: conditionDetailFor(selected),
                        available: knownTargets.has(selectedKey),
                      }
                    : null
                }
                slide={activeSlide ?? null}
                slideName={activeSlide ? imageName(activeSlide) : ""}
                placement={activeSlide ? slidePlacementLabel(activeSlide.side, sectionLabel) : ""}
                description={activeSlide?.description ?? ""}
                descriptionError={
                  activeSlide && !activeSlide.description.trim()
                    ? "This slide needs a description before it can be saved."
                    : null
                }
                siblingCount={siblings.length}
                position={position}
                moveOpen={move?.slide.id === activeSlide?.id}
                moveTarget={move?.target ?? selectedKey}
                moveSide={move?.side ?? "before"}
                targets={saved?.targets ?? []}
                labelOf={outlineLabel}
                removedName={removed ? imageName(removed.slide) : null}
                onDescriptionChange={(value) => {
                  if (!draft || !activeSlide) return;
                  edit({
                    ...draft,
                    slides: draft.slides.map((slide) => (slide.id === activeSlide.id ? { ...slide, description: value } : slide)),
                  });
                }}
                onReplace={() => {
                  if (!activeSlide || !selected) return;
                  openUpload({
                    kind: "slide",
                    option: selected,
                    target: activeSlide.target,
                    side: activeSlide.side,
                    existing: activeSlide,
                  });
                }}
                onRemove={() => activeSlide && removeSlide(activeSlide)}
                onUndoRemove={undoRemove}
                onMoveUp={() => activeSlide && changeOrder(activeSlide, siblings[position - 1])}
                onMoveDown={() => activeSlide && changeOrder(activeSlide, siblings[position + 1])}
                onOpenMove={() =>
                  activeSlide && setMove({ slide: activeSlide, target: selectedKey, side: activeSlide.side })
                }
                onMoveTarget={(value) => setMove((current) => (current ? { ...current, target: value } : current))}
                onMoveSide={(side) => setMove((current) => (current ? { ...current, side } : current))}
                onApplyMove={() => {
                  if (!draft || !move || !activeSlide) return;
                  const option = saved?.targets.find((candidate) => pdfTargetKey(candidate.target) === move.target);
                  if (!option) return;
                  edit(
                    {
                      ...draft,
                      slides: [
                        ...draft.slides.filter((slide) => slide.id !== activeSlide.id),
                        { ...activeSlide, target: option.target, side: move.side },
                      ],
                    },
                    "Slide moved " + move.side + " " + outlineLabel(option) + ".",
                  );
                  selectTarget(move.target, activeSlide.id);
                  focusRow(activeSlide.id);
                  setMove(null);
                }}
                onCancelMove={() => setMove(null)}
                onAddBefore={() =>
                  selected && openUpload({ kind: "slide", option: selected, target: selected.target, side: "before" })
                }
                onAddAfter={() =>
                  selected && openUpload({ kind: "slide", option: selected, target: selected.target, side: "after" })
                }
                onResetLayout={() => setResetOpen(true)}
              />
            ) : (
              <aside className="min-w-0 xl:sticky xl:top-24 xl:self-start" aria-label="Brand mark">
                <div className="rounded-[var(--sat-staff-radius-card,16px)] border border-[var(--sat-staff-border-hairline,#0000000f)] bg-[var(--sat-staff-surface,#fff)] p-4">
                  <h3 className="text-[length:var(--sat-staff-type-section-size,20px)] font-semibold leading-[var(--sat-staff-type-section-line,28px)] tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">
                    {slots[logoPosition]}
                  </h3>
                  <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
                    {draft.logos[logoPosition]
                      ? assets[draft.logos[logoPosition]?.assetId ?? ""]?.filename ?? "Custom image"
                      : "The bundled Warwick mark."}
                  </p>
                  <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">
                    {slotLocations[logoPosition]}
                  </p>
                  {writable ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <SatButton
                        variant="secondary"
                        onClick={(event) => openUpload({ kind: "logo", slot: logoPosition }, event.currentTarget)}
                      >
                        Replace
                      </SatButton>
                      {draft.logos[logoPosition] ? (
                        <SatButton
                          variant="quiet"
                          icon={<RotateCcw size={16} />}
                          onClick={() => {
                            edit(
                              { ...draft, logos: { ...draft.logos, [logoPosition]: null } },
                              slots[logoPosition] + " restored in this draft.",
                            );
                            requestAnimationFrame(() =>
                              workspaceRef.current
                                ?.querySelector<HTMLElement>(
                                  '[aria-label="Replace ' + slots[logoPosition].toLowerCase() + '"]',
                                )
                                ?.focus(),
                            );
                          }}
                        >
                          Restore default
                        </SatButton>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </aside>
            )}
          </div>
        ) : null}
      </div>

      {upload ? (
        <AuthoringDialog
          open
          onClose={closePanel}
          title={
            upload.kind === "logo"
              ? "Replace " + slots[upload.slot].toLowerCase()
              : upload.existing
                ? "Replace slide image"
                : "Add a slide"
          }
          description={
            upload.kind === "logo"
              ? "The mark keeps its position on the printed page."
              : "The slide prints as one landscape page of the report."
          }
          contentClassName="max-w-[40rem]"
        >
          {upload.kind === "slide" ? (
            <PdfLayoutImageForm
              examId={examId}
              purpose="slide"
              title={upload.existing ? "Replace slide image" : "Add a slide"}
              description={upload.existing?.description ?? ""}
              requireDescription
              placementNote={
                upload.option && ["scoreReport", "answerKey"].includes(upload.option.target.kind)
                  ? "This slide prints only when the " + upload.option.label.toLowerCase() + " is released to the student."
                  : undefined
              }
              targets={saved?.targets ?? []}
              target={upload.target}
              side={upload.side}
              labelOf={outlineLabel}
              uploadImage={api.upload}
              onCancel={closePanel}
              onUploaded={uploaded}
              onDenied={onDenied}
            />
          ) : (
            <PdfLayoutImageForm
              examId={examId}
              purpose="logo"
              title={"Replace " + slots[upload.slot].toLowerCase()}
              description={draft?.logos[upload.slot]?.description ?? ""}
              requireDescription={upload.slot === "cover"}
              targets={saved?.targets ?? []}
              target={{ kind: "cover" }}
              side="after"
              labelOf={outlineLabel}
              uploadImage={api.upload}
              onCancel={closePanel}
              onUploaded={uploaded}
              onDenied={onDenied}
            />
          )}
        </AuthoringDialog>
      ) : null}

      <PdfLayoutPreviewDialog
        open={preview}
        examId={examId}
        layout={writable ? draft ?? undefined : undefined}
        previewLayout={api.preview}
        onDenied={onDenied}
        onClose={() => {
          setPreview(false);
          restoreActionFocus();
        }}
      />

      <AuthoringConfirmDialog
        open={resetOpen}
        title="Reset the layout to the default report?"
        description={
          slideCountLabel(slideCount) +
          " and " +
          replacedSlots +
          " replaced brand " +
          (replacedSlots === 1 ? "mark" : "marks") +
          " will be discarded. The default report keeps its own cover and marks."
        }
        confirmLabel="Reset layout"
        destructive
        onCancel={() => setResetOpen(false)}
        onConfirm={resetLayout}
      />
    </section>
  );
}
