import { SAT_DOMAINS, getSatSkills } from "../providers/sat/taxonomy";
import type { Difficulty, QuestionRevision } from "../contracts/assessment";

export interface QuestionMetadataBarProps {
  question: QuestionRevision;
  onChange: (question: QuestionRevision) => void;
}

const controlClass =
  "h-10 min-w-0 rounded-[9px] border border-transparent bg-white/78 px-2.5 text-[11px] font-semibold text-slate-700 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.045)] outline-none transition hover:bg-white focus:border-[#0071e3]/30 focus:bg-white focus:ring-4 focus:ring-[#0071e3]/10";

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
    <div className="authoring-metadata-bar mt-4 flex flex-wrap items-center gap-2 rounded-[13px] px-2.5 py-2.5" aria-label="Question metadata">
      <span className="flex h-10 items-center rounded-[9px] px-2.5 text-[11px] font-semibold text-slate-600">
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
        className={`${controlClass} max-w-[240px] disabled:opacity-45`}
      >
        <option value="">{skills.length ? "Skill…" : "Choose domain first"}</option>
        {skills.map((skill) => <option key={skill} value={skill}>{skill}</option>)}
      </select>
      <div className="authoring-segmented flex h-10 items-center rounded-[9px] p-0.5" aria-label="Difficulty">
        {(["easy", "medium", "hard"] as Difficulty[]).map((difficulty) => (
          <button
            key={difficulty}
            type="button"
            aria-pressed={question.metadata.difficulty === difficulty}
            onClick={() => onChange({ ...question, metadata: { ...question.metadata, difficulty } })}
            className={`h-9 rounded-[8px] px-2.5 text-[10px] font-semibold capitalize transition ${question.metadata.difficulty === difficulty ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            {difficulty}
          </button>
        ))}
      </div>
      <input
        aria-label="Question tags"
        value={question.metadata.tags.join(", ")}
        onChange={(event) => onChange({
          ...question,
          metadata: {
            ...question.metadata,
            tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean),
          },
        })}
        className={`${controlClass} min-w-[150px] flex-1`}
        placeholder="Tags…"
      />
    </div>
  );
}
