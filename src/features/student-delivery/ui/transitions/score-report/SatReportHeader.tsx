export function SatReportHeader({ title }: { title: string }) {
  return (
    <header>
      <p className="text-[14px] font-semibold text-[var(--sat-text-secondary)]">Digital SAT</p>
      <h1 className="mt-2 text-[28px] font-semibold tracking-tight sm:text-[32px]">{title}</h1>
      <p className="mt-2 text-[14px] text-[var(--sat-text-secondary)]">
        Exam completed · Answers submitted
      </p>
    </header>
  );
}
