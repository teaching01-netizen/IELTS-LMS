import { useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Maximize2, Minimize2, RefreshCw, X } from "lucide-react";
import type {
  DeliveredAssessmentModule,
  DeliveredAssessmentSection,
} from "../../exam-authoring/api/assessmentContracts";

function moduleLabel(module: DeliveredAssessmentModule): string {
  if (module.adaptiveRole === "lower_branch") return `${module.title} · Lower path`;
  if (module.adaptiveRole === "higher_branch") return `${module.title} · Higher path`;
  return module.title;
}

export function SatPreviewControls({
  sections,
  section,
  modules,
  module,
  refreshAvailable,
  canPreviousSection,
  canNextSection,
  canPreviousModule,
  canNextModule,
  onRefresh,
  onSectionChange,
  onModuleChange,
  onPreviousSection,
  onNextSection,
  onPreviousModule,
  onNextModule,
  onShowBreak,
  onExit,
}: {
  sections: readonly DeliveredAssessmentSection[];
  section: DeliveredAssessmentSection;
  modules: readonly DeliveredAssessmentModule[];
  module: DeliveredAssessmentModule;
  refreshAvailable: boolean;
  canPreviousSection: boolean;
  canNextSection: boolean;
  canPreviousModule: boolean;
  canNextModule: boolean;
  onRefresh: () => void;
  onSectionChange: (sectionId: string) => void;
  onModuleChange: (moduleId: string) => void;
  onPreviousSection: () => void;
  onNextSection: () => void;
  onPreviousModule: () => void;
  onNextModule: () => void;
  onShowBreak: () => void;
  onExit: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (collapsed) {
    return (
      <aside
        className="fixed left-3 top-2 z-[150] flex items-center gap-1 rounded-full border border-black/10 bg-white/95 p-1.5 shadow-lg backdrop-blur-xl"
        aria-label="SAT staff preview controls"
      >
        <span className="flex h-9 items-center gap-2 rounded-full bg-slate-950 px-3 text-xs font-semibold text-white">
          <Eye className="h-4 w-4" />
          Staff preview
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand preview controls"
          className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onExit}
          aria-label="Exit preview"
          className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </aside>
    );
  }
  return (
    <aside
      className="fixed left-1/2 top-2 z-[150] w-[min(1120px,calc(100vw-24px))] -translate-x-1/2 rounded-2xl border border-black/10 bg-white/95 p-2 shadow-xl backdrop-blur-xl"
      aria-label="SAT staff preview controls"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-h-10 items-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-semibold text-white">
          <Eye className="h-4 w-4" aria-hidden="true" />
          Staff preview
          <span className="hidden font-normal text-white/65 sm:inline">
            All adaptive variants · no responses saved
          </span>
        </div>
        <select
          aria-label="Preview section"
          value={section.id}
          onChange={(event) => onSectionChange(event.target.value)}
          className="h-10 min-w-[170px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800"
        >
          {sections.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title}
            </option>
          ))}
        </select>
        <select
          aria-label="Preview module"
          value={module.id}
          onChange={(event) => onModuleChange(event.target.value)}
          className="h-10 min-w-[190px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800"
        >
          {modules.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {moduleLabel(candidate)}
            </option>
          ))}
        </select>
        <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={onPreviousSection}
            disabled={!canPreviousSection}
            className="flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-30"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Section
          </button>
          <button
            type="button"
            onClick={onNextSection}
            disabled={!canNextSection}
            className="flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-30"
          >
            Section
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={onPreviousModule}
            disabled={!canPreviousModule}
            className="flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-30"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Module
          </button>
          <button
            type="button"
            onClick={onNextModule}
            disabled={!canNextModule}
            className="flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-30"
          >
            Module
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {section.breakAfterSeconds > 0 ? (
          <button
            type="button"
            onClick={onShowBreak}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
          >
            Preview break
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse preview controls"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
          {refreshAvailable ? (
            <button
              type="button"
              onClick={onRefresh}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-amber-50 px-3 text-[11px] font-semibold text-amber-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Draft changed · Refresh
            </button>
          ) : null}
          <button
            type="button"
            onClick={onExit}
            aria-label="Exit preview"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
