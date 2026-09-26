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

  it("gives the topbar a paper surface closed by the shared spectrum rail", () => {
    // Bluebook parity: the MAIN exam header is paper white, and its bottom edge
    // is the rail — the pale chrome tint stays on the shell and footer only.
    expect(topbarSrc).toContain("bg-[var(--sat-surface)]");
    expect(topbarSrc).not.toContain("bg-[var(--sat-shell-bg)]");
    expect(topbarSrc).toContain("sat-color-rail");
    expect(topbarSrc).toContain("minmax(280px,1fr)");
    // The reserved bottom border is transparent: the rail owns the visible edge,
    // so no divider colour adds pixels underneath it.
    expect(topbarSrc).toContain("border-b border-transparent");
    expect(topbarSrc).not.toContain("var(--sat-divider-strong)");
  });

  it("dresses the question strip in the reference gray, not the header's paper", () => {
    const headerSrc = readFileSync(resolve(__dirname, "../question/SatQuestionHeader.tsx"), "utf8");
    // The strip's own host class, exactly: gray surface, reserved transparent
    // border, dedicated height, controls centred. (The ABC glyph inside is free
    // to paint its own paper surface — it is a control, not the strip.)
    expect(headerSrc).toContain(
      "relative flex min-h-[var(--sat-question-header-height)] items-center " +
        "border-b border-transparent bg-[var(--sat-question-header-bg)]"
    );
    expect(headerSrc).not.toContain("bg-[var(--sat-surface-subtle)]");
    expect(css).toContain("--sat-question-header-bg: #F2F3F5");
    expect(css).toContain("--sat-question-header-height: 52px");
  });

  it("defines the spectrum rail once, under .sat-ui, with a forced-colors separator", () => {
    for (const token of [
      "--sat-rail-gray:",
      "--sat-rail-light:",
      "--sat-rail-blue:",
      "--sat-rail-yellow:",
      "--sat-rail-height:",
      "--sat-rail-hairline:",
      "--sat-rail-pattern:",
      "--sat-rail-pattern-length:",
    ]) {
      expect(css).toContain(token);
    }
    // One definition plus the forced-colors fallback, both SAT-scoped, so the
    // top bar and the question header cannot drift apart.
    expect(css.match(/\.sat-ui \.sat-color-rail \{/g)).toHaveLength(2);
    expect(css).toContain("bottom: calc(-1 * var(--sat-rail-hairline))");
    expect(css).toContain("pointer-events: none");
    expect(css).toContain("background-image: var(--sat-rail-pattern)");
    expect(css).toContain("background-size: var(--sat-rail-pattern-length) 100%");
    expect(css).toContain("background-repeat: repeat-x");
    // Decorative segments are not retained in forced colors: one system rule.
    expect(css).toMatch(
      /\.sat-ui \.sat-color-rail \{[^}]*forced-color-adjust: none;[^}]*background-color: CanvasText;[^}]*\}/
    );
  });

  it("keeps the rail a fixed-pixel reference barcode, never a stretched gradient", () => {
    // The generated fence is the only place the pattern may be defined.
    expect(css.match(/>>> SAT SPECTRUM RAIL \(generated\) >>>/g)).toHaveLength(1);
    const fence = css.slice(
      css.indexOf(">>> SAT SPECTRUM RAIL (generated) >>>"),
      css.indexOf("<<< SAT SPECTRUM RAIL (generated) <<<"),
    );
    expect(fence.length).toBeGreaterThan(0);
    // A percentage stop would stretch with each host's width, so the top bar and
    // the question header would wear different rails: pixels only.
    expect(fence).not.toMatch(/\d%\s/);
    // Every segment is an explicit pixel range, and the palette is referenced
    // through tokens; the light breaks are the host's own surface.
    expect(fence).toMatch(/var\(--sat-rail-(gray|light|blue|yellow)\) \d+px \d+\.?\d*px/);
    expect(fence).toContain("transparent ");
    expect(fence).toContain("--sat-rail-pattern-length: ");
    expect(fence).not.toContain("repeating-linear-gradient");
    // The invented dark ink the reference replaced is gone everywhere.
    expect(css).not.toContain("--sat-rail-dark");
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
