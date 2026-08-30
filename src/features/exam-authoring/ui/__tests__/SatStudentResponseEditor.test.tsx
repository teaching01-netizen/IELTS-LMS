import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SatStudentResponseEditor } from "../SatStudentResponseEditor";

function Harness() {
  const [responses, setResponses] = useState<string[]>([]);
  return <SatStudentResponseEditor acceptedResponses={responses} onChange={setResponses} />;
}

describe("SAT student response authoring", () => {
  it("shows invalid staff input instead of silently rewriting the answer key", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Primary answer"), { target: { value: "$12" } });
    expect(screen.getByLabelText("Primary answer")).toHaveValue("$12");
    expect(screen.getByText(/Use only digits/)).toBeVisible();
  });

  it("adds and removes validated equivalent responses", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Primary answer"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Add accepted equivalent"), {
      target: { value: "24/2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("24/2")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remove accepted response 24/2" }));
    expect(screen.queryByText("24/2")).not.toBeInTheDocument();
  });
});
