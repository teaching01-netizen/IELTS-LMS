import { describe, expect, it } from "vitest";
import {
  SAT_COPY,
  satBackToQuestionLabel,
  satContinueToDirectionsLabel,
  satLastQuestionLabel,
  satSelectedTextLabel,
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

  it("splits the two note concepts with unambiguous names", () => {
    expect(SAT_COPY.questionNote.title).toBe("Question note");
    expect(SAT_COPY.noteOnSelection.title).toBe("Note on selected text");
    expect(SAT_COPY.questionNote.title).not.toBe(SAT_COPY.noteOnSelection.title);
    expect(SAT_COPY.questionNote.unavailableInMath).toContain("Math");
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
    expect(satSelectedTextLabel("Trees change heat.")).toBe("Selected text: Trees change heat.");
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
