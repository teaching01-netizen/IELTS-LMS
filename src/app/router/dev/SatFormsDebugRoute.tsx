import { SatSectionEntryScreen } from "../../../features/student-delivery/ui/SatSectionEntryScreen";
import { useSatSectionEntry } from "../../../features/student-delivery/hooks/useSatSectionEntry";
import { assessmentDeliveryApi } from "../../../features/student-delivery/api/assessmentDeliveryApi";
import { useSearchParams } from "react-router-dom";
import { FormsSettingsPanel } from "../../../features/exam-authoring/ui/settings/FormsSettingsPanel";
import { SatCompleteScreen } from "../../../features/student-delivery/ui/transitions/SatCompleteScreen";
import { SatEvaCompletionGate } from "../../../features/student-delivery/ui/transitions/SatEvaCompletion";

/**
 * Dev-only harness for the SAT forms + Eva SIM surfaces (browser checks in
 * e2e/sat-forms-eva-sim.spec.ts). Data comes from the real API paths, which
 * the browser test intercepts; nothing here is reachable in production.
 */
export function SatFormsDebugRoute() {
  const [params] = useSearchParams();
  if (params.get("surface") === "section") return <SectionEntryDebug />;
  if (params.get("surface") === "settings") {
    return (
      <div className="sat-product min-h-screen bg-[var(--sat-staff-canvas,#f7f7f8)]">
        <main className="mx-auto w-full max-w-[920px] px-4 pb-20 pt-8 sm:px-6">
          <h1 className="sr-only">Exam settings</h1>
          <FormsSettingsPanel examId="debug-exam" canEdit />
        </main>
      </div>
    );
  }
  return (
    <SatEvaCompletionGate
      scheduleId="debug-schedule"
      attemptId="debug-attempt"
      recoveryException={false}
      renderComplete={(eva) => <SatCompleteScreen result={null} onExit={() => undefined} eva={eva} />}
    />
  );
}

function SectionEntryDebug() {
  const gate = useSatSectionEntry("debug-schedule", "debug-attempt", "debug-math", "math", assessmentDeliveryApi.sectionEntry);
  if (gate.ready) return <main className="sat-ui p-8"><h1>Section details accepted</h1><p>The delivery controller can now request normal entry.</p></main>;
  return <SatSectionEntryScreen sectionKey="math" scheduleId="debug-schedule" attemptId="debug-attempt" state={gate.state} loading={gate.loading} error={gate.error} onRefresh={gate.refresh} />;
}
