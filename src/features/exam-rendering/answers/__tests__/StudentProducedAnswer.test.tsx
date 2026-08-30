import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StudentProducedAnswer } from "../StudentProducedAnswer";

function Harness() {
  const [value, setValue] = useState("");
  return <StudentProducedAnswer value={value} onChange={setValue} />;
}

describe("student-produced SAT answer input", () => {
  it("filters unsupported characters and enforces the SAT field length", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Student-produced response");
    fireEvent.change(input, { target: { value: "$123456%" } });
    expect(input).toHaveValue("12345");
  });

  it("preserves valid fraction syntax", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Student-produced response");
    fireEvent.change(input, { target: { value: "-2/3" } });
    expect(input).toHaveValue("-2/3");
  });
});
