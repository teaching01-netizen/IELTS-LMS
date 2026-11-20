import type { CSSProperties } from "react";
import { ChevronDown, ChevronRight, FileText, Image as ImageIcon } from "lucide-react";
import { pdfTargetKey, type PdfSlide, type PdfTargetOption } from "@shared/sat/pdfLayout";

type PageItem =
  | { kind: "section"; option: PdfTargetOption; depth: number; children: boolean }
  | { kind: "image"; option: PdfTargetOption; slide: PdfSlide; depth: number };

export function orderedPdfItems(options: PdfTargetOption[], slides: PdfSlide[], known: Set<string>, collapsed: Set<string>): PageItem[] {
  const available = options.filter((option) => known.has(pdfTargetKey(option.target)));
  const sections = available.filter(({ target }) => target.kind !== "reviewSubject" && target.kind !== "reviewModule");
  function sectionItems(option: PdfTargetOption, depth: number): PageItem[] {
    const { target } = option;
    const key = pdfTargetKey(target);
    const inserts = slides.filter((slide) => pdfTargetKey(slide.target) === key);
    const children = available.filter(({ target: item }) => {
      if (target.kind === "examReview") return item.kind === "reviewSubject";
      return target.kind === "reviewSubject" && item.kind === "reviewModule" && item.sectionKey === target.sectionKey;
    });
    const imageItems = (side: PdfSlide["side"]): PageItem[] => inserts
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

export function PdfPageStrip({ items, selectedKey, selectedSlideId, collapsed, label, assetLabel, imageUrl, disabled, onSelect, onToggle }: {
  items: PageItem[];
  selectedKey: string;
  selectedSlideId: string | null;
  collapsed: Set<string>;
  label: (option: PdfTargetOption) => string;
  assetLabel: (slide: PdfSlide) => string;
  imageUrl: (slide: PdfSlide) => string | undefined;
  disabled?: boolean;
  onSelect: (key: string, slideId?: string) => void;
  onToggle: (key: string) => void;
}) {
  return (
    <ol className="flex snap-x gap-2 overflow-x-auto overscroll-x-contain px-3 pb-3 md:block md:max-h-[56vh] md:space-y-1 md:overflow-y-auto md:overscroll-y-contain">
      {items.map((item) => {
        const key = pdfTargetKey(item.option.target);
        const image = item.kind === "image";
        const selected = image ? selectedSlideId === item.slide.id : !selectedSlideId && key === selectedKey;
        const name = image ? assetLabel(item.slide) : item.option.label;
        const context = image ? (item.slide.side === "before" ? "Before " : "After ") + label(item.option)
          : item.option.target.kind === "scoreReport" || item.option.target.kind === "answerKey" ? "When released" : null;
        const source = image ? imageUrl(item.slide) : undefined;
        const DisclosureIcon = collapsed.has(key) ? ChevronRight : ChevronDown;
        return (
          <li key={image ? item.slide.id : key} className="relative w-32 shrink-0 snap-start md:w-auto md:ps-[var(--pdf-page-indent)]"
            style={{ "--pdf-page-indent": item.depth * 12 + "px" } as CSSProperties}>
            <button
              id={image ? "pdf-slide-" + item.slide.id : undefined}
              type="button"
              disabled={disabled}
              aria-current={selected ? "true" : undefined}
              aria-label={image ? name + " · " + context : label(item.option)}
              aria-description={!image && context ? context : undefined}
              className={"w-full rounded-lg border p-2 text-left md:flex md:items-center md:gap-2 " +
                (selected ? "border-[var(--sat-staff-accent,#0071e3)] bg-[var(--sat-staff-accent-tint,#eff6ff)] ring-1 ring-[var(--sat-staff-accent,#0071e3)]" : "border-transparent hover:bg-muted")}
              onClick={() => onSelect(key, image ? item.slide.id : undefined)}
            >
              <span className="grid aspect-[297/210] w-full shrink-0 place-items-center overflow-hidden rounded border border-border bg-background text-muted-foreground md:w-12">
                {source ? <img src={source} alt="" loading="lazy" className="h-full w-full bg-white object-contain" /> : image ? <ImageIcon size={17} aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}
              </span>
              <span className={"mt-1 block min-w-0 md:mt-0 " + (!image && item.children ? "pr-5" : "")}>
                <span className="block truncate text-sm font-medium">{name}</span>
                {context ? <span className="block truncate text-xs text-muted-foreground">{context}</span> : null}
              </span>
            </button>
            {!image && item.children ? (
              <button type="button" disabled={disabled} className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-md border border-border bg-background hover:bg-muted md:top-2.5"
                aria-expanded={!collapsed.has(key)} aria-label={(collapsed.has(key) ? "Expand " : "Collapse ") + label(item.option)}
                onClick={() => onToggle(key)}>
                <DisclosureIcon size={14} aria-hidden="true" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
