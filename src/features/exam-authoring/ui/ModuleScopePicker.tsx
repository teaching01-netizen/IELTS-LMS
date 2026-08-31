import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { AssessmentSectionShell } from "../contracts/assessment";

export interface ModuleScopePickerProps {
  sections: AssessmentSectionShell[];
  selectedModuleId: string;
  disabled?: boolean;
  onSelectModule: (moduleId: string) => void;
}

export function ModuleScopePicker({ sections, selectedModuleId, disabled = false, onSelectModule }: ModuleScopePickerProps) {
  const [open, setOpen] = useState(false);
  const popupId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => {
    for (const section of sections) {
      const module = section.modules.find((candidate) => candidate.id === selectedModuleId);
      if (module) return { section, module };
    }
    return null;
  }, [sections, selectedModuleId]);

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[data-current="true"]')?.focus();
    });
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  if (!selected) return null;
  const authored = selected.module.questions.length;
  const target = selected.module.targetQuestionCount;
  const progress = target > 0 ? Math.min(100, (authored / target) * 100) : 0;

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const activeIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? Math.min(items.length - 1, activeIndex + 1) : Math.max(0, activeIndex - 1);
    items[nextIndex]?.focus();
  };

  return (
    <div className="relative min-w-0 flex-1">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={popupId}
        aria-label={`Choose module. Current: ${selected.section.title}, ${selected.module.title}, ${authored} of ${target} authored`}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
        }}
        onClick={() => setOpen((value) => !value)}
        className="group flex min-h-11 max-w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left outline-none transition hover:bg-black/[0.035] focus-visible:ring-4 focus-visible:ring-[#0071e3]/10 disabled:opacity-45"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-medium text-slate-400">{selected.section.title}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-slate-950">{selected.module.title}</span>
            <ChevronDown size={12} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
        </div>
        <div className="w-[54px] shrink-0 text-right">
          <div className="text-[10px] font-semibold tabular-nums text-slate-500">{authored}/{target}</div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/[0.06]">
            <div className="h-full rounded-full bg-[#0071e3] transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={popupId}
          role="menu"
          aria-label="Choose SAT module"
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
          className="absolute left-0 top-[calc(100%+6px)] z-[110] max-h-[min(520px,calc(100vh-112px))] w-[340px] max-w-[calc(100vw-24px)] isolate overflow-y-auto overscroll-contain rounded-[14px] border border-black/[0.10] bg-white p-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.16)]"
        >
          {sections.map((section, sectionIndex) => (
            <div key={section.id} className={sectionIndex ? "mt-2 border-t border-black/[0.055] pt-2" : ""}>
              <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5">
                <span className="text-[10px] font-semibold text-slate-500">{section.title}</span>
                <span className="text-[9px] tabular-nums text-slate-400">{Math.round(section.durationSeconds / 60)} min</span>
              </div>
              <div className="space-y-0.5">
                {section.modules.map((module) => {
                  const current = module.id === selectedModuleId;
                  const errors = module.questions.filter((question) => question.readiness.status === "error").length;
                  const incomplete = module.questions.filter((question) => question.readiness.status === "incomplete").length;
                  const moduleProgress = module.targetQuestionCount > 0 ? Math.min(100, (module.questions.length / module.targetQuestionCount) * 100) : 0;
                  return (
                    <button
                      key={module.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={current}
                      data-current={current ? "true" : "false"}
                      onClick={() => {
                        setOpen(false);
                        if (!current) onSelectModule(module.id);
                      }}
                      className={`flex min-h-[58px] w-full items-center gap-2 rounded-[10px] px-2.5 py-2.5 text-left outline-none transition focus-visible:ring-4 focus-visible:ring-[#0071e3]/10 ${current ? "bg-[#0071e3]/[0.075]" : "hover:bg-black/[0.035]"}`}
                    >
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${current ? "bg-[#0071e3] text-white" : "text-transparent"}`} aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className={`truncate text-[11px] font-semibold ${current ? "text-slate-950" : "text-slate-700"}`}>{module.title}</span>
                          <span className="shrink-0 text-[9px] tabular-nums text-slate-400">{module.questions.length}/{module.targetQuestionCount}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-black/[0.055]"><div className="h-full rounded-full bg-[#0071e3]" style={{ width: `${moduleProgress}%` }} /></div>
                          {errors ? <span className="text-[8px] font-semibold text-red-500">{errors} error{errors === 1 ? "" : "s"}</span> : incomplete ? <span className="text-[8px] font-medium text-slate-400">{incomplete} incomplete</span> : module.questions.length === module.targetQuestionCount ? <span className="text-[8px] font-semibold text-emerald-600">Complete</span> : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
