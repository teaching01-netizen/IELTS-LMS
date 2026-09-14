import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AssessmentModuleShell, AssessmentSectionShell } from "../../contracts/assessment";
import { moduleReadyCount } from "./queueModel";

export interface ModuleSwitcherProps {
  sections: AssessmentSectionShell[];
  selectedModuleId: string;
  disabled?: boolean;
  onSelectModule: (moduleId: string) => void;
  onSelectSection?: ((sectionId: string) => void) | undefined;
}

interface TabItem {
  id: string;
  title: string;
  meta: string;
  value: number;
  target: number;
  selected: boolean;
}

export function ModuleSwitcher({
  sections,
  selectedModuleId,
  disabled = false,
  onSelectModule,
  onSelectSection,
}: ModuleSwitcherProps) {
  const selected = findSelected(sections, selectedModuleId);
  if (!selected) return null;
  const sectionTabs: TabItem[] = sections.map((section) => ({
    id: section.id,
    title: section.title,
    meta: `${countAuthored(section.modules)} / ${countTarget(section.modules)}`,
    value: countAuthored(section.modules),
    target: countTarget(section.modules),
    selected: section.id === selected.section.id,
  }));
  const moduleTabs: TabItem[] = selected.section.modules.map((module) => ({
    id: module.id,
    title: module.title,
    meta: `${moduleReadyCount(module)} of ${module.targetQuestionCount} ready`,
    value: moduleReadyCount(module),
    target: module.targetQuestionCount,
    selected: module.id === selected.module.id,
  }));
  return (
    <div className="sat-spine__nav">
      {sectionTabs.length > 1 ? (
        <TabStrip
          label="SAT sections"
          items={sectionTabs}
          disabled={disabled}
          onSelect={(sectionId) => {
            const section = sections.find((item) => item.id === sectionId);
            const first = section?.modules[0];
            if (!first) return;
            if (onSelectSection) onSelectSection(sectionId);
            else onSelectModule(first.id);
          }}
        />
      ) : null}
      <TabStrip
        label={`${selected.section.title} modules`}
        items={moduleTabs}
        disabled={disabled}
        variant="module"
        onSelect={onSelectModule}
      />
    </div>
  );
}

function TabStrip({
  label,
  items,
  disabled,
  onSelect,
  variant = "section",
}: {
  label: string;
  items: TabItem[];
  disabled: boolean;
  onSelect: (id: string) => void;
  variant?: "section" | "module";
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const currentIndex = items.findIndex((item) => item.selected);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (currentIndex < 0) return;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (currentIndex + 1) % items.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const id = items[next]?.id;
    if (!id) return;
    onSelect(id);
    window.requestAnimationFrame(() => {
      stripRef.current
        ?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)
        ?.focus();
    });
  };
  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={variant === "module" ? "sat-spine__modules" : "sat-spine__sections"}
    >
      {items.map((item) => {
        const percent = item.target > 0 ? Math.min(100, (item.value / item.target) * 100) : 0;
        const ready = item.target > 0 && item.value >= item.target;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            data-tab-id={item.id}
            aria-selected={item.selected}
            tabIndex={item.selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onSelect(item.id)}
            aria-label={`${item.title}, ${item.value} of ${item.target} ${
              variant === "module" ? "questions ready" : "authored"
            }${item.selected ? ", selected" : ""}`}
            className={`sat-spine__tab sat-spine__tab--${variant}${item.selected ? " is-selected" : ""}${ready && variant === "module" ? " is-complete" : ""}`}
          >
            <span className="sat-spine__tab-text">
              <span className="sat-spine__tab-title">{item.title}</span>
              <span className="sat-spine__tab-meta">
                {variant === "module" && ready ? (
                  <span className="sat-spine__tab-dot" aria-hidden="true" />
                ) : null}
                {item.meta}
              </span>
            </span>
            {variant === "module" ? (
              <span className="sat-spine__tab-bar" aria-hidden="true">
                <span style={{ width: `${percent}%` }} />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function findSelected(sections: AssessmentSectionShell[], moduleId: string) {
  for (const section of sections) {
    const module = section.modules.find((candidate) => candidate.id === moduleId);
    if (module) return { section, module };
  }
  return null;
}

function countAuthored(modules: AssessmentModuleShell[]): number {
  return modules.reduce((sum, module) => sum + module.questions.length, 0);
}

function countTarget(modules: AssessmentModuleShell[]): number {
  return modules.reduce((sum, module) => sum + module.targetQuestionCount, 0);
}
