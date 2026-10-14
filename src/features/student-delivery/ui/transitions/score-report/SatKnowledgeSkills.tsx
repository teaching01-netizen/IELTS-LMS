import type { SubjectReportView } from "./scoreReportViewModel";

function DomainGroup({ subject, showHeading }: { subject: SubjectReportView; showHeading: boolean }) {
  return (
    <div>
      {showHeading ? <h3 className="text-[16px] font-semibold">{subject.label}</h3> : null}
      <ul className={`space-y-4 ${showHeading ? "mt-3" : ""}`}>
        {subject.domains.map((domain) => (
          <li key={domain.name}>
            <div className="flex justify-between gap-3 text-[14px]">
              <span>{domain.name}</span>
              <span className="shrink-0 tabular-nums text-[var(--sat-text-secondary)]">
                {domain.accuracy === null
                  ? "No scored questions"
                  : `${domain.correct} of ${domain.total} · ${domain.accuracy}%`}
              </span>
            </div>
            {domain.accuracy !== null ? (
              <div
                role="meter"
                aria-label={`${domain.name} accuracy`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={domain.accuracy}
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--sat-divider)]"
              >
                <div
                  className="h-full rounded-full bg-[var(--sat-accent)]"
                  style={{ width: `${domain.accuracy}%` }}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Domain accuracy on scored questions, grouped by subject. Not an official skill band, so no labels or grades. */
export function SatKnowledgeSkills({ subjects }: { subjects: SubjectReportView[] }) {
  const groups = subjects.filter((subject) => subject.domains.length > 0);
  if (groups.length === 0) return null;
  return (
    <section
      aria-labelledby="sat-report-skills"
      className="mt-8 rounded-2xl border border-[var(--sat-divider)] p-5"
    >
      <h2 id="sat-report-skills" className="text-[18px] font-semibold">
        Knowledge and skills
      </h2>
      <p className="mt-1 text-[13px] text-[var(--sat-text-secondary)]">
        Correct answers on scored questions in each domain. Small counts are not a measure of mastery.
      </p>
      <div className="mt-4 space-y-6">
        {groups.map((subject) => (
          <DomainGroup key={subject.key} subject={subject} showHeading={subjects.length > 1} />
        ))}
      </div>
    </section>
  );
}
