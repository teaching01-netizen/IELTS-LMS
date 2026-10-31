import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SatStudentProducedAnswer } from "./SatStudentProducedAnswer";

describe("SatStudentProducedAnswer (validate-then-announce)", () => {
  it.each(["1 1/2", "1e3", "1/2.3", "123456", "$12", "12%", "1/0"])(
    "preserves invalid input %s through blur and permits correction",
    (value) => {
      const saved = vi.fn();
      function Harness() {
        const [draft, setDraft] = useState("");
        return (
          <SatStudentProducedAnswer
            questionId="q1"
            value={draft}
            disabled={false}
            onChange={setDraft}
            onBlur={() => saved(draft)}
          />
        );
      }
      render(<Harness />);
      const input = screen.getByRole("textbox", { name: "Enter your answer" });
      fireEvent.change(input, { target: { value } });
      expect(input).toHaveValue(value);
      fireEvent.blur(input);
      expect(saved).toHaveBeenLastCalledWith(value);
      expect(input).toHaveValue(value);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toBeVisible();
      fireEvent.change(input, { target: { value: "1/2" } });
      fireEvent.blur(input);
      expect(saved).toHaveBeenLastCalledWith("1/2");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    }
  );
  it("has a single label source and format help in the describedby chain", () => {
    render(
      <SatStudentProducedAnswer questionId="q1" value="" disabled={false} onChange={vi.fn()} />
    );
    const input = screen.getByRole("textbox", { name: "Enter your answer" });
    expect(input).toHaveAttribute("data-testid", "sat-answer-control");
    expect(input).toHaveAttribute("aria-describedby", expect.stringContaining("help"));
    expect(input).toHaveAttribute("inputmode", "text");
    expect(input).toHaveAttribute("enterkeyhint", "done");
    expect(input).toHaveAttribute("maxlength", "64");
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
    render(
      <SatStudentProducedAnswer
        questionId="q1"
        value={value}
        disabled={false}
        onChange={vi.fn()}
        onBlur={onBlur}
      />
    );
    const input = screen.getByRole("textbox", { name: "Enter your answer" });

    fireEvent.blur(input);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("stays silent while typing and on empty blur (unanswered is legal)", () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    render(
      <SatStudentProducedAnswer
        questionId="q1"
        value=""
        disabled={false}
        onChange={onChange}
        onBlur={onBlur}
      />
    );
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
    render(
      <SatStudentProducedAnswer
        questionId="q1"
        value="3/0"
        disabled={false}
        onChange={vi.fn()}
        onBlur={onBlur}
      />
    );
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
    render(
      <SatStudentProducedAnswer questionId="q1" value="3/0" disabled={false} onChange={onChange} />
    );
    const input = screen.getByRole("textbox", { name: "Enter your answer" });
    fireEvent.blur(input);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "3/4" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("normalizes pasted lookalike glyphs before reporting the answer", () => {
    const onChange = vi.fn();
    function Harness() {
      const [draft, setDraft] = useState("");
      return (
        <SatStudentProducedAnswer
          questionId="q1"
          value={draft}
          disabled={false}
          onChange={(next) => {
            onChange(next);
            setDraft(next);
          }}
        />
      );
    }
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Enter your answer" });

    fireEvent.change(input, { target: { value: "\u221212.5" } });
    expect(onChange).toHaveBeenLastCalledWith("-12.5");
    expect(input).toHaveValue("-12.5");

    fireEvent.change(input, { target: { value: "\uFF11\uFF12\uFF0E\uFF15" } });
    expect(onChange).toHaveBeenLastCalledWith("12.5");
    expect(input).toHaveValue("12.5");
  });

  it("bounds a huge paste without silently turning an over-budget entry into a valid answer", () => {
    const onChange = vi.fn();
    function Harness() {
      const [draft, setDraft] = useState("");
      return (
        <SatStudentProducedAnswer
          questionId="q1"
          value={draft}
          disabled={false}
          onChange={(next) => {
            onChange(next);
            setDraft(next);
          }}
        />
      );
    }
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Enter your answer" });

    fireEvent.change(input, { target: { value: "-123456" } });
    expect(onChange).toHaveBeenLastCalledWith("-123456");
    expect(input).toHaveValue("-123456");

    fireEvent.change(input, { target: { value: "1".repeat(100) } });
    expect(onChange).toHaveBeenLastCalledWith("1".repeat(64));
    expect(input).toHaveValue("1".repeat(64));
  });

  it("does not carry a validation error onto the next SPR question", () => {
    const props = { disabled: false, onChange: vi.fn() };
    const { rerender } = render(
      <SatStudentProducedAnswer questionId="q1" value="12%" {...props} />
    );
    fireEvent.blur(screen.getByRole("textbox", { name: "Enter your answer" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/only digits/i);

    rerender(<SatStudentProducedAnswer questionId="q2" value="3/4" {...props} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Enter your answer" })).not.toHaveAttribute(
      "aria-invalid"
    );
  });
});
