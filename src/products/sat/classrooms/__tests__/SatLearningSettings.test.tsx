import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SatLearningSettings, defaultSatClassroomLearningPolicy } from "../SatLearningSettings";
import type { SatActivityPolicy } from "../../../../shared/sat/learningPolicy";

function Harness({ initial }: { initial?: Partial<SatActivityPolicy> }) {
  const [value, setValue] = useState({ ...defaultSatClassroomLearningPolicy(), unlimitedRetakes: false, ...initial });
  return <SatLearningSettings value={value} onChange={setValue} />;
}

describe("SatLearningSettings", () => {
  const retakes = () => screen.getByRole("switch", { name: "Allow retakes" });
  const results = () => screen.getByRole("switch", { name: "Show results" });
  const answerKey = () => screen.getByRole("switch", { name: "Include answer key in PDF" });

  it("starts with retakes and results off", () => {
    render(<Harness />);
    expect(retakes()).not.toBeChecked();
    expect(results()).not.toBeChecked();
    expect(answerKey()).not.toBeChecked();
    expect(answerKey()).toBeDisabled();
    expect(screen.queryByRole("switch", { name: /study/i })).not.toBeInTheDocument();
  });

  it("turns results on when enabling retakes and lets staff hide them afterward", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(retakes());
    expect(retakes()).toBeChecked();
    expect(results()).toBeChecked();
    expect(answerKey()).toBeEnabled();
    expect(answerKey()).not.toBeChecked();

    await user.click(answerKey());
    await user.click(results());
    expect(retakes()).toBeChecked();
    expect(results()).not.toBeChecked();
    expect(answerKey()).not.toBeChecked();
    expect(answerKey()).toBeDisabled();

    await user.click(screen.getByRole("switch", { name: "Allow students to pause and leave" }));
    expect(results()).not.toBeChecked();
  });

  it("allows a keyed PDF after the first submission with retakes off", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(results());
    await user.click(answerKey());
    expect(answerKey()).toBeChecked();
    expect(answerKey()).toHaveAccessibleDescription(
      "Adds the correct answers to the student’s PDF after their first completed attempt.",
    );
    expect(retakes()).not.toBeChecked();
  });

  it("groups the controls and explains why the answer key is unavailable", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "Student results" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Retakes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Timer" })).toBeInTheDocument();
    expect(screen.getByText("Requires Show results")).toBeInTheDocument();
    expect(screen.getByText("Turning this on also turns on Show results.")).toBeInTheDocument();
    expect(answerKey()).toHaveAccessibleDescription(
      "Turn on Show results to make the answer key available.",
    );
  });

  it("explains the exam-wide scope for exam defaults", () => {
    render(
      <SatLearningSettings
        examDefaults
        value={defaultSatClassroomLearningPolicy()}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText("Applies to this exam and its rooms")).toBeInTheDocument();
    expect(screen.getByText(/Closed rooms keep their own settings/)).toBeInTheDocument();
  });

  it("leaves results and PDF keys on when staff turn retakes off", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ unlimitedRetakes: true, reportVisible: true, includeAnswerKeyInPdf: true }} />);
    await user.click(retakes());
    expect(retakes()).not.toBeChecked();
    expect(results()).toBeChecked();
    expect(answerKey()).toBeChecked();
  });
});
