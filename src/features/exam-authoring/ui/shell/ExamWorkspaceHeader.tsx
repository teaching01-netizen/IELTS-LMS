import type { ReactNode } from "react";
import { motion } from "motion/react";
import { AlertTriangle, ArrowLeft, CalendarPlus, Eye, FileUp, MoreHorizontal, Send, Settings2 } from "lucide-react";
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
  onPublish?: (() => void) | undefined;
  /** Opens session setup for the current published version; absent when the viewer cannot create sessions. */
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
  /** Leaves to the Exam Library (the breadcrumb's first crumb). */
  onBack: () => void;
  /** Server-confirmed save state, rendered beside (never inside) lifecycle. */
  saveSlot?: ReactNode;
  collaborationSlot?: ReactNode;
  onPreview?: (() => void) | undefined;
  previewDisabled?: boolean;
  onPublish?: (() => void) | undefined;
  /** Primary action once a version is published: prepare a sitting. */
  onCreateSession?: (() => void) | undefined;
  /**
   * Opens the settings sheet over the current page without leaving it. The
   * Settings TAB always navigates to the settings page, so tabs stay real
   * pages for Back, refresh and direct links.
   */
  onQuickSettings?: (() => void) | undefined;
  publishDisabledReason?: string | null;
  publishLabel?: string;
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

const ACTION = "authoring-button min-h-11";
const PRIMARY = "authoring-button authoring-button--primary min-h-11";
const QUIET = "authoring-button authoring-button--quiet min-h-11";

const TAB_LABEL: Record<ExamWorkspaceTab, string> = {
  questions: "Questions",
  delivery: "Sessions",
  responses: "Results",
  settings: "Settings",
};

/**
 * The one persistent header for every SAT exam surface: Questions, Settings,
 * Responses, Publish and Student access. Navigation shape never changes
 * between those pages — only the content below the tab row does.
 */
export function ExamWorkspaceHeader(props: ExamWorkspaceHeaderProps) {
  const {
    examTitle, lifecycle, activeTab, showResponses, onSelectTab, onBack, saveSlot, collaborationSlot,
    onPreview, previewDisabled, onPublish, onCreateSession, onQuickSettings,
    publishDisabledReason, publishLabel = "Publish", issueCount = 0, onOpenIssues,
    importItems, menuItems, contextLine,
  } = props;
  // A draft with changes leads with Publish; once a version is current the next step is a session.
  const createIsPrimary = lifecycle.tone !== "changes" && lifecycle.tone !== "draft";
  const tabs: ExamWorkspaceTab[] = showResponses
    ? ["questions", "delivery", "responses", "settings"]
    : ["questions", "delivery", "settings"];
  return (
    <header className="exam-workspace-header sticky top-0 z-40 shrink-0 border-b border-border bg-card" data-testid="exam-workspace-header">
      <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-1 pt-2 sm:px-6">
        <div className="flex min-w-0 flex-1 basis-48 items-center gap-1">
          <nav aria-label="Breadcrumb" className="shrink-0">
            <ol className="flex items-center gap-1">
              <li>
                <button type="button" onClick={onBack} aria-label="Exam Library" className={`${QUIET} min-w-11 px-2 text-muted-foreground hover:text-foreground`}>
                  <ArrowLeft size={17} aria-hidden="true" className="sm:hidden" />
                  <span className="hidden sm:inline">Exam Library</span>
                </button>
              </li>
              <li aria-hidden="true" className="hidden text-muted-foreground sm:block">/</li>
            </ol>
          </nav>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-[-0.01em] text-foreground">{examTitle}</h1>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span title={lifecycle.detail ?? undefined} data-testid="exam-lifecycle">
                <SatStatusPill tone={lifecycle.tone}>{lifecycle.label}</SatStatusPill>
              </span>
              {contextLine ? <span className="truncate">{contextLine}</span> : null}
            </div>
          </div>
        </div>
        {collaborationSlot ? <div className="shrink-0">{collaborationSlot}</div> : null}
        {saveSlot ? <div className="shrink-0" data-testid="exam-save-status">{saveSlot}</div> : null}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
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
          {onQuickSettings ? (
            <button type="button" onClick={onQuickSettings} aria-label="Quick settings" className={QUIET}>
              <Settings2 size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Quick settings</span>
            </button>
          ) : null}
          {onPreview ? (
            <button type="button" onClick={onPreview} disabled={previewDisabled} aria-label="Preview exam" className={QUIET}>
              <Eye size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Preview exam</span>
            </button>
          ) : null}
          {onPublish ? (
            <button
              type="button"
              onClick={onPublish}
              disabled={Boolean(publishDisabledReason)}
              title={publishDisabledReason ?? undefined}
              className={onCreateSession && createIsPrimary ? ACTION : PRIMARY}
            >
              <Send size={16} aria-hidden="true" />
              {publishLabel}
            </button>
          ) : null}
          {onCreateSession ? (
            <button type="button" onClick={onCreateSession} className={createIsPrimary ? PRIMARY : ACTION}>
              <CalendarPlus size={16} aria-hidden="true" />
              Create session
            </button>
          ) : null}
          {menuItems && menuItems.length > 0 ? (
            <SatMenu compact label="More exam actions" icon={MoreHorizontal} align="end" items={menuItems} />
          ) : null}
        </div>
      </div>
      <nav aria-label="Exam sections" className="mx-auto w-full max-w-[1240px] px-2 sm:px-5">
        <ul className="flex items-end gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const current = activeTab === tab;
            return (
              <li key={tab}>
                <button
                  type="button"
                  onClick={() => onSelectTab(tab)}
                  aria-current={current ? "page" : undefined}
                  className={`exam-workspace-tab relative inline-flex min-h-11 items-center px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${current ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {TAB_LABEL[tab]}
                  {current ? (
                    <motion.span layoutId="exam-tab-indicator" transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[var(--sat-staff-accent,#0071e3)]" />
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
