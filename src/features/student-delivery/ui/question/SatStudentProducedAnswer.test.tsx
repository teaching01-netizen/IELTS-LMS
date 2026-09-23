import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SatStudentProducedAnswer } from "./SatStudentProducedAnswer";

describe("SatStudentProducedAnswer (validate-then-announce)", () => {
  it("has a single label source and format help in the describedby chain", () => {
    render(<SatStudentProducedAnswer questionId="q1" value="" disabled={false} onChange={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Enter your answer" });
    expect(input).toHaveAttribute("aria-describedby", expect.stringContaining("help"));
    expect(input).toHaveAttribute("inputmode", "text");
    expect(input).toHaveAttribute("enterkeyhint", "done");
    expect(input).toHaveAttribute("maxlength", "6");
    expect(input).toHaveClass("h-12");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText(/Fractions use a\/b/)).toBeInTheDocument();
  });

  it.each([
    ["a decimal", "12.5"],
    ["a fraction", "1/2"],
    ["a leading-minus response", "-12.3"],
  ])("accepts %s without announcing an error on blur", (_description, value) => {
    const onBlur = vi.fn();
    render(<SatStudentProducedAnswer questionId="q1" value={value} disabled={false} onChange={vi.fn()} onBlur={onBlur} />);
    const input = screen.getByRole("textbox", { name: "Enter your answer" });

    fireEvent.blur(input);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("stays silent while typing and on empty blur (unanswered is legal)", () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(<SatStudentProducedAnswer questionId="q1" value="" disabled={false} onChange={onChange} onBlur={onBlur} />);
    const input = screen.getByRole("textbox", { name: "Enter your answer" });
    fireEvent.change(input, { target: { value: "3/" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.blur(input);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("announces a plain-language error on blur for an invalid draft", () => {
    const onBlur = vi.fn();
    render(<SatStudentProducedAnswer questionId="q1" value="3/0" disabled={false} onChange={vi.fn()} onBlur={onBlur} />);
    const input = screen.getByRole("textbox", { name: "Enter your answer" });
    fireEvent.blur(input);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/denominator cannot be zero/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("clears the error on the next keystroke", () => {
    const onChange = vi.fn();
    render(<SatStudentProducedAnswer questionId="q1" value="3/0" disabled={false} onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Enter your answer" });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "3/4" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
