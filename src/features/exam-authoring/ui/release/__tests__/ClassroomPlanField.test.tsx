import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClassroomPlanField } from "../ClassroomPlanField";

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), plan: { math: "m2_hard", "reading-writing": "m1_easy" } as Record<string, string> }));
vi.mock("../../../api/assessmentQueries", () => ({
  useClassroomPlan: () => ({ data: { plan: mocks.plan }, isSuccess: true }),
  useSetClassroomPlan: () => ({ mutate: mocks.mutate, isPending: false, isError: false }),
}));

describe("ClassroomPlanField", () => {
  it("shows the section's shape and replaces only that section on change", () => {
    render(<ClassroomPlanField examId="e1" sectionKey="math" canEdit />);
    const hardOnly = screen.getByRole("radio", { name: "math: Hard Module 2 only" });
    expect(hardOnly).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "math: Module 1, then Easy Module 2" }));
    expect(mocks.mutate).toHaveBeenLastCalledWith({ "reading-writing": "m1_easy", math: "m1_easy" });
    fireEvent.click(screen.getByRole("radio", { name: "math: Full adaptive" }));
    expect(mocks.mutate).toHaveBeenLastCalledWith({ "reading-writing": "m1_easy" });
  });

  it("is read-only without edit rights", () => {
    render(<ClassroomPlanField examId="e1" sectionKey="math" canEdit={false} />);
    expect(screen.getByRole("radio", { name: "math: Full adaptive" })).toBeDisabled();
  });
});
