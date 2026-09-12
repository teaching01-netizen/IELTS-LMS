import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReleaseGateCard } from "../../spine/ReleaseGateCard";
import { getPublishBlockers } from "../releaseSelectors";

describe("ReleaseReadinessParity — gate card never drifts from selectors", () => {
  it("release_readiness_matches_authoring_blockers", () => {
    const reasons = getPublishBlockers({
      lifecycleState: "never_published",
      readinessFresh: false,
      readinessValid: false,
      blockerCount: 3,
      dirtyCount: 2,
      isPublishing: false,
      canEdit: true,
      canPublishExam: true,
    });
    render(
      <ReleaseGateCard
        readinessFresh={false}
        readinessValid={false}
        dirtyCount={2}
        isPublishing={false}
        blockerCount={3}
        releaseHref="/sat/exams/e/release"
        onOpenRelease={vi.fn()}
      />,
    );
    const list = screen.getByRole("list");
    for (const reason of reasons) expect(list).toHaveTextContent(reason.slice(0, 24));
  });
});
