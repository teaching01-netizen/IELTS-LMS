import { useId, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, FileText, Image as ImageIcon, Plus } from "lucide-react";
import { pdfTargetKey, type PdfSlide, type PdfTargetOption } from "@shared/sat/pdfLayout";

/**
 * The report outline: the printed sections of the exam PDF in print order,
 * with the slides staff placed around them. One list, one rule — a slide
 * always sits next to the section it prints against.
 */

export type PdfOutlineItem =
  | { kind: "section"; option: PdfTargetOption; depth: number; children: boolean }
  | { kind: "image"; option: PdfTargetOption; slide: PdfSlide; depth: number };

export function orderedPdfItems(options: PdfTargetOption[], slides: PdfSlide[], known: Set<string>, collapsed: Set<string>): PdfOutlineItem[] {
  const available = options.filter((option) => known.has(pdfTargetKey(option.target)));
  const sections = available.filter(({ target }) => target.kind !== "reviewSubject" && target.kind !== "reviewModule");
  function sectionItems(option: PdfTargetOption, depth: number): PdfOutlineItem[] {
    const { target } = option;
    const key = pdfTargetKey(target);
    const inserts = slides.filter((slide) => pdfTargetKey(slide.target) === key);
    const children = available.filter(({ target: item }) => {
      if (target.kind === "examReview") return item.kind === "reviewSubject";
      return target.kind === "reviewSubject" && item.kind === "reviewModule" && item.sectionKey === target.sectionKey;
    });
    const imageItems = (side: PdfSlide["side"]): PdfOutlineItem[] => inserts
      .filter((slide) => slide.side === side)
      .map((slide) => ({ kind: "image", option, slide, depth }));
    return [
      ...imageItems("before"),
      { kind: "section", option, depth, children: children.length > 0 },
      ...(collapsed.has(key) ? [] : children.flatMap((child) => sectionItems(child, depth + 1))),
      ...imageItems("after"),
    ];
  }
  return [
    ...sections.flatMap((option) => sectionItems(option, 0)),
    ...options.filter((option) => !known.has(pdfTargetKey(option.target))).flatMap((option) => sectionItems(option, 0)),
  ];
}

export function PdfReportOutline({
  items,
  selectedKey,
  selectedSlideId,
  collapsed,
  label,
  condition,
  assetLabel,
  imageUrl,
  slideCount,
  disabled,
  onSelect,
  onToggle,
  onAddSlide,
  dragSlideId,
  onDragStartSlide,
  onDragOverSlide,
  onDropSlide,
  onDragEndSlide,
}: {
  items: PdfOutlineItem[];
  selectedKey: string;
  selectedSlideId: string | null;
  collapsed: Set<string>;
  label: (option: PdfTargetOption) => string;
  condition: (option: PdfTargetOption) => string | null;
  assetLabel: (slide: PdfSlide) => string;
  imageUrl: (slide: PdfSlide) => string | undefined;
  slideCount: (option: PdfTargetOption) => number;
  disabled?: boolean;
  onSelect: (key: string, slideId?: string) => void;
  onToggle: (key: string) => void;
  onAddSlide: (option: PdfTargetOption) => void;
  dragSlideId: string | null;
  onDragStartSlide: (slide: PdfSlide) => void;
  onDragOverSlide: (slide: PdfSlide) => void;
  onDropSlide: (slide: PdfSlide) => void;
  onDragEndSlide: () => void;
}) {
  const conditionId = useId();
  return (
    <ol className="space-y-0.5">
      {items.map((item) => {
        const key = pdfTargetKey(item.option.target);
        const name = label(item.option);
        const note = condition(item.option);
        const selected = item.kind === "image" ? selectedSlideId === item.slide.id : !selectedSlideId && key === selectedKey;
        const indent = item.depth * 14;
        if (item.kind === "image") {
          const slide = item.slide;
          const placement = (slide.side === "before" ? "Before " : "After ") + name;
          const source = imageUrl(slide);
          return (
            <li key={slide.id} className="px-1">
              <button
                id={"pdf-slide-" + slide.id}
                type="button"
                draggable={!disabled}
                disabled={disabled}
                aria-current={selected ? "true" : undefined}
                aria-label={assetLabel(slide) + ", " + placement}
                onClick={() => onSelect(key, slide.id)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", slide.id);
                  onDragStartSlide(slide);
                }}
                onDragOver={(event) => {
                  if (!dragSlideId || dragSlideId === slide.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  onDragOverSlide(slide);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  onDropSlide(slide);
                }}
                onDragEnd={onDragEndSlide}
                style={{ "--pdf-outline-indent": indent + "px" } as CSSProperties}
                className={"flex w-full min-h-11 items-center gap-2 rounded-[var(--sat-staff-radius-control,8px)] px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,#0071e366)] md:ps-[calc(var(--pdf-outline-indent)+8px)] " +
                  (selected
                    ? "bg-[var(--sat-staff-accent-tint,#0071e314)] text-[var(--sat-staff-text-primary,#1d1d1f)]"
                    : "text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-faint,#7878800f)]")}
              >
                <span className="grid h-9 w-12 shrink-0 place-items-center overflow-hidden rounded-[4px] border border-[var(--sat-staff-border-hairline,#0000000f)] bg-white">
                  {source ? <img src={source} alt="" loading="lazy" className="h-full w-full object-contain" /> : <ImageIcon size={14} aria-hidden="true" className="text-[var(--sat-staff-text-tertiary,#6e6e73)]" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium leading-5">{assetLabel(slide)}</span>
                  <span className="block truncate text-[13px] leading-4 text-[var(--sat-staff-text-tertiary,#6e6e73)]">{placement}</span>
                </span>
              </button>
            </li>
          );
        }
        const count = slideCount(item.option);
        return (
          <li key={key} className="px-1">
            <div
              className={"flex items-center gap-1 rounded-[var(--sat-staff-radius-control,8px)] pr-1 " +
                (selected ? "bg-[var(--sat-staff-accent-tint,#0071e314)]" : "")}
              style={{ "--pdf-outline-indent": indent + "px" } as CSSProperties}
            >
              {item.children ? (
                <button
                  type="button"
                  disabled={disabled}
                  aria-expanded={!collapsed.has(key)}
                  aria-label={(collapsed.has(key) ? "Expand " : "Collapse ") + name}
                  onClick={() => onToggle(key)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-[6px] text-[var(--sat-staff-text-tertiary,#6e6e73)] hover:bg-[var(--sat-staff-fill-chip,#0000000a)]"
                >
                  {collapsed.has(key) ? <ChevronRight size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                </button>
              ) : (
                <span className="flex size-8 shrink-0 items-center justify-center" aria-hidden="true">
                  <FileText size={14} className="text-[var(--sat-staff-text-tertiary,#6e6e73)]" />
                </span>
              )}
              <button
                type="button"
                disabled={disabled}
                aria-current={selected ? "true" : undefined}
                aria-label={name}
                aria-describedby={note ? conditionId : undefined}
                onClick={() => onSelect(key)}
                className="flex min-h-11 min-w-0 flex-1 flex-col items-start rounded-[6px] px-1 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent-ring,#0071e366)]"
              >
                <span className="w-full truncate text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">{name}</span>
                {note ? (
                  <span id={conditionId} className="w-full truncate text-[13px] leading-4 text-[var(--sat-staff-text-tertiary,#6e6e73)]">{note}</span>
                ) : count > 0 ? (
                  <span className="w-full truncate text-[13px] leading-4 text-[var(--sat-staff-text-tertiary,#6e6e73)]">{count === 1 ? "1 slide" : count + " slides"}</span>
                ) : null}
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-label={"Add slide at " + name}
                onClick={() => onAddSlide(item.option)}
                className="flex size-9 shrink-0 items-center justify-center rounded-[6px] text-[var(--sat-staff-text-tertiary,#6e6e73)] hover:bg-[var(--sat-staff-fill-chip,#0000000a)] hover:text-[var(--sat-staff-text-primary,#1d1d1f)] disabled:opacity-40"
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
