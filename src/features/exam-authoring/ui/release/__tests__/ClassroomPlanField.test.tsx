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
    const select = screen.getByLabelText("Classroom modules") as HTMLSelectElement;
    expect(select.value).toBe("m2_hard");
    fireEvent.change(select, { target: { value: "m1_easy" } });
    expect(mocks.mutate).toHaveBeenLastCalledWith({ "reading-writing": "m1_easy", math: "m1_easy" });
    fireEvent.change(select, { target: { value: "" } });
    expect(mocks.mutate).toHaveBeenLastCalledWith({ "reading-writing": "m1_easy" });
  });

  it("is read-only without edit rights", () => {
    render(<ClassroomPlanField examId="e1" sectionKey="math" canEdit={false} />);
    expect(screen.getByLabelText("Classroom modules")).toBeDisabled();
  });
});
