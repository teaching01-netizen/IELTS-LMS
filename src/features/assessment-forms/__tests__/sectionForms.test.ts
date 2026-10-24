import { describe, expect, it } from "vitest";
import { upgradeToSectionForms } from "../domain/forms";
import type { ExamForms } from "../contracts/forms";

describe("separate section form upgrades", () => {
  it("moves scoped questions into independent forms without changing the original", () => {
    const source: ExamForms = {
      schemaVersion: 1,
      registration: {
        fields: [
          { id: "seat", type: "text", label: "Seat", required: true, scope: "all", maxLength: 30 },
          {
            id: "class",
            type: "single_choice",
            label: "Expected Class",
            required: true,
            scope: "math",
            options: [{ id: "r1", label: "Rank 1" }],
          },
        ],
      },
      evaSim: { enabled: false, mode: "native" },
    };
    const next = upgradeToSectionForms(source);
    expect(next.schemaVersion).toBe(2);
    expect(next.registration.fields.map((f) => f.id)).toEqual(["seat"]);
    expect(next.sectionEntry.math.fields.map((f) => f.id)).toEqual(["class"]);
    expect(next.sectionEntry["reading-writing"].fields).toEqual([]);
    expect(next.sectionEntry.math.fields[0]).not.toHaveProperty("scope");
    expect(source.schemaVersion).toBe(1);
    expect(source.registration.fields).toHaveLength(2);
  });
});
