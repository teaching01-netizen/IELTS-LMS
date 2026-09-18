import { SatAuthoringRoute } from "../../../features/exam-authoring/routes/SatAuthoringRoute";

/**
 * Browser harness for the SAT authoring lifecycle (dev + e2e only).
 *
 * WHY THIS EXISTS
 * ---------------
 * The production bug this plan exists for is a BROWSER behavior: a refresh of a
 * pre-draft exam produced a 404, React Query cached it as an error, and the
 * console showed an ApiClientError stack while the UI guessed that every 404
 * meant "No editable draft". Nothing but a real browser can prove the fixed
 * behavior — a 200 NO_DRAFT, zero POSTs, and an empty console — because the
 * console error and the network shape are the evidence.
 *
 * This route mounts the REAL authoring route against a fixed exam id so a spec
 * can sit in front of it and answer the transport itself (auth session, shell
 * read, shell open). No fixture of the workspace is involved: the component,
 * its hooks, its lifecycle mapping, and its cache effects are all the shipped
 * ones.
 *
 * Not a product route: registered only under `import.meta.env.DEV`, exactly like
 * the highlight-selection and SAT accessibility harnesses.
 */
export const DEV_AUTHORING_EXAM_ID = "dev-exam-1";

export function SatAuthoringDebugRoute() {
  return <SatAuthoringRoute examId={DEV_AUTHORING_EXAM_ID} examTitle="Digital SAT" />;
}
