import { CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import type { AssessmentValidationReport } from "../../contracts/assessment";
import type { AssessmentReleaseState } from "../../contracts/release";
import { getHeroCopy, getHeroState, getHeroTone } from "./releaseSelectors";
import { releaseSurfaceClass } from "./releaseUi";
import { formatPublishedDate } from "./releaseSelectors";

interface ReleaseStatusHeroProps {
  releaseState: AssessmentReleaseState;
  readiness: AssessmentValidationReport | null;
  readinessValid?: boolean;
  isChecking: boolean;
  dirtyCount: number;
}

export function ReleaseStatusHero({
  releaseState,
  readiness,
  readinessValid,
  isChecking,
  dirtyCount,
}: ReleaseStatusHeroProps) {
  const publishedVersion = releaseState.currentPublishedVersion;
  const effectiveReadinessValid = readinessValid ?? Boolean(readiness?.valid);
  const state = getHeroState({
    releaseState,
    readinessValid: effectiveReadinessValid,
    hasReadiness: readiness !== null,
    isChecking,
    dirtyCount,
  });
  const { heading, description } = getHeroCopy(state, {
    releaseState,
    dirtyCount,
    readinessValid: effectiveReadinessValid,
  });
  const tone = getHeroTone(state);

  return (
    <section
      aria-label="Release status"
      aria-busy={isChecking}
      className={`${releaseSurfaceClass} flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-full ${tone === "emerald" ? "bg-green-100 text-green-800" : tone === "amber" ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"}`}
        >
          {isChecking && state !== "published" ? (
            <LoaderCircle size={19} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : state === "published" || state === "ready" ? (
            <CheckCircle2 size={20} aria-hidden="true" />
          ) : (
            <ShieldCheck size={20} aria-hidden="true" />
          )}
        </div>
        <div aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Release status
          </p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.025em] text-foreground">
            {heading}
          </h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      {publishedVersion ? (
        <div className="shrink-0 self-start text-left sm:self-center sm:text-right">
          <p className="text-xs font-semibold text-foreground">
            Version {publishedVersion.versionNumber}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Published {formatPublishedDate(publishedVersion.publishedAt)}
          </p>
        </div>
      ) : null}
    </section>
  );
}
