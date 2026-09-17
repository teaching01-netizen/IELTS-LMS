import { describe, expect, it } from "vitest";
import {
  SAT_COPY,
  satBackToQuestionLabel,
  satContinueToDirectionsLabel,
  satLastQuestionLabel,
  satQuotedSource,
  satSubmitConfirmSummary,
  satSubmitConfirmTitle,
  satTimerRevealedAnnouncement,
  satWaitingForSavesLabel,
} from "../satCopy";

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectStrings(entry, out);
  }
}

describe("satCopy controlled vocabulary", () => {
  it("keeps every table string non-empty and unique within its section", () => {
    for (const [section, table] of Object.entries(SAT_COPY)) {
      const strings: string[] = [];
      collectStrings(table, strings);
      expect(strings.length).toBeGreaterThan(0);
      for (const text of strings) expect(text.trim().length).toBeGreaterThan(0);
      expect(new Set(strings).size).toBe(strings.length);
    }
  });

  it("reserves Reading for content: the display tool is named Display", () => {
    expect(SAT_COPY.displaySettings.title).toBe("Display");
    expect(SAT_COPY.displaySettings.subtitle).toContain("answers are not affected");
    expect(SAT_COPY.displaySettings.close).toBe("Close display settings");
    expect(SAT_COPY.displaySettings.reset).toBe("Reset display settings");
  });

  it("keeps ONE note concept, with no Save button to contradict autosave", () => {
    expect(SAT_COPY.notes.title).toBe("Notes");
    expect(SAT_COPY.notes.unavailableInMath).toContain("Math");
    // The old split into "Question note" and "Note on selected text" is gone:
    // two names for one student activity only ever raised the question of which
    // one to use.
    const table = SAT_COPY as unknown as Record<string, unknown>;
    expect(table.questionNote).toBeUndefined();
    expect(table.noteOnSelection).toBeUndefined();
    // "Notes save automatically" beside a "Save and close" button was the
    // contradiction; the column autosaves and offers no such button at all.
    expect(Object.values(SAT_COPY.notes).join(" ")).not.toMatch(/\bSave\b/);
    // The promise is still made — once, in the field, and then retired.
    expect(SAT_COPY.notes.saveHelper).toBe("Notes save automatically.");
    // The empty state names the column, then the gesture that fills it, instead
    // of a call to action standing in for both.
    expect(SAT_COPY.notes.emptyTitle).toBe("No notes yet");
    expect(SAT_COPY.notes.empty).toContain("Add note");
    // Demoted, not renamed: one action under the list, in the vocabulary the
    // toolbar already taught ("Add note").
    expect(SAT_COPY.notes.addQuestionNote).toBe("Add question note");
    expect((SAT_COPY.notes as unknown as Record<string, unknown>).writeAboutQuestion).toBeUndefined();
  });

  it("splits flag state from the review destination", () => {
    expect(SAT_COPY.flag.flag).toBe("Flag for later");
    // Wave C R-15: canonical review-destination name; alias removed
    // (consumers migrated to the canonical key — grep found none outside
    // the copy table + this contract).
    expect(SAT_COPY.navigation.reviewAnswers).toBe("Review answers");
    expect(
      (SAT_COPY.navigation as Record<string, unknown>).reviewAnswersAlias,
    ).toBeUndefined();
    expect(SAT_COPY.flag.flag).not.toContain("Review");
  });

  it("interpolates dynamic labels without empty segments", () => {
    expect(satQuotedSource("Trees change heat.")).toBe("\u201CTrees change heat.\u201D");
    expect(satBackToQuestionLabel(7)).toBe("Back to question 7");
    expect(satSubmitConfirmTitle("Module 2")).toBe("Submit Module 2 answers?");
    expect(satSubmitConfirmSummary(3, 2)).toBe("3 unanswered \u00B7 2 flagged");
    expect(satWaitingForSavesLabel(1)).toBe("Waiting for 1 answer to save\u2026");
    expect(satWaitingForSavesLabel(4)).toBe("Waiting for 4 answers to save\u2026");
    expect(satLastQuestionLabel(27, 27)).toBe("Question 27 of 27, last question");
    expect(satContinueToDirectionsLabel("Math")).toBe("Continue to Math directions");
    expect(satTimerRevealedAnnouncement()).toContain("5 minutes left");
  });
});
