import { useCallback, useEffect, useRef, useState } from "react";
import { pdfTargetKey, type PdfLayout, type PdfLayoutAsset, type PdfLayoutEditorData, type PdfLogoSlot, type PdfSide, type PdfSlide, type PdfTargetOption } from "@shared/sat/pdfLayout";
import { ApiError } from "@shared/api-client/errors";
import { Dialog } from "../../../../../components/ui/Dialog";
import { SatButton } from "../../../../../products/sat/ui/SatPage";
import defaultLogo from "../../../../../assets/warwick-institute-logo.png";
import { loadSatPdfLayout, saveSatPdfLayout, satPdfImageUrl } from "../../../api/satPdfLayoutApi";
import { releaseSurfaceClass } from "../../release/releaseUi";
import { PdfLayoutImageForm, pdfErrorMessage, pdfInputClass } from "./PdfLayoutImageForm";
import { PdfLayoutPreview } from "./PdfLayoutPreview";

const slots: Record<PdfLogoSlot, string> = {
  cover: "Cover logo",
  leftWatermark: "Left watermark",
  rightWatermark: "Right watermark",
};

type EditImage =
  | { kind: "slide"; option: PdfTargetOption; side: PdfSide; existing?: PdfSlide }
  | { kind: "logo"; slot: PdfLogoSlot };

const bucket = (slide: PdfSlide) => pdfTargetKey(slide.target) + ":" + slide.side;
const maxLayoutBytes = 6 * 1024 * 1024;

export function ExamPdfLayoutPanel({ examId, canEdit, onDirtyChange }: {
  examId: string;
  canEdit: boolean;
  onDirtyChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<boolean | null>(null);
  return (
    <section className={releaseSurfaceClass + " flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6"} aria-label="Exam PDF">
      <div>
        <h3 className="font-semibold">Exam PDF</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {custom === null ? "Manage the image pages and branding for this exam." : custom ? "Custom layout" : "Default layout"}
        </p>
      </div>
      <SatButton variant="secondary" onClick={() => setOpen(true)}>{canEdit ? "Customize PDF" : "View PDF layout"}</SatButton>
      {open ? (
        <ExamPdfLayoutEditor
          examId={examId}
          canEdit={canEdit}
          onDirtyChange={onDirtyChange}
          onLoaded={setCustom}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

function isCustom(layout: PdfLayout) {
  return layout.slides.length > 0 || Object.values(layout.logos).some(Boolean);
}

function layoutSignature(layout: PdfLayout) {
  const slides = [...layout.slides].sort((a, b) => bucket(a).localeCompare(bucket(b)));
  return JSON.stringify({ slides, logos: layout.logos });
}

function ExamPdfLayoutEditor({ examId, canEdit, onDirtyChange, onClose, onLoaded }: {
  examId: string;
  canEdit: boolean;
  onDirtyChange: (value: number) => void;
  onClose: () => void;
  onLoaded: (custom: boolean) => void;
}) {
  const [saved, setSaved] = useState<PdfLayoutEditorData | null>(null);
  const [draft, setDraft] = useState<PdfLayout | null>(null);
  const [assets, setAssets] = useState<Record<string, PdfLayoutAsset>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState(false);
  const [confirm, setConfirm] = useState<"close" | "reload" | null>(null);
  const [accessLost, setAccessLost] = useState(false);
  const [expired, setExpired] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [tab, setTab] = useState<"pages" | "branding">("pages");
  const [targetKey, setTargetKey] = useState("cover");
  const [upload, setUpload] = useState<EditImage | null>(null);
  const [preview, setPreview] = useState(false);
  const [move, setMove] = useState<{ slide: PdfSlide; target: string; side: PdfSide } | null>(null);
  const [removed, setRemoved] = useState<{ slide: PdfSlide; index: number } | null>(null);
  const request = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const operationOrigin = useRef<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const dirty = Boolean(saved && draft && layoutSignature(saved.layout) !== layoutSignature(draft));
  const writable = canEdit && !accessLost;

  const acceptLayout = useCallback((value: PdfLayoutEditorData) => {
    setSaved(value);
    setDraft(value.layout);
    setAssets(Object.fromEntries(value.assets.map((asset) => [asset.id, asset])));
    setConflict(false);
    setExpired([]);
    setMissing([]);
    setRemoved(null);
    onLoaded(isCustom(value.layout));
  }, [onLoaded]);
  const reload = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setLoadError("");
    try {
      const value = await loadSatPdfLayout(examId, controller.signal);
      if (!controller.signal.aborted) {
        acceptLayout(value);
        setError("");
        setStatus("");
        setTargetKey("cover");
      }
    } catch (error) {
      if (!controller.signal.aborted) setLoadError(pdfErrorMessage(error, "Couldn’t load this layout."));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoading(false);
      }
    }
  }, [acceptLayout, examId]);
  useEffect(() => {
    void reload();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [reload]);
  useEffect(() => {
    onDirtyChange(dirty ? 1 : 0);
    return () => onDirtyChange(0);
  }, [dirty, onDirtyChange]);

  const onDenied = useCallback((cause: unknown) => {
    if (cause instanceof ApiError && (cause.status === 403 || cause.status === 401)) {
      setAccessLost(true);
      setError("You no longer have edit access to this layout.");
    }
  }, []);

  const save = async () => {
    if (!saved || !draft || request.current || !dirty || !writable || conflict) return;
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const value = await saveSatPdfLayout(examId, saved.revision, draft, controller.signal);
      if (!controller.signal.aborted) {
        acceptLayout(value);
        setStatus("Layout saved. New PDFs use this layout.");
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
        requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("[data-pdf-error]")?.focus());
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
        const matching = [...(dialogRef.current?.querySelectorAll<HTMLElement>("[aria-label]") ?? [])]
          .find((element) => element.getAttribute("aria-label") === equivalent);
        matching?.focus();
      }
    });
  };
  const close = () => {
    if (confirm) {
      setConfirm(null);
      return;
    }
    if (preview) {
      setPreview(false);
      restoreActionFocus();
      return;
    }
    if (upload) {
      setUpload(null);
      restoreActionFocus();
      return;
    }
    if (saving) return;
    if (dirty) setConfirm("close");
    else onClose();
  };

  const focusRow = (id: string) => {
    requestAnimationFrame(() => document.getElementById("pdf-slide-" + id)?.focus());
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
      setTargetKey(pdfTargetKey(slide.target));
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

  const thumb = (assetId: string) => (
    expired.includes(assetId) ? <span className="text-sm text-destructive">Image unavailable</span>
      : missing.includes(assetId) ? (
        <SatButton variant="quiet" onClick={() => setMissing((ids) => ids.filter((id) => id !== assetId))}>Retry image</SatButton>
      ) : (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- onError reports a failed thumbnail request.
        <img className="h-12 w-20 rounded-md border border-border bg-muted object-contain"
          src={satPdfImageUrl(examId, assetId)} alt=""
          onError={() => setMissing((ids) => ids.includes(assetId) ? ids : [...ids, assetId])} />
      )
  );

  return (
    <Dialog ref={dialogRef} isOpen onClose={close} title={canEdit ? "Customize PDF" : "View PDF layout"} size="full" preventCloseOnOverlayClick>
      {confirm ? (
        <div className="space-y-4">
          <h3 className="font-semibold">{confirm === "close" ? "Leave without saving?" : "Discard edits and load the latest layout?"}</h3>
          <p className="text-sm text-muted-foreground">Your unsaved PDF layout changes will be discarded.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <SatButton variant="secondary" onClick={() => setConfirm(null)}>Keep editing</SatButton>
            <SatButton onClick={() => {
              const action = confirm;
              setConfirm(null);
              if (action === "close") onClose();
              else void reload();
            }}>{confirm === "close" ? "Discard changes" : "Load latest layout"}</SatButton>
          </div>
        </div>
      ) : loading ? <p role="status">Loading layout…</p>
      : loadError ? (
        <div className="space-y-3">
          <p role="alert" className="text-destructive">{loadError}</p>
          <SatButton variant="secondary" onClick={() => void reload()}>Retry</SatButton>
          {draft ? <SatButton variant="secondary" onClick={() => setLoadError("")}>Review my edits</SatButton> : null}
        </div>
      ) : preview && draft ? (
        <PdfLayoutPreview examId={examId} layout={writable ? draft : undefined} onBack={close} onDenied={onDenied} />
      ) : upload && draft && writable ? (
        <PdfLayoutImageForm
          examId={examId}
          title={upload.kind === "logo" ? "Replace " + slots[upload.slot].toLowerCase() : upload.existing ? "Replace slide image" : "Add image " + upload.side + " " + upload.option.label}
          purpose={upload.kind === "logo" ? "logo" : "slide"}
          description={upload.kind === "logo" ? draft.logos[upload.slot]?.description ?? "" : upload.existing?.description ?? ""}
          requireDescription={upload.kind === "slide" || upload.slot === "cover"}
          onCancel={close}
          onUploaded={uploaded}
          onDenied={onDenied}
        />
      ) : draft ? (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-between gap-3">
            <div className="flex gap-2" role="group" aria-label="PDF layout editor section">
              <SatButton variant={tab === "pages" ? "secondary" : "quiet"} aria-pressed={tab === "pages"} onClick={() => setTab("pages")}>Pages</SatButton>
              <SatButton variant={tab === "branding" ? "secondary" : "quiet"} aria-pressed={tab === "branding"} onClick={() => setTab("branding")}>Branding</SatButton>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SatButton variant="secondary" disabled={saving || (writable && invalid)} aria-label="Preview PDF" onClick={(event) => { operationOrigin.current = event.currentTarget; setPreview(true); }}>Preview PDF</SatButton>
              {writable ? <SatButton variant="primary" disabled={!dirty || invalid || saving || conflict} onClick={() => void save()}>{saving ? "Saving…" : "Save layout"}</SatButton> : null}
            </div>
          </div>
          <p className="text-sm text-muted-foreground" role="status">{status || (dirty ? "Unsaved changes" : !writable ? "View only" : "")}</p>
          {conflict ? (
            <div className="flex flex-wrap gap-2">
              <SatButton variant="secondary" onClick={() => dialogRef.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.focus()}>Review my edits</SatButton>
              <SatButton variant="secondary" onClick={() => setConfirm("reload")}>Load latest layout</SatButton>
            </div>
          ) : null}
          {error ? <p tabIndex={-1} data-pdf-error role="alert" className="text-sm text-destructive">{error}</p> : null}
          {total > maxLayoutBytes ? <p role="alert" className="text-sm text-destructive">Reduce the layout to 6 MiB of images before saving.</p> : null}
          {tab === "branding" ? (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {(Object.keys(slots) as PdfLogoSlot[]).map((slot) => {
                const logo = draft.logos[slot];
                return (
                  <li key={slot} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="flex items-center gap-3">
                      {logo ? thumb(logo.assetId) : <img className="h-12 w-20 object-contain" src={defaultLogo} alt="" />}
                      <div><h3 className="font-semibold">{slots[slot]}</h3><p className="break-all text-sm text-muted-foreground">{logo ? assets[logo.assetId]?.filename ?? "Custom image" : "Default"}</p></div>
                    </div>
                    {writable ? (
                      <div className="flex flex-wrap gap-2">
                        <SatButton variant="secondary" disabled={saving} aria-label={"Replace " + slots[slot].toLowerCase()} onClick={(event) => { operationOrigin.current = event.currentTarget; setUpload({ kind: "logo", slot }); }}>Replace</SatButton>
                        {logo ? <SatButton variant="secondary" disabled={saving} aria-label={"Restore " + slots[slot].toLowerCase() + " default"} onClick={() => {
                          edit({ ...draft, logos: { ...draft.logos, [slot]: null } }, slots[slot] + " restored in this draft.");
                          requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(`[aria-label="Replace ${slots[slot].toLowerCase()}"]`)?.focus());
                        }}>Restore default</SatButton> : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : selected ? (
            <div className="grid gap-4 sm:grid-cols-[minmax(12rem,2fr)_minmax(0,3fr)]">
              <nav className="rounded-xl border border-border p-2" aria-label="PDF outline">
                <ul>
                  {options.map((option) => {
                    const key = pdfTargetKey(option.target);
                    const isModule = option.target.kind === "reviewModule";
                    const isSubject = option.target.kind === "reviewSubject";
                    if ((isSubject || isModule) && collapsed.has("examReview") && knownTargets.has(key)) return null;
                    if (option.target.kind === "reviewModule" && collapsed.has(pdfTargetKey({ kind: "reviewSubject", sectionKey: option.target.sectionKey })) && knownTargets.has(key)) return null;
                    const expandable = (isSubject && knownTargets.has(key)) || option.target.kind === "examReview";
                    const count = draft.slides.filter((slide) => pdfTargetKey(slide.target) === key).length;
                    const conditional = ["scoreReport", "answerKey", "reviewSubject", "reviewModule"].includes(option.target.kind);
                    return (
                      <li key={key} className={"flex items-center " + (option.target.kind === "reviewModule" ? "ml-5" : option.target.kind === "reviewSubject" ? "ml-2" : "")}>
                        <button type="button" className={`flex min-h-11 w-full items-center justify-between gap-1 rounded-lg px-2 text-left text-sm ${key === selectedKey ? "bg-muted font-semibold" : "hover:bg-muted/60"}`}
                          aria-current={key === selectedKey ? "true" : undefined} onClick={() => { setTargetKey(key); setMove(null); }}>
                          <span>{option.label}</span>
                          {count ? <span aria-label={count + " image pages"}>{count}</span> : conditional ? <span className="text-xs text-muted-foreground">Conditional</span> : null}
                        </button>
                        {expandable ? (
                          <button type="button" className="min-h-11 min-w-11 rounded-lg hover:bg-muted/60"
                            aria-expanded={!collapsed.has(key)}
                            aria-label={(collapsed.has(key) ? "Expand " : "Collapse ") + option.label}
                            onClick={() => setCollapsed((previous) => {
                              const next = new Set(previous);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })}>
                            <span aria-hidden="true">{collapsed.has(key) ? "▸" : "▾"}</span>
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </nav>
              <section className="min-w-0 space-y-3" aria-label={selected.label + " image pages"}>
                <h3 className="text-lg font-semibold">{selected.label}</h3>
                {!knownTargets.has(selectedKey) ? <p className="text-sm text-muted-foreground">This target is unavailable in the current outline. Move or remove its images below.</p>
                  : ["scoreReport", "answerKey", "reviewSubject", "reviewModule"].includes(selected.target.kind)
                    ? <p className="text-sm text-muted-foreground">These slides appear when this section is included in the PDF.</p> : null}
                {(["before", "after"] as const).map((side) => {
                  const pages = draft.slides.filter((slide) => slide.side === side && pdfTargetKey(slide.target) === selectedKey);
                  return (
                    <div className="space-y-2 rounded-xl border border-border p-3" key={side}>
                      <h4 className="text-sm font-semibold">{side === "before" ? "Before" : "After"} {selected.label}</h4>
                      {!pages.length ? <p className="text-sm text-muted-foreground">No image pages</p> : null}
                      <ol className="space-y-2">
                        {pages.map((page, index) => (
                          <li key={page.id} id={"pdf-slide-" + page.id} tabIndex={-1} className="space-y-2 rounded-lg border border-border p-2">
                            <div className="flex flex-wrap items-center gap-2">
                              {thumb(page.assetId)}
                              <p className="min-w-0 break-all text-sm font-medium">{assets[page.assetId]?.filename ?? "Image page"}</p>
                            </div>
                            <label className="block space-y-1 text-sm" htmlFor={"description-" + page.id}>
                              <span>Image description</span>
                              <textarea id={"description-" + page.id} aria-label="Image description" className={pdfInputClass} rows={2} maxLength={240} disabled={!writable || saving} value={page.description}
                                onChange={(event) => {
                                  const description = event.currentTarget.value;
                                  edit({ ...draft, slides: draft.slides.map((old) => old.id === page.id ? { ...old, description } : old) });
                                }} />
                            </label>
                            {writable ? (
                              <div className="flex flex-wrap gap-1">
                                <SatButton variant="secondary" disabled={saving || index === 0} onClick={() => changeOrder(page, pages[index - 1])}>Move up</SatButton>
                                <SatButton variant="secondary" disabled={saving || index === pages.length - 1} onClick={() => changeOrder(page, pages[index + 1])}>Move down</SatButton>
                                <SatButton variant="secondary" disabled={saving} onClick={() => setMove({ slide: page, target: knownTargets.has(selectedKey) ? selectedKey : "cover", side })}>Change placement</SatButton>
                                <SatButton variant="secondary" disabled={saving} aria-label={"Replace image " + (assets[page.assetId]?.filename ?? page.description)} onClick={(event) => { operationOrigin.current = event.currentTarget; setUpload({ kind: "slide", option: selected, side, existing: page }); }}>Replace image</SatButton>
                                <SatButton variant="secondary" disabled={saving} onClick={() => {
                                  setRemoved({ slide: page, index: draft.slides.findIndex((slide) => slide.id === page.id) });
                                  edit({ ...draft, slides: draft.slides.filter((slide) => slide.id !== page.id) }, "Image page removed.");
                                  const next = pages[index + 1] ?? pages[index - 1];
                                  if (next) focusRow(next.id);
                                  else requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("[data-add-side=" + side + "]")?.focus());
                                }}>Remove</SatButton>
                              </div>
                            ) : null}
                            {move?.slide.id === page.id && writable ? (
                              <div className="grid gap-2 border-t border-border pt-2">
                                <label className="text-sm" htmlFor="pdf-move-target">Target
                                  <select id="pdf-move-target" className={pdfInputClass} value={move.target} onChange={(event) => setMove({ ...move, target: event.currentTarget.value })}>
                                    {saved?.targets.map((option) => <option key={pdfTargetKey(option.target)} value={pdfTargetKey(option.target)}>{option.label}</option>)}
                                  </select>
                                </label>
                                <label className="text-sm" htmlFor="pdf-move-side">Position
                                  <select id="pdf-move-side" className={pdfInputClass} value={move.side} onChange={(event) => setMove({ ...move, side: event.currentTarget.value === "before" ? "before" : "after" })}>
                                    <option value="before">Before</option><option value="after">After</option>
                                  </select>
                                </label>
                                <div className="flex gap-2">
                                  <SatButton variant="secondary" onClick={() => setMove(null)}>Cancel</SatButton>
                                  <SatButton disabled={saving || (move.target === selectedKey && move.side === side)} onClick={() => {
                                    const option = saved?.targets.find((candidate) => pdfTargetKey(candidate.target) === move.target);
                                    if (!option) return;
                                    edit({ ...draft, slides: [...draft.slides.filter((slide) => slide.id !== page.id), { ...page, target: option.target, side: move.side }] },
                                      "Image page moved " + move.side + " " + option.label + ".");
                                    setTargetKey(move.target);
                                    setMove(null);
                                    focusRow(page.id);
                                  }}>Move page</SatButton>
                                </div>
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                      {writable && knownTargets.has(selectedKey) ? <SatButton variant="secondary" disabled={saving || draft.slides.length >= 8}
                        aria-label={"Add image " + side + " " + selected.label} data-add-side={side} onClick={(event) => { operationOrigin.current = event.currentTarget; setUpload({ kind: "slide", option: selected, side }); }}>Add image {side}</SatButton> : null}
                    </div>
                  );
                })}
                {removed && writable ? <SatButton variant="secondary" disabled={saving || draft.slides.length >= 8} onClick={() => {
                  const slides = [...draft.slides];
                  slides.splice(removed.index, 0, removed.slide);
                  edit({ ...draft, slides }, "Image page restored.");
                  setTargetKey(pdfTargetKey(removed.slide.target));
                  setRemoved(null);
                  focusRow(removed.slide.id);
                }}>Undo remove</SatButton> : null}
                {draft.slides.length >= 8 ? <p className="text-sm text-muted-foreground">This layout has 8 image pages.</p> : null}
              </section>
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
