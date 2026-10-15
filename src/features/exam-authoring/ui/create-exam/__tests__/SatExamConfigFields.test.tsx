import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { SatConfigLimits, SatExamConfig, SatSectionConfig } from "../../../contracts/satExamConfig";
import { SatExamConfigFields } from "../SatExamConfigFields";

const section: SatSectionConfig = {
  module1Minutes: 32,
  module2LowerMinutes: 32,
  module2HigherMinutes: 32,
  breakAfterMinutes: 10,
  minimumCorrectForHigher: 15,
};
const defaults: SatExamConfig = {
  sections: { "reading-writing": section, math: section },
  showClassroomScoreReport: false,
};
const limits: SatConfigLimits = {
  minModuleMinutes: 1,
  maxModuleMinutes: 120,
  maxBreakMinutes: 30,
  operationalQuestions: { "reading-writing": 27, math: 22 },
};

function Harness() {
  const [value, setValue] = useState(defaults);
  return (
    <SatExamConfigFields
      value={value}
      defaults={defaults}
      limits={limits}
      errors={{}}
      idPrefix="t"
      customModules
      onChange={setValue}
    />
  );
}

describe("SatExamConfigFields", () => {
  it("returns to Full adaptive after the only custom section is reset", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Reading & Writing: Hard Module 2 only" }));
    expect(screen.getByRole("radio", { name: "Reading & Writing: Hard Module 2 only" })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Reading & Writing: Full adaptive" }));
    expect(screen.getByRole("radio", { name: "Reading & Writing: Full adaptive" })).toBeChecked();
    expect(screen.getAllByText("Harder Module 2 at")).toHaveLength(2);
  });

  it("keeps the Module 1 threshold for fixed Module 2 shapes that start with Module 1", () => {
    render(<Harness />);
    fireEvent.change(screen.getAllByRole("spinbutton", { name: "Harder Module 2 at" })[0], { target: { value: "12" } });

    fireEvent.click(screen.getByRole("radio", { name: "Reading & Writing: Module 1, then Hard Module 2" }));
    expect(screen.getByRole("spinbutton", { name: "Converted score at" })).toHaveValue(12);

    fireEvent.click(screen.getByRole("radio", { name: "Reading & Writing: Module 1, then Easy Module 2" }));
    expect(screen.getByRole("spinbutton", { name: "Converted score below" })).toHaveValue(12);

    fireEvent.click(screen.getByRole("radio", { name: "Reading & Writing: Hard Module 2 only" }));
    expect(screen.queryByRole("spinbutton", { name: /Converted score/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("spinbutton", { name: "Harder Module 2 at" })).toHaveLength(1);
  });
});
