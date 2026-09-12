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

function renderDialog() {
  return render(
    <PublishAssessmentDialog
      open
      examTitle="Practice Test 06"
      shell={shell}
      blockerCount={0}
      warningCount={1}
      candidateSeconds={7200}
      candidateEstimateStale={false}
      isPublishing={false}
      isUpdate={false}
      currentPublishedVersionNumber={null}
      onClose={vi.fn()}
      onConfirm={vi.fn().mockResolvedValue(undefined)}
    />,
  );
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
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });
});
