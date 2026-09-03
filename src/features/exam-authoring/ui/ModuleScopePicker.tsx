import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { AssessmentSectionShell } from "../contracts/assessment";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/src/components/ui/dropdown-menu";

export interface ModuleScopePickerProps {
  sections: AssessmentSectionShell[];
  selectedModuleId: string;
  disabled?: boolean;
  onSelectModule: (moduleId: string) => void;
}

export function ModuleScopePicker({
  sections,
  selectedModuleId,
  disabled = false,
  onSelectModule,
}: ModuleScopePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => {
    for (const section of sections) {
      const module = section.modules.find((candidate) => candidate.id === selectedModuleId);
      if (module) return { section, module };
    }
    return null;
  }, [sections, selectedModuleId]);

  if (!selected) return null;
  const authored = selected.module.questions.length;
  const target = selected.module.targetQuestionCount;
  const progress = target > 0 ? Math.min(100, (authored / target) * 100) : 0;

  // Radix is the production path. The static branch keeps the same contract
  // in constrained environments (SSR/jsdom) where Radix cannot measure a
  // popper or manage a real viewport.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return (
      <StaticModuleScopePicker
        sections={sections}
        selectedModuleId={selectedModuleId}
        disabled={disabled}
        onSelectModule={onSelectModule}
      />
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Choose module. Current: ${selected.section.title}, ${selected.module.title}, ${authored} of ${target} authored`}
          className="group flex min-h-11 max-w-full flex-1 items-center gap-2 rounded-[12px] px-2 py-1.5 text-left outline-none transition hover:bg-au-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-au-accent disabled:opacity-45"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
              {selected.section.title}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold tracking-[-0.012em] text-slate-950">
                {selected.module.title}
              </span>
              <ChevronDown
                size={12}
                className="shrink-0 text-slate-400 transition-transform duration-200 group-data-[state=open]:rotate-180"
                aria-hidden="true"
              />
            </div>
          </div>
          <div className="w-[54px] shrink-0 text-right">
            <div className="text-[11px] font-semibold tabular-nums text-slate-500">
              {authored}/{target}
            </div>
            <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-au-fill" aria-hidden="true">
              <div
                className="h-full rounded-full bg-au-accent transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        aria-label="Choose SAT module"
        onEscapeKeyDown={() => setOpen(false)}
        data-au-section={selected.section.sectionKey}
        className="sat-product sat-authoring sat-module-menu au-elevation-menu isolate z-[110] max-h-[min(520px,calc(100dvh-112px))] w-[340px] max-w-[calc(100vw-24px)] overflow-y-auto overscroll-contain rounded-[14px] border border-au-separator bg-au-surface p-1.5"
      >
        <DropdownMenuRadioGroup
          value={selectedModuleId}
          onValueChange={(moduleId) => {
            setOpen(false);
            if (moduleId !== selectedModuleId) onSelectModule(moduleId);
          }}
        >
          {sections.map((section, sectionIndex) => (
            <div key={section.id}>
              {sectionIndex ? <DropdownMenuSeparator className="my-2" /> : null}
              <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5">
                <DropdownMenuLabel className="p-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                  {section.title}
                </DropdownMenuLabel>
                <span className="text-[10px] tabular-nums text-slate-400">
                  {Math.round(section.durationSeconds / 60)} min
                </span>
              </div>
              <div className="space-y-0.5">
                {section.modules.map((module) => {
                  const current = module.id === selectedModuleId;
                  const errors = module.questions.filter(
                    (question) => question.readiness.status === "error"
                  ).length;
                  const incomplete = module.questions.filter(
                    (question) => question.readiness.status === "incomplete"
                  ).length;
                  const moduleProgress =
                    module.targetQuestionCount > 0
                      ? Math.min(100, (module.questions.length / module.targetQuestionCount) * 100)
                      : 0;
                  return (
                    <DropdownMenuRadioItem
                      key={module.id}
                      value={module.id}
                      className={`flex min-h-[58px] w-full items-center gap-2 rounded-[10px] !pl-2.5 px-2.5 py-2.5 text-left outline-none focus-visible:ring-4 focus-visible:ring-au-accent/10 ${current ? "bg-au-tint-soft-strong text-slate-950" : "text-slate-700 hover:bg-au-fill"}`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${current ? "bg-au-tint text-white" : "text-transparent"}`}
                        aria-hidden="true"
                      >
                        <Check size={11} strokeWidth={3} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-[12px] font-semibold tracking-[-0.008em]">
                            {module.title}
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                            {module.questions.length}/{module.targetQuestionCount}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div
                            className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-au-fill"
                            aria-hidden="true"
                          >
                            <div
                              className="h-full rounded-full bg-au-tint"
                              style={{ width: `${moduleProgress}%` }}
                            />
                          </div>
                          {errors ? (
                            <span className="text-[10px] font-semibold text-au-danger-text">
                              {errors} error{errors === 1 ? "" : "s"}
                            </span>
                          ) : incomplete ? (
                            <span className="text-[10px] font-medium text-slate-400">
                              {incomplete} incomplete
                            </span>
                          ) : module.questions.length === module.targetQuestionCount ? (
                            <span className="text-[10px] font-semibold text-au-success-text">
                              Complete
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </DropdownMenuRadioItem>
                  );
                })}
              </div>
            </div>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StaticModuleScopePicker({
  sections,
  selectedModuleId,
  disabled,
  onSelectModule,
}: ModuleScopePickerProps) {
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
      (menuRef.current?.querySelector<HTMLButtonElement>('[data-current="true"]') ??
        menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]'))?.focus();
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

  const closeMenu = (restoreFocus = false) => {
    if (restoreFocus) triggerRef.current?.focus();
    setOpen(false);
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
    );
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (!menuItems.length) return;
    const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    const moveTo = (index: number) => {
      event.preventDefault();
      menuItems[(index + menuItems.length) % menuItems.length]?.focus();
    };
    if (event.key === "ArrowDown") moveTo(currentIndex < 0 ? 0 : currentIndex + 1);
    else if (event.key === "ArrowUp") moveTo(currentIndex < 0 ? menuItems.length - 1 : currentIndex - 1);
    else if (event.key === "Home") moveTo(0);
    else if (event.key === "End") moveTo(menuItems.length - 1);
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
          <div className="truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
            {selected.section.title}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold tracking-[-0.012em] text-slate-950">
              {selected.module.title}
            </span>
            <ChevronDown
              size={12}
              className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </div>
        </div>
        <div className="w-[54px] shrink-0 text-right">
          <div className="text-[11px] font-semibold tabular-nums text-slate-500">
            {authored}/{target}
          </div>
          <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-au-fill" aria-hidden="true">
            <div
              className="h-full rounded-full bg-au-accent transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
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
          data-au-section={selected.section.sectionKey}
          className="sat-product sat-authoring au-elevation-menu absolute left-0 top-[calc(100%+6px)] z-[110] max-h-[min(520px,calc(100vh-112px))] w-[340px] max-w-[calc(100vw-24px)] isolate overflow-y-auto overscroll-contain rounded-[14px] border border-au-separator bg-au-surface p-1.5"
        >
          {sections.map((section, sectionIndex) => (
            <div key={section.id}>
              {sectionIndex ? <div className="my-2 h-px bg-au-separator" role="separator" /> : null}
              <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                  {section.title}
                </span>
                <span className="text-[10px] tabular-nums text-slate-400">
                  {Math.round(section.durationSeconds / 60)} min
                </span>
              </div>
              <div className="space-y-0.5">
                {section.modules.map((module) => {
                  const current = module.id === selectedModuleId;
                  const errors = module.questions.filter(
                    (question) => question.readiness.status === "error"
                  ).length;
                  const incomplete = module.questions.filter(
                    (question) => question.readiness.status === "incomplete"
                  ).length;
                  const moduleProgress =
                    module.targetQuestionCount > 0
                      ? Math.min(100, (module.questions.length / module.targetQuestionCount) * 100)
                      : 0;
                  return (
                    <button
                      key={module.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={current}
                      data-current={current ? "true" : "false"}
                      onClick={() => {
                        closeMenu(true);
                        if (!current) onSelectModule(module.id);
                      }}
                      className={`flex min-h-[58px] w-full items-center gap-2 rounded-[10px] px-2.5 py-2.5 text-left outline-none transition focus-visible:ring-4 focus-visible:ring-au-accent/10 ${current ? "bg-au-tint-soft-strong text-slate-950" : "text-slate-700 hover:bg-au-fill"}`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${current ? "bg-au-tint text-white" : "text-transparent"}`}
                        aria-hidden="true"
                      >
                        <Check size={11} strokeWidth={3} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-[12px] font-semibold tracking-[-0.008em]">
                            {module.title}
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                            {module.questions.length}/{module.targetQuestionCount}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-au-fill" aria-hidden="true">
                            <div
                              className="h-full rounded-full bg-au-tint"
                              style={{ width: `${moduleProgress}%` }}
                            />
                          </div>
                          {errors ? (
                            <span className="text-[10px] font-semibold text-au-danger-text">
                              {errors} error{errors === 1 ? "" : "s"}
                            </span>
                          ) : incomplete ? (
                            <span className="text-[10px] font-medium text-slate-400">
                              {incomplete} incomplete
                            </span>
                          ) : module.questions.length === module.targetQuestionCount ? (
                            <span className="text-[10px] font-semibold text-au-success-text">
                              Complete
                            </span>
                          ) : null}
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
