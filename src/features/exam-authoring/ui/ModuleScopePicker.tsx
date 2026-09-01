import { useEffect, useId, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import type { AssessmentSectionShell } from "../contracts/assessment";
import { authoringMotion } from "./authoringMotion";

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
  const reduceMotion = useReducedMotion();
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
        className="group flex min-h-11 max-w-full items-center gap-2 rounded-[12px] px-2 py-1.5 text-left outline-none transition hover:bg-au-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent disabled:opacity-45"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">{selected.section.title}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold tracking-[-0.012em] text-slate-950">{selected.module.title}</span>
            <ChevronDown size={12} className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </div>
        </div>
        <div className="w-[54px] shrink-0 text-right">
          <div className="text-[11px] font-semibold tabular-nums text-slate-500">{authored}/{target}</div>
          <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-au-fill" aria-hidden="true">
            <div className="h-full rounded-full bg-au-accent transition-[width] duration-500 ease-out" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </button>

      {open ? (
        <motion.div
          ref={menuRef}
          id={popupId}
          role="menu"
          aria-label="Choose SAT module"
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
          initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={reduceMotion ? { duration: 0.01 } : authoringMotion.spring}
          style={{ transformOrigin: "top left" }}
          className="au-elevation-menu absolute left-0 top-[calc(100%+6px)] z-[110] max-h-[min(520px,calc(100vh-112px))] w-[340px] max-w-[calc(100vw-24px)] isolate overflow-y-auto overscroll-contain rounded-[14px] border border-au-separator bg-white p-1.5"
        >
          {sections.map((section, sectionIndex) => (
            <div key={section.id} className={sectionIndex ? "mt-2 border-t border-black/[0.055] pt-2" : ""}>
              <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">{section.title}</span>
                <span className="text-[10px] tabular-nums text-slate-400">{Math.round(section.durationSeconds / 60)} min</span>
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
                      className={`flex min-h-[58px] w-full items-center gap-2 rounded-[10px] px-2.5 py-2.5 text-left outline-none transition focus-visible:ring-4 focus-visible:ring-au-accent/10 ${current ? "bg-au-tint-soft-strong" : "hover:bg-black/[0.035]"}`}
                    >
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${current ? "bg-au-tint text-white" : "text-transparent"}`} aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className={`truncate text-[12px] font-semibold tracking-[-0.008em] ${current ? "text-slate-950" : "text-slate-700"}`}>{module.title}</span>
                          <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{module.questions.length}/{module.targetQuestionCount}</span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-au-fill" aria-hidden="true"><div className="h-full rounded-full bg-au-tint" style={{ width: `${moduleProgress}%` }} /></div>
                          {errors ? <span className="text-[10px] font-semibold text-au-danger-text">{errors} error{errors === 1 ? "" : "s"}</span> : incomplete ? <span className="text-[10px] font-medium text-slate-400">{incomplete} incomplete</span> : module.questions.length === module.targetQuestionCount ? <span className="text-[10px] font-semibold text-au-success-text">Complete</span> : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </motion.div>
      ) : null}
    </div>
  );
}
