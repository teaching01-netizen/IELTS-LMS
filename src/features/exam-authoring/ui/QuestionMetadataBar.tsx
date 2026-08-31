import { SAT_DOMAINS, getSatSkills } from "../providers/sat/taxonomy";
import type { Difficulty, QuestionRevision } from "../contracts/assessment";
import { AuthoringSegmented } from "./AuthoringSegmented";

export interface QuestionMetadataBarProps {
  question: QuestionRevision;
  onChange: (question: QuestionRevision) => void;
}

const controlClass =
  "h-9 min-w-0 rounded-[10px] border border-transparent bg-white/80 px-2.5 text-[11px] font-semibold text-slate-700 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)] outline-none transition hover:bg-white focus:border-au-accent/30 focus:bg-white focus:ring-4 focus:ring-au-accent/10 disabled:opacity-45";

export function QuestionMetadataBar({ question, onChange }: QuestionMetadataBarProps) {
  const domains = question.metadata.sectionKey === "math" ? SAT_DOMAINS.math : SAT_DOMAINS["reading-writing"];
  const skills = getSatSkills(question.metadata.domain);
  const updateDomain = (domain: string | null) => {
    const nextSkills = getSatSkills(domain);
    const skill = question.metadata.skill && nextSkills.includes(question.metadata.skill)
      ? question.metadata.skill
      : null;
    onChange({ ...question, metadata: { ...question.metadata, domain, skill } });
  };

  return (
    <div className="authoring-metadata-bar mt-3 flex flex-wrap items-center gap-1.5 rounded-[10px] px-1.5 py-1.5" aria-label="Question metadata">
      <span className="hidden h-9 items-center rounded-[9px] px-2 text-[11px] font-semibold text-slate-600 sm:flex">
        {question.metadata.sectionKey === "math" ? "Math" : "Reading & Writing"}
      </span>
      <select
        aria-label="Domain"
        data-authoring-field="domain"
        value={question.metadata.domain ?? ""}
        onChange={(event) => updateDomain(event.target.value || null)}
        className={`${controlClass} max-w-[210px]`}
      >
        <option value="">Domain…</option>
        {domains.map((domain) => <option key={domain.key} value={domain.key}>{domain.label}</option>)}
      </select>
      <select
        aria-label="Skill"
        data-authoring-field="skill"
        value={question.metadata.skill ?? ""}
        onChange={(event) => onChange({ ...question, metadata: { ...question.metadata, skill: event.target.value || null } })}
        disabled={!skills.length}
        className={`${controlClass} max-w-[240px]`}
      >
        <option value="">{skills.length ? "Skill…" : "Choose domain first"}</option>
        {skills.map((skill) => <option key={skill} value={skill}>{skill}</option>)}
      </select>
      <AuthoringSegmented
        ariaLabel="Difficulty"
        layoutId="sat-difficulty"
        value={question.metadata.difficulty}
        onChange={(difficulty) => onChange({ ...question, metadata: { ...question.metadata, difficulty } })}
        options={[
          { value: "easy" as Difficulty, label: "Easy" },
          { value: "medium" as Difficulty, label: "Medium" },
          { value: "hard" as Difficulty, label: "Hard" },
        ]}
      />
      <details className="relative ml-auto">
        <summary className="authoring-interactive flex min-h-9 cursor-pointer list-none items-center rounded-[9px] px-2.5 text-[11px] font-semibold text-slate-500 marker:hidden hover:bg-black/[0.04] hover:text-slate-800">
          Tags{question.metadata.tags.length ? ` · ${question.metadata.tags.length}` : ""}
        </summary>
        <div className="au-elevation-menu absolute right-0 top-10 z-20 w-56 rounded-[12px] border border-black/[0.08] bg-white p-2">
          <input
            id={`sat-question-tags-${question.id}`}
            aria-label="Question tags"
            value={question.metadata.tags.join(", ")}
            onChange={(event) => onChange({
              ...question,
              metadata: {
                ...question.metadata,
                tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
              },
            })}
            className={`${controlClass} w-full`}
            placeholder="Add tags…"
          />
        </div>
      </details>
    </div>
  );
}
