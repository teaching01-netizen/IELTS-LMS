import type { ReactNode } from "react";
import { WarwickInstituteLogo } from "../../ui/WarwickInstituteLogo";

/* The pre-exam shell: one identifier bar and nothing else.
 *
 * A candidate at check-in needs to know whose exam this is and where to type.
 * The page supplies only the first; every call to action lives in the content
 * below, so there is no navigation, no footer, and no second accent to read. */

const GUTTER =
  "pl-[calc(1.25rem+var(--student-safe-left))] pr-[calc(1.25rem+var(--student-safe-right))] sm:pl-[calc(1.5rem+var(--student-safe-left))] sm:pr-[calc(1.5rem+var(--student-safe-right))]";

export interface PreExamPageProps {
  children: ReactNode;
  /** Provider badge beside the institute mark. IELTS unless an ACT exam. */
  examBadge?: string | undefined;
}

export function PreExamPage({ children, examBadge = "IELTS" }: PreExamPageProps) {
  return (
    <div className="exam-entry flex min-h-[100dvh] w-full flex-col">
      <header className="border-b border-[var(--exam-hairline)] bg-[var(--exam-surface)] pt-[var(--student-safe-top)]">
        <div className={`mx-auto flex h-14 w-full max-w-[440px] items-center gap-3 ${GUTTER}`}>
          <WarwickInstituteLogo className="h-6 w-auto shrink-0" />
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-[var(--exam-hairline)]" />
          <span className="shrink-0 text-[15px] font-bold leading-none tracking-[0.08em] text-[var(--exam-accent)]">
            {examBadge}
          </span>
        </div>
      </header>
      <div className="flex w-full flex-1 flex-col">{children}</div>
    </div>
  );
}
