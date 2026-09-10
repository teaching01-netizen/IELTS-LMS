import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Bluebook token contract — Phase 0 BASELINE LOCK.
 *
 * Documents reality BEFORE the Bluebook remap (verified 2026-09-10).
 * Must PASS on current values. Phases 1-2 will update these assertions
 * to the Bluebook targets with justification in the commit body.
 */
describe("bluebook tokens (Phase 0 baseline lock)", () => {
  const css = readFileSync(resolve(__dirname, "../../../../index.css"), "utf8");

  it("locks the current Apple-blue accent core", () => {
    expect(css).toMatch(/--sat-accent-core:\s*#0071e3\s*;/i);
  });

  // Phase 1 (L0 fallback R9): remapped Apple #fff1a8 -> Bluebook paper #FFF2B3.
  it("uses Bluebook paper-yellow highlight", () => {
    expect(css).toMatch(/--sat-highlight-background:\s*#FFF2B3\s*;/i);
  });

  // Phase 8 (L0 R20): scrim remapped bg-black/40 -> 72% token (Lane 4 note 2).
  it("uses the 72pc scrim token, not the legacy dim utility", () => {
    const modal = readFileSync(
      resolve(__dirname, "../primitives/SatCenterModal.tsx"),
      "utf8",
    );
    expect(modal).toContain("var(--sat-scrim)");
    expect(modal).not.toContain("bg-black/40");
  });

  // Phase 1 (L0 fallback R9): pale-blue chrome brackets the white document.
  it("defines Bluebook chrome + royal action + attention + scrim primitives", () => {
    for (const token of [
      "--sat-chrome: #EAF2FD",
      "--sat-accent: #3154D7",
      "--sat-accent-strong: #2947BA",
      "--sat-accent-pressed: #223A98",
      "--sat-attention: #FFD718",
      "--sat-focus: #005FCC",
      "--sat-review: #C9475C",
      "--sat-answer-border: #74787D",
      "--sat-scrim: rgb(0 0 0 / 72%)",
      "--sat-reader-mask: rgb(20 20 20 / 92%)",
    ]) expect(css).toContain(token);
  });
});

/**
 * Phase 2 — SEMANTIC + COMPONENT contract (assert-only; token blocks landed
 * L0 R10 in `.sat-ui`, Lane 1 owns asserts + consumer re-points, never values).
 *
 * ACCENT MAPPING (L0 steer; deliberate deviation from plan Phase-1 noted here):
 * today `--sat-accent-strong` means hover-blue (#0067b8) and is consumed as
 * TEXT (SatHelpModal Expand/Collapse, navigator current-item, popover reset
 * links) and as the footer primary-pill BORDER paired with an accent fill.
 * Remapping -strong to the darkest pressed step (#223A98) would break
 * text-on-white contrast and that border pairing. So: `--sat-accent` #3154D7
 * (fills), `--sat-accent-strong` #2947BA (hover + text-on-white, AA 7.76:1),
 * NEW `--sat-accent-pressed` #223A98 (pressed states only). High-contrast
 * -strong stays #003f87-grade (already darker, fine).
 */
describe("bluebook semantic tokens (Phase 2)", () => {
  const css = readFileSync(resolve(__dirname, "../../../../index.css"), "utf8");

  it("bridges primitives through semantic aliases (never literals)", () => {
    for (const token of [
      "--sat-shell-bg: var(--sat-chrome)",
      "--sat-body-bg: var(--sat-background)",
      "--sat-control-primary-bg: var(--sat-accent)",
      "--sat-control-primary-bg-hover: var(--sat-accent-hover)",
      "--sat-control-primary-bg-pressed: var(--sat-accent-pressed)",
      "--sat-control-primary-fg: var(--sat-accent-text)",
      "--sat-answer-bg: var(--sat-surface)",
      "--sat-answer-border-strong: var(--sat-answer-border)",
      "--sat-progress-bg: var(--sat-progress)",
      "--sat-progress-fg: #ffffff",
      "--sat-review-active: var(--sat-review)",
      "--sat-annotation-bg: var(--sat-highlight-background)",
      "--sat-modal-bg: var(--sat-surface)",
      "--sat-modal-scrim: var(--sat-scrim)",
    ]) expect(css).toContain(token);
  });

  it("keeps progress near-black, never blue", () => {
    expect(css).toContain("--sat-progress: #191919");
    expect(css).toMatch(/--sat-progress-bg:\s*var\(--sat-progress\)/);
  });
});

describe("bluebook component tokens (Phase 2: answer + primary button)", () => {
  const css = readFileSync(resolve(__dirname, "../../../../index.css"), "utf8");

  it("defines answer geometry tokens", () => {
    for (const token of [
      "--sat-answer-min-height: 52px",
      "--sat-answer-radius: 8px",
    ]) expect(css).toContain(token);
  });

  it("defines primary-button tokens (pill 999px, 44px target)", () => {
    for (const token of [
      "--sat-button-height: 44px",
      "--sat-button-radius: 999px",
    ]) expect(css).toContain(token);
  });

  it("re-points the footer primary-button class to button tokens", () => {
    const footer = readFileSync(
      resolve(__dirname, "../shell/SatExamFooter.tsx"),
      "utf8",
    );
    expect(footer).toContain("var(--sat-control-primary-bg)");
    expect(footer).toContain("var(--sat-button-radius)");
  });
});
