export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-[14px] font-semibold uppercase leading-5 tracking-[0.12em] text-[var(--sat-staff-text-tertiary,#6e6e73)]">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-[20px] font-semibold leading-7 tracking-[-0.015em] text-[var(--sat-staff-text-primary,#1d1d1f)]">{title}</h2>
      <p className="mt-1 max-w-2xl text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">{description}</p>
    </div>
  );
}

export function ReleaseLoadingSurface() {
  return (
    <div className="sat-product min-h-screen bg-background text-foreground" aria-busy="true" aria-label="Loading delivery and release">
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex min-h-[68px] max-w-[1240px] items-center px-4 sm:px-6 lg:px-8">
          <div className="h-4 w-48 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
        </div>
      </div>
      <main className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="h-32 animate-pulse rounded-2xl bg-card motion-reduce:animate-none" />
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <div className="h-[420px] animate-pulse rounded-2xl bg-card motion-reduce:animate-none" />
            <div className="h-72 animate-pulse rounded-2xl bg-card motion-reduce:animate-none" />
          </div>
          <div className="h-96 animate-pulse rounded-2xl bg-card motion-reduce:animate-none" />
        </div>
      </main>
    </div>
  );
}
