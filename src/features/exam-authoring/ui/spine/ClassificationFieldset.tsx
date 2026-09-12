import { useId } from "react";
import { Label } from "@/src/components/ui/label";
import { SAT_DOMAINS, getSatSkills } from "../../providers/sat/taxonomy";
import type {
  AssessmentValidationIssue,
  Difficulty,
  QuestionRevision,
} from "../../contracts/assessment";

export interface ClassificationFieldsetProps {
  question: QuestionRevision;
  onChange: (question: QuestionRevision) => void;
  issues: AssessmentValidationIssue[];
}

/**
 * Single classification group (plan Phase 4): the ONLY place in the spine
 * where domain/skill/difficulty/tags are edited. Visible labels, difficulty
 * as a radiogroup, and blocking domain/skill issues inline via
 * aria-describedby — never a far rail, never a second copy.
 */
export function ClassificationFieldset({ question, onChange, issues }: ClassificationFieldsetProps) {
  const baseId = useId();
  const domainId = `${baseId}-domain`;
  const skillId = `${baseId}-skill`;
  const tagsId = `${baseId}-tags`;
  const domainErrorId = `${baseId}-domain-error`;
  const skillErrorId = `${baseId}-skill-error`;
  const domains =
    question.metadata.sectionKey === "math" ? SAT_DOMAINS.math : SAT_DOMAINS["reading-writing"];
  const skills = getSatSkills(question.metadata.domain);
  const domainError = issues.find(
    (issue) => issue.blocking && issue.path.startsWith("metadata.domain"),
  );
  const skillError = issues.find(
    (issue) => issue.blocking && issue.path.startsWith("metadata.skill"),
  );

  const updateDomain = (domain: string | null) => {
    const nextSkills = getSatSkills(domain);
    const skill =
      question.metadata.skill && nextSkills.includes(question.metadata.skill)
        ? question.metadata.skill
        : null;
    onChange({ ...question, metadata: { ...question.metadata, domain, skill } });
  };

  return (
    <fieldset className="min-w-0">
      <legend className="px-1 text-sm font-semibold text-foreground">Classification</legend>
      <p className="mb-4 text-xs leading-5 text-muted-foreground">
        Organize this question for review and reuse.
      </p>
      <div className="space-y-4">
        <div data-authoring-field="domain" className="flex flex-col gap-1.5">
          <Label htmlFor={domainId}>Domain</Label>
          <select
            id={domainId}
            value={question.metadata.domain ?? ""}
            onChange={(event) => updateDomain(event.target.value || null)}
            aria-invalid={Boolean(domainError)}
            aria-describedby={domainError ? domainErrorId : undefined}
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25"
          >
            <option value="">Choose domain…</option>
            {domains.map((domain) => (
              <option key={domain.key} value={domain.key}>
                {domain.label}
              </option>
            ))}
          </select>
          {domainError ? (
            <p id={domainErrorId} role="alert" className="text-xs font-medium text-destructive">
              {domainError.message}
            </p>
          ) : null}
        </div>

        <div data-authoring-field="skill" className="flex flex-col gap-1.5">
          <Label htmlFor={skillId}>Skill</Label>
          <select
            id={skillId}
            value={question.metadata.skill ?? ""}
            onChange={(event) =>
              onChange({
                ...question,
                metadata: { ...question.metadata, skill: event.target.value || null },
              })
            }
            disabled={skills.length === 0}
            aria-invalid={Boolean(skillError)}
            aria-describedby={skillError ? skillErrorId : undefined}
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <option value="">{skills.length > 0 ? "Choose skill…" : "Choose a domain first"}</option>
            {skills.map((skill) => (
              <option key={skill} value={skill}>
                {skill}
              </option>
            ))}
          </select>
          {skillError ? (
            <p id={skillErrorId} role="alert" className="text-xs font-medium text-destructive">
              {skillError.message}
            </p>
          ) : null}
        </div>

        <div data-authoring-field="difficulty" className="flex flex-col gap-1.5">
          <span id={`${baseId}-difficulty-label`} className="text-sm font-medium leading-none">
            Difficulty
          </span>
          <div role="radiogroup" aria-labelledby={`${baseId}-difficulty-label`} className="flex gap-1 rounded-md border border-input bg-muted p-1">
            {(["easy", "medium", "hard"] as Difficulty[]).map((difficulty) => {
              const checked = question.metadata.difficulty === difficulty;
              return (
                <button
                  key={difficulty}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() =>
                    onChange({ ...question, metadata: { ...question.metadata, difficulty } })
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                    event.preventDefault();
                    const order: Difficulty[] = ["easy", "medium", "hard"];
                    const current = order.indexOf(question.metadata.difficulty);
                    const next = order[(current + (event.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
                    if (next) onChange({ ...question, metadata: { ...question.metadata, difficulty: next } });
                  }}
                  className={`min-h-11 flex-1 rounded px-2 text-xs font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${checked ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {difficulty}
                </button>
              );
            })}
          </div>
        </div>

        <div data-authoring-field="tags" className="flex flex-col gap-1.5">
          <Label htmlFor={tagsId}>Tags</Label>
          <input
            id={tagsId}
            aria-label="Tags"
            value={question.metadata.tags.join(", ")}
            onChange={(event) =>
              onChange({
                ...question,
                metadata: {
                  ...question.metadata,
                  tags: event.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                },
              })
            }
            placeholder="e.g. linear, no-calculator"
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25"
          />
          <p className="text-xs leading-4 text-muted-foreground">
            Use commas to add searchable internal tags.
          </p>
        </div>
      </div>
    </fieldset>
  );
}
