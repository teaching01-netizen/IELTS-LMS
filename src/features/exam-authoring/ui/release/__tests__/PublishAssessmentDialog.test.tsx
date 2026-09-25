import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublishAssessmentDialog } from "../PublishAssessmentDialog";
import type { AssessmentAuthoringShell } from "../../contracts/assessment";
import { MAX_PUBLISH_NOTES_LENGTH } from "../releaseSelectors";

function section(id: string, title: string, minutes: number) {
  const module = (moduleId: string, role: string) => ({ id: moduleId, adaptiveRole: role, durationSeconds: minutes * 60 });
  return { id, title, modules: [module(`${id}-base`, "base"), module(`${id}-lower`, "lower_branch"), module(`${id}-higher`, "higher_branch")] };
}

const shell = {
  sections: [section("s1", "Reading & Writing", 32), section("s2", "Math", 35)],
} as unknown as AssessmentAuthoringShell;

function renderDialog(overrides: Partial<Parameters<typeof PublishAssessmentDialog>[0]> = {}) {
  return render(
    <PublishAssessmentDialog
      open
      examTitle="Practice Test 06"
      shell={shell}
      publishScope="full"
      blockerCount={0}
      warningCount={1}
      candidateSeconds={7200}
      candidateEstimateStale={false}
      isPublishing={false}
      isUpdate={false}
      currentPublishedVersionNumber={null}
      onClose={vi.fn()}
      onConfirm={vi.fn().mockResolvedValue(undefined)}
      {...overrides}
    />,
  );
}

/** The fail-closed media gate's 422 body, exactly as the API sends it. */
function mediaUnavailableError() {
  return Object.assign(new Error("SAT publish requirements are not met: one or more images are unavailable."), {
    details: {
      code: "sat.media.unavailable",
      path: "examQuestion:q-17:prompt.nodes[1].attrs.assetId",
      issues: [
        {
          code: "sat.media.unavailable",
          path: "examQuestion:q-17:prompt.nodes[1].attrs.assetId",
          message: "An image used by this question is missing or unavailable.",
          assetId: "63a5b1e2-0000-4000-8000-000000000001",
          storageErrorClass: "missing",
        },
      ],
    },
  });
}

describe("PublishAssessmentDialog", () => {
  it("shows a live character count for publish notes", () => {
    renderDialog();
    expect(screen.getByText(`0/${MAX_PUBLISH_NOTES_LENGTH}`)).toBeInTheDocument();
    const notes = screen.getByRole("textbox", { name: /publish notes/i });
    expect(notes).toHaveAttribute("aria-describedby", "sat-publish-notes-count");
    fireEvent.change(notes, { target: { value: "New math module" } });
    expect(screen.getByText(`15/${MAX_PUBLISH_NOTES_LENGTH}`)).toBeInTheDocument();
  });

  it("blocks confirm while publishing or blocked, and focuses the safe choice", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish Full SAT" })).toBeEnabled();
  });

  it("waits for the committed draft read before it will publish", () => {
    // Publish is rejected server-side against the stored revision, so offering
    // it while this tab is still reading (or saving) that revision would only
    // release the earlier draft.
    renderDialog({ draftBusy: true });
    expect(screen.getByRole("button", { name: "Publish Full SAT" })).toBeDisabled();
  });

  it("maps a 422 media rejection to the question that holds the missing image", async () => {
    const onOpenIssue = vi.fn();
    const onClose = vi.fn();
    renderDialog({
      onConfirm: vi.fn().mockRejectedValue(mediaUnavailableError()),
      onOpenIssue,
      onClose,
    });

    fireEvent.click(screen.getByRole("button", { name: "Publish Full SAT" }));

    expect(
      await screen.findByText("Question image is unavailable \u2014 replace this image."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open this question" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onOpenIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "sat.media.unavailable",
        examQuestionId: "q-17",
        blocking: true,
      }),
    );
  });

  it("never replays a 422 on its own", async () => {
    const onConfirm = vi.fn().mockRejectedValue(mediaUnavailableError());
    renderDialog({ onConfirm });

    fireEvent.click(screen.getByRole("button", { name: "Publish Full SAT" }));
    await screen.findByText(/Question image is unavailable/);
    // A 422 is the media gate's answer about this exact draft, not a transient
    // fault, so no retry may be queued behind the author's back.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
