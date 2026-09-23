import { studentModuleTitle } from "../../application/satRuntimeSelectors";
import type { AssessmentDeliveryModule } from "../../contracts/assessmentDelivery";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";

export function SatEntryRecoveryScreen({
  module,
  isRetrying,
  onRetry,
}: {
  module: AssessmentDeliveryModule | null;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const moduleTitle = module ? studentModuleTitle(module) : "next module";
  return (
    <SatPresenceSurface className="sat-ui grid min-h-[100dvh] place-items-center bg-[var(--sat-background)] px-6 py-8 text-center text-[var(--sat-text)]">
      <main className="w-full max-w-lg py-10" role="alert">
        <p className="sat-type-control-secondary font-semibold text-[var(--sat-text-secondary)]">Digital SAT</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          {isRetrying ? `Opening ${moduleTitle}…` : `We’re having trouble opening ${moduleTitle}.`}
        </h1>
        <p className="mt-3 sat-type-control-primary leading-6 text-[var(--sat-text-secondary)]">
          {isRetrying
            ? "This may take a moment. Your saved answers are safe."
            : "Your saved answers are safe. We’ll keep trying automatically."}
        </p>
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="sat-touch-target sat-pressable mt-7 rounded-full bg-[var(--sat-accent)] px-6 sat-type-control-secondary font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2"
        >
          {isRetrying ? "Opening…" : "Retry now"}
        </button>
      </main>
    </SatPresenceSurface>
  );
}
