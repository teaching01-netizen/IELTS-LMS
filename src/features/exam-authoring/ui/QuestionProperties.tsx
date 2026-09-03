import { motion, useReducedMotion } from "motion/react";
import { SAT_DOMAINS, getSatSkills } from "../providers/sat/taxonomy";
import type { Difficulty, QuestionRevision } from "../contracts/assessment";
import { authoringMotion } from "./authoringMotion";

export interface QuestionPropertiesProps {
  question: QuestionRevision;
  onChange: (question: QuestionRevision) => void;
}

const controlClass =
  "w-full rounded-xl border border-transparent bg-au-fill px-3 py-2.5 text-xs text-slate-800 outline-none transition focus:border-au-accent/30 focus:bg-au-surface focus:ring-4 focus:ring-au-accent/10";

export function QuestionProperties({ question, onChange }: QuestionPropertiesProps) {
  const reduceMotion = useReducedMotion();
  const domains =
    question.metadata.sectionKey === "math" ? SAT_DOMAINS.math : SAT_DOMAINS["reading-writing"];
  const skills = getSatSkills(question.metadata.domain);

  const updateDomain = (domain: string | null) => {
    const nextSkills = getSatSkills(domain);
    const skill =
      question.metadata.skill && nextSkills.includes(question.metadata.skill)
        ? question.metadata.skill
        : null;
    onChange({ ...question, metadata: { ...question.metadata, domain, skill } });
  };

  return (
    <div className="space-y-4">
      <div className="block space-y-1.5 text-xs font-medium text-slate-600">
        <span>Section</span>
        <div className="rounded-xl bg-au-fill px-3 py-2.5 text-xs font-semibold text-slate-700">
          {question.metadata.sectionKey === "math" ? "Math" : "Reading & Writing"}
        </div>
      </div>

      <div
        data-authoring-field="domain"
        className="block space-y-1.5 text-xs font-medium text-slate-600"
      >
        <span id="sat-question-domain-label">Domain</span>{" "}
        <select
          id="sat-question-domain"
          aria-labelledby="sat-question-domain-label"
          value={question.metadata.domain ?? ""}
          onChange={(event) => updateDomain(event.target.value || null)}
          className={controlClass}
        >
          <option value="">Choose domain…</option>
          {domains.map((domain) => (
            <option key={domain.key} value={domain.key}>
              {domain.label}
            </option>
          ))}
        </select>
      </div>

      <div
        data-authoring-field="skill"
        className="block space-y-1.5 text-xs font-medium text-slate-600"
      >
        <span id="sat-question-skill-label">Skill</span>
        <select
          id="sat-question-skill"
          aria-labelledby="sat-question-skill-label"
          value={question.metadata.skill ?? ""}
          onChange={(event) =>
            onChange({
              ...question,
              metadata: { ...question.metadata, skill: event.target.value || null },
            })
          }
          disabled={skills.length === 0}
          className={`${controlClass} disabled:bg-au-fill disabled:text-slate-400`}
        >
          <option value="">{skills.length > 0 ? "Choose skill…" : "Choose a domain first"}</option>
          {skills.map((skill) => (
            <option key={skill} value={skill}>
              {skill}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-slate-600">Difficulty</span>
        <div
          className="authoring-segmented grid grid-cols-3 gap-1 rounded-full p-1"
          role="group"
          aria-label="Difficulty"
        >
          {(["easy", "medium", "hard"] as Difficulty[]).map((difficulty) => (
            <motion.button
              key={difficulty}
              type="button"
              whileTap={reduceMotion ? {} : authoringMotion.press}
              transition={reduceMotion ? { duration: 0.01 } : authoringMotion.fast}
              onClick={() =>
                onChange({ ...question, metadata: { ...question.metadata, difficulty } })
              }
              aria-pressed={question.metadata.difficulty === difficulty}
              className={`relative min-h-9 overflow-hidden rounded-full px-2 py-2 text-[11px] font-semibold capitalize ${question.metadata.difficulty === difficulty ? "text-slate-950" : "text-slate-500 hover:text-slate-700"}`}
            >
              {question.metadata.difficulty === difficulty ? (
                <motion.span
                  layoutId="sat-difficulty-pill"
                  className="au-elevation-card absolute inset-0 rounded-full bg-au-surface"
                  transition={reduceMotion ? { duration: 0.01 } : authoringMotion.spring}
                />
              ) : null}
              <span className="relative z-10">{difficulty}</span>
            </motion.button>
          ))}
        </div>
      </div>
      <label
        htmlFor="sat-question-tags"
        className="block space-y-1.5 text-xs font-medium text-slate-600"
      >
        <span>Tags</span>
        <input
          id="sat-question-tags"
          aria-label="Question tags"
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
          className={controlClass}
          placeholder="e.g. linear, no-calculator"
        />
        <span className="block text-[10px] font-normal leading-4 text-slate-400">
          Use commas to add searchable internal tags.
        </span>
      </label>
    </div>
  );
}
