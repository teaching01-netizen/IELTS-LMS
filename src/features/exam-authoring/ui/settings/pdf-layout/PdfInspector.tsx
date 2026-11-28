import { ArrowDown, ArrowUp, Image as ImageIcon, RotateCcw, Trash2 } from "lucide-react";
import type { PdfSide, PdfSlide, PdfTargetOption } from "@shared/sat/pdfLayout";
import { SatButton, SatField } from "../../../../../products/sat/ui/SatPage";

/**
 * The inspector: everything about the selected report section or slide.
 * It answers three questions in one place — what prints here, what can be
 * changed, and what happens if it is changed.
 */
export function PdfInspector({
  canEdit,
  saving,
  section,
  slide,
  slideName,
  placement,
  description,
  descriptionError,
  siblingCount,
  position,
  moveOpen,
  moveTarget,
  moveSide,
  targets,
  labelOf,
  removedName,
  onDescriptionChange,
  onReplace,
  onRemove,
  onUndoRemove,
  onMoveUp,
  onMoveDown,
  onOpenMove,
  onMoveTarget,
  onMoveSide,
  onApplyMove,
  onCancelMove,
  onAddBefore,
  onAddAfter,
  onResetLayout,
}: {
  canEdit: boolean;
  saving: boolean;
  section: { label: string; condition: string | null; available: boolean } | null;
  slide: PdfSlide | null;
  slideName: string;
  placement: string;
  description: string;
  descriptionError: string | null;
  siblingCount: number;
  position: number;
  moveOpen: boolean;
  moveTarget: string;
  moveSide: PdfSide;
  targets: PdfTargetOption[];
  labelOf: (option: PdfTargetOption) => string;
  removedName: string | null;
  onDescriptionChange: (value: string) => void;
  onReplace: () => void;
  onRemove: () => void;
  onUndoRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onOpenMove: () => void;
  onMoveTarget: (value: string) => void;
  onMoveSide: (side: PdfSide) => void;
  onApplyMove: () => void;
  onCancelMove: () => void;
  onAddBefore: () => void;
  onAddAfter: () => void;
  onResetLayout: () => void;
}) {
  return (
    <aside className="min-w-0 xl:sticky xl:top-24 xl:self-start" aria-label="Selected section or slide">
      <div className="rounded-[var(--sat-staff-radius-card,16px)] border border-[var(--sat-staff-border-hairline,#0000000f)] bg-[var(--sat-staff-surface,#fff)] p-4">
        {slide ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-[length:var(--sat-staff-type-section-size,20px)] font-semibold leading-[var(--sat-staff-type-section-line,28px)] tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">Slide</h3>
              <p className="mt-0.5 break-words text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{slideName}</p>
              <p className="mt-0.5 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">{placement}</p>
            </div>
            {canEdit ? (
              <SatField id="pdf-slide-description-input" label="Describe this slide" error={descriptionError} help="Screen readers announce this where the slide prints.">
                {(control) => (
                  <textarea
                    {...control}
                    rows={3}
                    maxLength={240}
                    disabled={saving}
                    value={description}
                    onChange={(event) => onDescriptionChange(event.currentTarget.value)}
                    className="sat-input w-full rounded-[var(--sat-staff-radius-input,8px)] border border-[var(--sat-staff-border-control,#00000017)] bg-[var(--sat-staff-surface-solid-fallback,#fff)] px-3 py-2 text-[14px]"
                  />
                )}
              </SatField>
            ) : (
              <div>
                <p className="text-[14px] font-medium text-[var(--sat-staff-text-primary,#1d1d1f)]">Description</p>
                <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{description || "No description."}</p>
              </div>
            )}
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <SatButton variant="secondary" disabled={saving} onClick={onReplace}>Replace image</SatButton>
                <SatButton variant="danger-secondary" icon={<Trash2 size={16} />} disabled={saving} onClick={onRemove}>Remove</SatButton>
              </div>
            ) : null}
            {canEdit && siblingCount > 1 ? (
              <div className="flex flex-wrap gap-2 border-t border-[var(--sat-staff-border-hairline,#0000000f)] pt-4">
                <SatButton variant="quiet" icon={<ArrowUp size={16} />} disabled={saving || position === 0} onClick={onMoveUp}>Move up</SatButton>
                <SatButton variant="quiet" icon={<ArrowDown size={16} />} disabled={saving || position === siblingCount - 1} onClick={onMoveDown}>Move down</SatButton>
                <SatButton variant="quiet" disabled={saving} onClick={onOpenMove}>Change placement</SatButton>
              </div>
            ) : null}
            {moveOpen ? (
              <div className="space-y-3 border-t border-[var(--sat-staff-border-hairline,#0000000f)] pt-4">
                <SatField id="pdf-move-target" label="Prints at">
                  {(control) => (
                    <select
                      {...control}
                      className="sat-select w-full rounded-[var(--sat-staff-radius-input,8px)] border border-[var(--sat-staff-border-control,#00000017)] bg-[var(--sat-staff-surface-solid-fallback,#fff)] px-3 py-2 text-[14px]"
                      value={moveTarget}
                      onChange={(event) => onMoveTarget(event.currentTarget.value)}
                    >
                      {targets.map((option) => (
                        <option key={optionKey(option)} value={optionKey(option)}>{labelOf(option)}</option>
                      ))}
                    </select>
                  )}
                </SatField>
                <SatField id="pdf-move-side" label="Position">
                  {(control) => (
                    <select
                      {...control}
                      className="sat-select w-full rounded-[var(--sat-staff-radius-input,8px)] border border-[var(--sat-staff-border-control,#00000017)] bg-[var(--sat-staff-surface-solid-fallback,#fff)] px-3 py-2 text-[14px]"
                      value={moveSide}
                      onChange={(event) => onMoveSide(event.currentTarget.value === "before" ? "before" : "after")}
                    >
                      <option value="before">Before</option>
                      <option value="after">After</option>
                    </select>
                  )}
                </SatField>
                <div className="flex gap-2">
                  <SatButton variant="quiet" onClick={onCancelMove}>Cancel</SatButton>
                  <SatButton variant="primary" disabled={saving} onClick={onApplyMove}>Move slide</SatButton>
                </div>
              </div>
            ) : null}
          </div>
        ) : section ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-[length:var(--sat-staff-type-section-size,20px)] font-semibold leading-[var(--sat-staff-type-section-line,28px)] tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{section.label}</h3>
              {section.condition ? (
                <p className="mt-0.5 text-[14px] leading-5 text-[var(--sat-staff-text-tertiary,#6e6e73)]">{section.condition}</p>
              ) : null}
              {!section.available ? (
                <p className="mt-0.5 text-[14px] leading-5 text-[var(--sat-staff-warning-text,#92400e)]">
                  This section is no longer in the current exam. Move its slides to a section that is, or remove them.
                </p>
              ) : null}
            </div>
            {canEdit && section.available ? (
              <div className="flex flex-wrap gap-2">
                <SatButton variant="secondary" onClick={onAddBefore}>Add slide before</SatButton>
                <SatButton variant="secondary" onClick={onAddAfter}>Add slide after</SatButton>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <h3 className="text-[length:var(--sat-staff-type-section-size,20px)] font-semibold leading-[var(--sat-staff-type-section-line,28px)] tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">Report layout</h3>
            <p className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
              Choose a section in the outline to add a slide around it.
            </p>
          </div>
        )}
        {removedName ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[var(--sat-staff-radius-control,8px)] bg-[var(--sat-staff-fill-chip,#0000000a)] px-3 py-2">
            <p className="min-w-0 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Removed {removedName}</p>
            {canEdit ? (
              <SatButton variant="quiet" icon={<RotateCcw size={16} />} onClick={onUndoRemove}>Undo</SatButton>
            ) : null}
          </div>
        ) : null}
      </div>
      {canEdit ? (
        <div className="mt-4">
          <SatButton variant="quiet" icon={<ImageIcon size={16} />} disabled={saving} onClick={onResetLayout}>
            Reset layout to default
          </SatButton>
        </div>
      ) : null}
    </aside>
  );
}

function optionKey(option: PdfTargetOption): string {
  const { target } = option;
  if (target.kind === "reviewSubject") return `reviewSubject:${target.sectionKey}`;
  if (target.kind === "reviewModule") return `reviewModule:${target.sectionKey}:${target.moduleKey}`;
  return target.kind;
}
