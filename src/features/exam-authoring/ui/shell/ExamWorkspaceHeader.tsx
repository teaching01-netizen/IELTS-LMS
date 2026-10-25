import { useId, type ReactNode, type Ref } from "react";
import { motion, useReducedMotion } from "motion/react";
import { spineMotion } from "@/src/shared/motion";
import { AlertTriangle, ArrowLeft, CalendarPlus, Eye, FileUp, MoreHorizontal, Settings2 } from "lucide-react";
import { SatWorkspaceSwitcher } from "@/src/products/sat/ui/SatWorkspaceNav";
import { SatMenu, type SatMenuItem } from "@/src/products/sat/ui/Menu";
import { SatStatusPill } from "@/src/products/sat/ui/SatPage";
import type { ExamLifecycleCopy, ExamWorkspaceTab } from "./examLifecycle";

/** What a surface hosting the header must provide besides its own page content. */
export interface ExamShellNavigation {
  lifecycle: ExamLifecycleCopy;
  showResponses: boolean;
  onSelectTab: (tab: ExamWorkspaceTab) => void;
  onBack: () => void;
  onPreview: () => void;
  /** Opens the room workflow; absent when this staff member cannot create rooms. */
  onCreateSession?: (() => void) | undefined;
  /** Opens the in-place settings sheet; the Settings tab itself is always the page. */
  onQuickSettings?: (() => void) | undefined;
}

export interface ExamWorkspaceHeaderProps {
  examTitle: string;
  /** Lifecycle (draft / published / unpublished changes). Separate from saving. */
  lifecycle: ExamLifecycleCopy;
  /** Tab marked current. `null` on pages that are not a tab (Student access, Publish). */
  activeTab: ExamWorkspaceTab | null;
  /** Hidden for roles that cannot read results (see canViewExamResponses). */
  showResponses: boolean;
  /**
   * Tabs are real navigations. The host decides how to leave (the authoring
   * surface flushes unconfirmed edits before it lets a route change happen).
   */
  onSelectTab: (tab: ExamWorkspaceTab) => void;
  /** Leaves to the Tests list (the breadcrumb's first crumb). */
  onBack: () => void;
  /** Server-confirmed save state, rendered beside (never inside) lifecycle. */
  saveSlot?: ReactNode;
  collaborationSlot?: ReactNode;
  onPreview?: (() => void) | undefined;
  previewDisabled?: boolean;
  /** Primary task action for staff who can create a room. */
  onCreateSession?: (() => void) | undefined;
  /** Optional focus target for hosts that must restore focus after a sheet closes. */
  onCreateSessionRef?: Ref<HTMLButtonElement> | undefined;
  /**
   * Opens the settings sheet over the current page without leaving it. The
   * Settings TAB always navigates to the settings page, so tabs stay real
   * pages for Back, refresh and direct links.
   */
  onQuickSettings?: (() => void) | undefined;
  /** Exam-level issue indicator; opens the grouped list. */
  issueCount?: number;
  onOpenIssues?: (() => void) | undefined;
  /** One visible Import entry; spreadsheet / workbook options live in its menu. */
  importItems?: SatMenuItem[];
  /** Extra overflow items (workbook import, sample exam, shortcuts…). */
  menuItems?: SatMenuItem[];
  /** Short context line under the title (module, section…). */
  contextLine?: string | null;
}

const ACTION = "sat-btn sat-btn--secondary sat-press";
const PRIMARY = "sat-btn sat-btn--primary sat-press";
const QUIET = "sat-btn sat-btn--quiet sat-press px-3";

const TAB_LABEL: Record<ExamWorkspaceTab, string> = {
  questions: "Questions",
  delivery: "Rooms",
  responses: "Responses",
  settings: "Settings",
};

/**
 * The one persistent header for every SAT exam surface: Questions, Settings,
 * Responses, Publish and Student access. Navigation shape never changes
 * between those pages — only the content below the tab row does.
 */
export function ExamWorkspaceHeader(props: ExamWorkspaceHeaderProps) {
  const indicatorId = useId();
  const reduceMotion = useReducedMotion();
  const {
    examTitle, lifecycle, activeTab, showResponses, onSelectTab, onBack, saveSlot, collaborationSlot,
    onPreview, previewDisabled, onCreateSession, onCreateSessionRef, onQuickSettings,
    issueCount = 0, onOpenIssues,
    importItems, menuItems, contextLine,
  } = props;
  // One primary action: Create room. Staff never publish; the server captures
  // the latest saved exam when a room is created.
  const tabs: ExamWorkspaceTab[] = showResponses
    ? ["questions", "delivery", "responses", "settings"]
    : ["questions", "delivery", "settings"];
  // Quick settings lives in the overflow menu so the header keeps to primary actions.
  const overflowItems: SatMenuItem[] = [
    ...(menuItems ?? []),
    ...(onQuickSettings ? [{ id: "quick-settings", label: "Quick settings", icon: Settings2, separatorBefore: true, onSelect: onQuickSettings }] : []),
  ];
  return (
    <header className="exam-workspace-header sticky top-0 z-40 shrink-0 border-b border-[var(--sat-staff-border-header)] bg-[var(--sat-staff-surface-solid-fallback,#fff)]" data-testid="exam-workspace-header">
      <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-1 pt-2 sm:px-6">
        <div className="flex min-w-0 flex-1 basis-56 items-center gap-1">
          <nav aria-label="Breadcrumb" className="sat-breadcrumbs shrink-0">
            <ol className="flex items-center gap-0.5">
              <li className="flex items-center"><SatWorkspaceSwitcher /></li>
              <li aria-hidden="true" className="hidden px-0.5 text-[var(--sat-staff-text-tertiary,#6e6e73)] sm:block">/</li>
              <li className="flex items-center">
                <a
                  href="/sat/exams"
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    onBack();
                  }}
                  aria-label="Exams"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 px-1.5 text-[14px] font-medium leading-5"
                >
                  <ArrowLeft size={18} aria-hidden="true" className="sm:hidden" />
                  <span className="hidden sm:inline">Exams</span>
                </a>
              </li>
              <li aria-hidden="true" className="hidden px-0.5 text-[var(--sat-staff-text-tertiary,#6e6e73)] sm:block">/</li>
            </ol>
          </nav>
          <div className="min-w-0 flex-1 pl-1">
            <h1 className="truncate text-[18px] font-semibold leading-6 tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{examTitle}</h1>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
              <span title={lifecycle.detail ?? undefined} data-testid="exam-lifecycle">
                <SatStatusPill tone={lifecycle.tone}>{lifecycle.label}</SatStatusPill>
              </span>
              {contextLine ? <span className="truncate">{contextLine}</span> : null}
            </div>
          </div>
        </div>
        {collaborationSlot ? <div className="shrink-0">{collaborationSlot}</div> : null}
        {saveSlot ? <div className="shrink-0" data-testid="exam-save-status">{saveSlot}</div> : null}
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:shrink-0">
          {onOpenIssues && issueCount > 0 ? (
            <button
              type="button"
              onClick={onOpenIssues}
              className={`${QUIET} text-[var(--sat-staff-warning-text,#92400e)]`}
              aria-label={`Review ${issueCount} ${issueCount === 1 ? "issue" : "issues"}`}
            >
              <AlertTriangle size={16} aria-hidden="true" />
              {issueCount} {issueCount === 1 ? "issue" : "issues"}
            </button>
          ) : null}
          {importItems && importItems.length > 0 ? (
            <SatMenu
              label="Import questions"
              icon={FileUp}
              align="end"
              width={248}
              triggerClassName={`${QUIET} sat-press`}
              triggerContent={
                <>
                  <FileUp size={16} aria-hidden="true" />
                  <span className="hidden sm:inline">Import</span>
                </>
              }
              items={importItems}
            />
          ) : null}
          {onPreview ? (
            <button type="button" onClick={onPreview} disabled={previewDisabled} aria-label="Preview exam" className={QUIET}>
              <Eye size={16} aria-hidden="true" />
              <span className="hidden lg:inline">Preview</span>
            </button>
          ) : null}
          {onCreateSession ? (
            <button ref={onCreateSessionRef} type="button" onClick={onCreateSession} className={PRIMARY}>
              <CalendarPlus size={16} aria-hidden="true" />
              Create room
            </button>
          ) : null}
          {overflowItems.length > 0 ? (
            <SatMenu compact label="More exam actions" icon={MoreHorizontal} align="end" items={overflowItems} />
          ) : null}
        </div>
      </div>
      <nav aria-label="Exam sections" className="mx-auto w-full max-w-[1240px] px-2 sm:px-4">
        <ul className="flex items-end gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const current = activeTab === tab;
            return (
              <li key={tab}>
                <button
                  type="button"
                  onClick={() => onSelectTab(tab)}
                  aria-current={current ? "page" : undefined}
                  className={`exam-workspace-tab relative inline-flex min-h-11 items-center rounded-t-[var(--sat-staff-radius-control-sm,8px)] px-3 text-[14px] font-semibold leading-5 transition-colors focus-visible:outline-none sm:px-4 ${current ? "text-[var(--sat-staff-text-primary,#1d1d1f)]" : "text-[var(--sat-staff-text-secondary,#515154)] hover:bg-[var(--sat-staff-fill-faint)] hover:text-[var(--sat-staff-text-primary,#1d1d1f)]"}`}
                >
                  {TAB_LABEL[tab]}
                  {current && reduceMotion ? (
                    <span aria-hidden="true" className="sat-tab-indicator" />
                  ) : current ? (
                    <motion.span initial={false} layoutId={indicatorId} transition={spineMotion.selection} aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[var(--sat-staff-accent,#0071e3)]" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
