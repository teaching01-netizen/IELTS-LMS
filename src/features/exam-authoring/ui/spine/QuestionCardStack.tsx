import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, CircleDashed, ListTree, Plus } from "lucide-react";
import type {
  AssessmentModuleShell,
  AssessmentQuestionSummary,
  AssessmentSectionShell,
} from "../../contracts/assessment";
import { ModuleSwitcher } from "./ModuleSwitcher";
import { moduleReadyCount } from "./queueModel";

export interface CardStatus {
  tone: "ready" | "incomplete" | "error";
  /** Short chip text: Ready / Incomplete / Needs attention. */
  label: string;
  /** Full sentence for assistive tech. Always words, never colour or an icon alone. */
  text: string;
  /** What is missing, in author words; shown on the card's summary line. */
  missing: string[];
  /** Editor field to open first when the card is chosen (the first missing one). */
  field: "prompt" | "answer" | "domain" | "skill" | null;
}

/**
 * Plain-language status for a collapsed card, derived from the same readiness
 * the queue and the publish gate use. It names what is missing so an author can
 * see what is unfinished without opening the card, and opening the card lands
 * on the first missing field.
 */
export function describeCardStatus(question: AssessmentQuestionSummary): CardStatus {
  if (question.readiness.status === "ready") return { tone: "ready", label: "Ready", text: "Ready", missing: [], field: null };
  const gaps: Array<{ label: string; field: NonNullable<CardStatus["field"]> }> = [];
  if (!question.promptPreview.trim()) gaps.push({ label: "question text", field: "prompt" });
  if (!question.answerKeyPreview) {
    gaps.push({ label: question.questionType === "single_choice" ? "answer key" : "accepted answer", field: "answer" });
  }
  if (!question.domain) gaps.push({ label: "Domain", field: "domain" });
  if (!question.skill) gaps.push({ label: "Skill", field: "skill" });
  const missing = gaps.map((gap) => gap.label);
  const label = question.readiness.status === "error" ? "Needs attention" : "Incomplete";
  return {
    tone: question.readiness.status === "error" ? "error" : "incomplete",
    label,
    text: missing.length > 0 ? `${label} · Missing ${missing.join(", ")}` : label,
    missing,
    field: gaps[0]?.field ?? null,
  };
}

const STATUS_ICON = { ready: CheckCircle2, incomplete: CircleDashed, error: AlertCircle } as const;

export interface QuestionCardStackProps {
  module: AssessmentModuleShell;
  sections: AssessmentSectionShell[];
  sectionTitle: string;
  selectedQuestionId: string | null;
  isMutating: boolean;
  /** Shown only while the outline rail is closed; the rail carries its own copy. */
  showModuleSwitcher: boolean;
  onSelectModule: (moduleId: string) => void;
  /** `field` is the editor field to focus once the question opens (its first gap). */
  onSelectQuestion: (questionId: string, field?: CardStatus["field"]) => void;
  onAddQuestion: () => void;
  /** Outline (search / filter / bulk) rail toggle; omitted on compact screens. */
  outlineOpen?: boolean | undefined;
  onToggleOutline?: (() => void) | undefined;
  /** Compact screens open the same outline as a sheet. */
  onOpenOutlineSheet?: (() => void) | undefined;
  presenceSlot?: ((examQuestionId: string) => ReactNode) | undefined;
  /** The ONE mounted editor (or its loading / error surface) for the active card. */
  activeCard: ReactNode;
}

/**
 * Google-Forms-style module canvas: a vertical sequence of question cards. The
 * active card hosts the single rich editor; every other card is a compact
 * summary. Nothing here owns selection, saving or ordering — it renders what the
 * workspace passes and reports clicks.
 */
export function QuestionCardStack({
  module,
  sections,
  sectionTitle,
  selectedQuestionId,
  isMutating,
  showModuleSwitcher,
  onSelectModule,
  onSelectQuestion,
  onAddQuestion,
  outlineOpen,
  onToggleOutline,
  onOpenOutlineSheet,
  presenceSlot,
  activeCard,
}: QuestionCardStackProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollMemory = useRef(new Map<string, number>());
  const activeModule = useRef(module.id);

  // Each module is re-entered at the scroll offset it was left at.
  useLayoutEffect(() => {
    const scroller = rootRef.current?.closest<HTMLElement>(".sat-spine__main");
    const previous = activeModule.current;
    if (!scroller || previous === module.id) return;
    scrollMemory.current.set(previous, scroller.scrollTop);
    activeModule.current = module.id;
    const remembered = scrollMemory.current.get(module.id) ?? 0;
    window.requestAnimationFrame(() => {
      scroller.scrollTop = remembered;
    });
  }, [module.id]);

  // Choosing a card brings it into view (smoothly, unless the reader prefers
  // reduced motion). The first render never scrolls.
  const lastSelected = useRef(selectedQuestionId);
  useEffect(() => {
    if (lastSelected.current === selectedQuestionId) return;
    lastSelected.current = selectedQuestionId;
    if (!selectedQuestionId) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    rootRef.current
      ?.querySelector<HTMLElement>('[data-question-card="active"]')
      ?.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [selectedQuestionId]);

  // Arrow Up / Down walks the summary cards without tabbing through every control.
  const onListKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const target = event.target as HTMLElement;
    if (target.dataset["questionCard"] !== "summary") return;
    const summaries = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-question-card="summary"]')];
    const next = summaries[summaries.indexOf(target) + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  const total = module.questions.length;
  const ready = moduleReadyCount(module);
  const atCapacity = total >= module.targetQuestionCount;
  const addDisabled = isMutating || atCapacity;

  return (
    <div ref={rootRef} className="sat-cards" data-testid="question-card-stack">
      {showModuleSwitcher ? (
        <ModuleSwitcher
          sections={sections}
          selectedModuleId={module.id}
          disabled={isMutating}
          onSelectModule={onSelectModule}
        />
      ) : null}
      <div className="sat-cards__bar">
        <div className="min-w-0">
          <h2 className="sat-cards__title">
            {sectionTitle} · {module.title}
          </h2>
          <p className="sat-cards__count" aria-live="polite">
            {total} of {module.targetQuestionCount} questions · {ready} ready
          </p>
        </div>
        {onToggleOutline ? (
          <button
            type="button"
            className="sat-cards__outline-toggle"
            aria-pressed={Boolean(outlineOpen)}
            onClick={onToggleOutline}
          >
            <ListTree size={16} aria-hidden="true" />
            Question outline
          </button>
        ) : onOpenOutlineSheet ? (
          <button type="button" className="sat-cards__outline-toggle" onClick={onOpenOutlineSheet}>
            <ListTree size={16} aria-hidden="true" />
            Question outline
          </button>
        ) : null}
      </div>

      {total === 0 ? (
        <div className="sat-card sat-card--empty">
          <p className="sat-card__empty-title">No questions in {module.title} yet</p>
          <p className="sat-card__empty-hint">
            Add the first question, or use Import to bring in several at once.
          </p>
        </div>
      ) : (
        <ol className="sat-cards__list" aria-label="Questions in this module" onKeyDown={onListKeyDown}>
          {module.questions.map((question, index) => {
            const number = index + 1;
            const active = question.examQuestionId === selectedQuestionId;
            if (active) {
              return (
                <li key={question.examQuestionId} className="sat-cards__item">
                  <section
                    className="sat-card sat-card--active"
                    aria-label={`Question ${number}, editing`}
                    data-question-card="active"
                    data-question-id={question.examQuestionId}
                  >
                    {activeCard}
                  </section>
                </li>
              );
            }
            const status = describeCardStatus(question);
            const StatusIcon = STATUS_ICON[status.tone];
            const typeLabel =
              question.questionType === "single_choice" ? "Multiple choice" : "Student response";
            return (
              <li key={question.examQuestionId} className="sat-cards__item">
                <button
                  type="button"
                  className="sat-card sat-card--summary"
                  data-question-card="summary"
                  data-question-id={question.examQuestionId}
                  data-card-tone={status.tone}
                  aria-label={`Question ${number}. ${status.text}. Open to edit`}
                  onClick={() => onSelectQuestion(question.examQuestionId, status.field)}
                >
                  <span className="sat-card__number" aria-hidden="true">
                    {number}
                  </span>
                  <span className="sat-card__summary">
                    <span className="sat-card__preview">
                      {question.promptPreview.trim() || "No question text yet"}
                    </span>
                    <span className="sat-card__meta" data-tone={status.missing.length > 0 ? status.tone : undefined}>
                      {status.missing.length > 0
                        ? `Missing ${status.missing.join(", ")}`
                        : `${typeLabel}${question.answerKeyPreview
                          ? ` · Answer ${question.questionType === "single_choice" ? question.answerKeyPreview : "set"}`
                          : ""}${question.domain ? ` · ${question.domain}` : ""}`}
                    </span>
                  </span>
                  <span className="sat-card__status" data-tone={status.tone}>
                    <StatusIcon size={15} aria-hidden="true" />
                    {status.label}
                  </span>
                </button>
                {presenceSlot ? (
                  <span className="sat-card__presence">{presenceSlot(question.examQuestionId)}</span>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <div className="sat-cards__footer">
        <button
          type="button"
          className="sat-cards__add"
          onClick={onAddQuestion}
          disabled={addDisabled}
          aria-describedby={atCapacity ? "sat-cards-capacity" : undefined}
        >
          <Plus size={16} aria-hidden="true" />
          Add question
        </button>
        {atCapacity ? (
          <p id="sat-cards-capacity" className="sat-cards__hint">
            {module.title} has all {module.targetQuestionCount} questions. Delete one to add another.
          </p>
        ) : (
          <p className="sat-cards__hint">
            New questions are added after the one you are editing.
          </p>
        )}
      </div>
    </div>
  );
}
