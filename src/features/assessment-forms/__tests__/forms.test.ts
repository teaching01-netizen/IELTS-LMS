import { describe, expect, it } from "vitest";
import type { FormField } from "../contracts/forms";
import { applicableFields, buildAnswers, checkEmbedUrl, parsePublicRegistrationForm, retainCompatibleAnswers } from "../domain/forms";
import { satCheckInStep } from "@/src/features/student-delivery/api/satEntryPortal";

const year: FormField = { id: "year", type: "number", label: "Year", required: true, scope: "all", integer: true, min: 1000, max: 9999 };
const seat: FormField = { id: "seat", type: "text", label: "Seat", required: false, scope: "all", maxLength: 5 };
const klass: FormField = { id: "class", type: "single_choice", label: "Class", required: true, scope: "math", options: [{ id: "r1", label: "Rank 1" }] };

describe("assessment form rules (client mirror of the Go definition)", () => {
  it("filters by sitting scope", () => {
    expect(applicableFields([year, klass], ["reading-writing"]).map((f) => f.id)).toEqual(["year"]);
    expect(applicableFields([year, klass], null).map((f) => f.id)).toEqual(["year", "class"]);
  });

  it("types answers and rejects calendar or length conversions", () => {
    expect(buildAnswers([year, seat, klass], { year: "2027", seat: " A-007 ", class: "r1" })).toEqual({
      answers: { year: 2027, seat: "A-007", class: "r1" },
      errors: {},
    });
    const { errors } = buildAnswers([year, seat, klass], { year: "2570.5", seat: "A-0077", class: "r9" });
    expect(errors).toEqual({
      year: "Enter a whole number.",
      seat: "Use at most 5 characters.",
      class: "Select one of the listed options.",
    });
    expect(buildAnswers([year], { year: "๒๕๗๐" }).errors.year).toBe("Enter a number.");
    expect(buildAnswers([seat], {}).answers).toEqual({});
  });

  it("keeps only answers whose question still exists with the same type and option", () => {
    const changedYear: FormField = { ...seat, id: "year" };
    expect(retainCompatibleAnswers([year, seat, klass], [changedYear, seat, { ...klass, options: [{ id: "r2", label: "Rank 2" }] }], { year: "2027", seat: "A1", class: "r1" })).toEqual({ seat: "A1" });
  });

  it("checks embed URLs like the server, for feedback only", () => {
    expect(checkEmbedUrl("https://forms.example.org/a", "app.example.com")).toEqual({ ok: true, host: "forms.example.org" });
    for (const bad of ["http://forms.example.org", "https://user:pw@forms.example.org", "https://forms.example.org:8443/a", "https://10.0.0.5/a", "https://intranet/a", "https://app.example.com/x", "<iframe src=x>"]) {
      expect(checkEmbedUrl(bad, "app.example.com").ok, bad).toBe(false);
    }
  });

  it("parses the public registration projection defensively", () => {
    expect(parsePublicRegistrationForm(null)).toBeNull();
    expect(parsePublicRegistrationForm({ versionId: "v", fields: [] })).toBeNull();
    expect(parsePublicRegistrationForm({ versionId: "v", schemaVersion: 1, fields: [year] })?.fields).toHaveLength(1);
  });

  it("words the check-in step for the access mode", () => {
    expect(satCheckInStep({ code: false, examDetails: true })).toBe("Enter your name, email, and exam details.");
    expect(satCheckInStep({ code: true, examDetails: false })).toBe("Enter your Student ID/WCODE, name, and email.");
  });
});
