import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createSatReadingPreferences } from "../../domain/satReadingPreferences";
import { SatExamShell } from "../SatExamShell";

/**
 * Bluebook shell contract — Phase 3 (TDD red first).
 * Pale-blue chrome brackets a white document; rigid shell grid;
 * 3-anchor header (context | timer | tools); footer chrome + navigator.
 */
describe("bluebook shell (Phase 3)", () => {
  const css = readFileSync(resolve(__dirname, "../../../../index.css"), "utf8");
  const shellSrc = readFileSync(resolve(__dirname, "../SatExamShell.tsx"), "utf8");
  const topbarSrc = readFileSync(resolve(__dirname, "../shell/SatExamTopBar.tsx"), "utf8");
  const footerSrc = readFileSync(resolve(__dirname, "../shell/SatExamFooter.tsx"), "utf8");
  const workspaceSrc = readFileSync(
    resolve(__dirname, "../question/SatQuestionWorkspace.tsx"),
    "utf8",
  );

  it("wires chrome regions to the shell token (body stays white)", () => {
    expect(css).toContain("--sat-shell-bg: var(--sat-chrome)");
    expect(shellSrc).toContain("var(--sat-shell-bg)");
    expect(shellSrc).toContain("var(--sat-body-bg)");
  });

  it("keeps the rigid auto/minmax/auto shell grid", () => {
    expect(shellSrc).toMatch(/grid-rows-\[auto_minmax\(0,1fr\)_auto\]/);
  });

  it("gives the topbar a white surface closed by the shared spectrum rail", () => {
    // Bluebook parity: the bar is paper, and its bottom edge is the rail — the
    // pale chrome tint stays on the shell and footer only.
    expect(topbarSrc).toContain("bg-[var(--sat-surface)]");
    expect(topbarSrc).not.toContain("bg-[var(--sat-shell-bg)]");
    expect(topbarSrc).toContain("sat-color-rail");
    expect(topbarSrc).toContain("minmax(280px,1fr)");
  });

  it("defines the spectrum rail once, under .sat-ui, with a forced-colors separator", () => {
    for (const token of [
      "--sat-rail-dark:",
      "--sat-rail-blue:",
      "--sat-rail-yellow:",
      "--sat-rail-height:",
      "--sat-rail-hairline:",
    ]) {
      expect(css).toContain(token);
    }
    // One definition plus the forced-colors fallback, both SAT-scoped, so the
    // top bar and the question header cannot drift apart.
    expect(css.match(/\.sat-ui \.sat-color-rail \{/g)).toHaveLength(2);
    expect(css).toContain("bottom: calc(-1 * var(--sat-rail-hairline))");
    expect(css).toContain("pointer-events: none");
    expect(css).toContain("background-repeat: no-repeat, repeat");
    // Decorative segments are not retained in forced colors: one system rule.
    expect(css).toMatch(
      /\.sat-ui \.sat-color-rail \{[^}]*forced-color-adjust: none;[^}]*background-color: CanvasText;[^}]*\}/
    );
  });

  it("gives the footer chrome bg + strong top border + 1fr/auto/1fr rhythm", () => {
    expect(footerSrc).toContain("var(--sat-shell-bg)");
    expect(footerSrc).toContain("var(--sat-divider-strong)");
    expect(footerSrc).toContain("minmax(0,1fr)");
  });

  it("splits reading/question with a 2px divider token", () => {
    expect(css).toContain("--sat-split-divider: #777B80");
    // Track (2px) lives in the workspace grid style; paint lives in the
    // split handle. Both must reference the token, never a literal.
    expect(workspaceSrc).toContain("2px minmax(0,");
    const handleSrc = readFileSync(
      resolve(__dirname, "../question/SatReadingSplitHandle.tsx"),
      "utf8",
    );
    expect(handleSrc).toContain("var(--sat-split-divider)");
  });

  it("renders banner + contentinfo landmarks around the question content", () => {
    render(
      <SatExamShell
        sectionLabel="Section 1, Module 1: Reading and Writing"
        directions={null}
        remainingLabel="28:33"
        candidateName="Ada Candidate"
        questionIndex={0}
        questionCount={3}
        navigationItems={[
          { id: "q1", index: 0, number: 1, status: "answered", current: true, markedForReview: false },
          { id: "q2", index: 1, number: 2, status: "unanswered", current: false, markedForReview: false },
          { id: "q3", index: 2, number: 3, status: "unanswered", current: false, markedForReview: false },
        ]}
        calculatorAvailable={false}
        calculatorOpen={false}
        referenceAvailable={false}
        referenceOpen={false}
        blocked={false}
        saveState="idle"
        questionNote=""
        readingPreferences={createSatReadingPreferences()}
        onSelectQuestion={() => undefined}
        onToggleCalculator={() => undefined}
        onToggleReference={() => undefined}
        onPrevious={() => undefined}
        onNext={() => undefined}
        onReviewModule={() => undefined}
        onSaveNote={() => undefined}
        onReadingPreferencesChange={() => undefined}
      >
        <div>Question body</div>
      </SatExamShell>,
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByTestId("sat-exam-shell")).toBeInTheDocument();
  });
});
