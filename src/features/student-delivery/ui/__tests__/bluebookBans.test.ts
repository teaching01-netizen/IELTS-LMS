// Bluebook forbidden-pattern guard - Phase 0 SKELETON.
// Green checks describe reality TODAY (verified 2026-09-10).
// Bluebook-value assertions are it.todo placeholders; Phase 10 turns them
// into enforced assertions and fixes by tokenizing (no visual redesign).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DELIVERY_ROOT = resolve(__dirname, "../..");

// Every ban below is a ban on SHIPPED sources. Tests are out of scope, and
// must be: a contract test pins the very values it asserts, so it self-matches
// these patterns by construction (the token test asserts values live in CSS;
// these tests assert they live NOWHERE ELSE in shipped sources, and several
// assert a class is ABSENT by naming it). Excluding them by pattern rather than
// by name is deliberate — a hand-maintained list silently goes stale the moment
// someone adds a new contract test, which is exactly how this scan went red when
// SatImageViewer.test.tsx landed after the list was written.
function isTestFile(entry: string): boolean {
  return /\.test\.tsx?$/.test(entry);
}

function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      collectSources(full, out);
    } else if (/\.(tsx?|css)$/.test(entry)) {
      if (!isTestFile(entry)) out.push(full);
    }
  }
  return out;
}

const sources = collectSources(DELIVERY_ROOT);

function readText(file: string): string {
  return readFileSync(file, "utf8");
}

describe("bluebook bans (Phase 0 skeleton)", () => {
  it("has no gradient utilities in SAT delivery scope", () => {
    for (const file of sources) {
      expect(readText(file)).not.toMatch(/gradient/);
    }
  });

  it("uses no 800/900 font weights in SAT delivery scope", () => {
    for (const file of sources) {
      const text = readText(file);
      expect(text).not.toMatch(/font-(black|extrabold)/);
      expect(text).not.toMatch(/font-weight:\s*[89]00/);
    }
  });

  // Phase 0 reality (verified R9): `detent` exists as an EXPORT in satMotion.ts
  // + a prose `detent` mention in a SatFloatingTool comment. Decision 9 keeps
  // the export (staff/builder may use it) but bans exam-scope IMPORTS of it.
  // The skeleton scans source bodies, so it allowlists the definition site
  // and the prose mention; Phase 10 enforces import-level absence.
  it("imports no spring detent in SAT delivery scope", () => {
    for (const file of sources) {
      if (file.endsWith("ui/motion/satMotion.ts")) continue;
      const text = readText(file);
      expect(text).not.toMatch(/from\s+["'].*satMotion["'].*detent|detent.*from\s+["'].*satMotion["']/);
      expect(text).not.toMatch(/\bdetent\b\s*[,}]/);
    }
  });

  // Fallback-aware (verified R19): var(--token, #LITERAL) fallbacks MUST be
  // literals by CSS construction, and comments may name old->new values.
  // Strip var() fallback arguments + line/block comments before matching so
  // the assert bans only REAL hardcoded styling (background: #3154d7 etc).
  it("has no hardcoded Bluebook hexes outside src/index.css", () => {
    for (const file of sources) {
      const text = readText(file)
        .replace(/var\([^()]*\)/g, "var()")
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      expect(text).not.toMatch(/EAF2FD|3154D7|2947BA|223A98|E4EAFB|FFD718|F2C900|44484C|FFF2B3|FFF9D9|C9475C|005FCC|24272A|74787D|5D6268|202B78/i);
    }
  });

  // Phase 10 enforced (verified R32): SatPreviewControls is STAFF chrome
  // (aria-label "SAT staff preview controls", z-150 outside the contract),
  // and SatImageViewer is an intentional Quick Look-style inspection surface;
  // their backdrop blur is outside the ordinary exam-surface contract.
  it("forbids backdrop-blur in SAT exam scope", () => {
    for (const file of sources) {
      if (
        file.endsWith("ui/SatPreviewControls.tsx") ||
        file.endsWith("ui/media/SatImageViewer.tsx")
      ) continue;
      expect(readText(file)).not.toMatch(/backdrop-blur/);
    }
  });

  // Phase 10 enforced (verified R27-28): borders carry structure; only
  // --sat-shadow-floating (tools/menus) and --sat-shadow-modal exist (D11).
  it("forbids shadow-2xl in SAT exam scope", () => {
    for (const file of sources) {
      expect(readText(file)).not.toMatch(/shadow-2xl/);
    }
  });

  // Phase 10 enforced (verified R32): attention-yellow is rare (D5) — the
  // Help Close pill only. Contract tests NEGATIVELY pin the token (Shortcuts
  // Close stays blue accent), so *test* files may name it in asserts;
  // SHIPPED sources must not. Shell/save files mention "attention" in prose
  // comments, never the token.
  it("restricts attention-yellow to the Help Close pill", () => {
    for (const file of sources) {
      if (file.endsWith("ui/help/SatHelpModal.tsx")) continue;
      expect(readText(file)).not.toMatch(/sat-attention/);
    }
  });

  // Phase 10 enforced (verified R32): exam TSX carries no durations — motion
  // lives in CSS tokens (80/120/180ms + 40ms press exception, D9). The sole
  // "150ms" literal is an animation-delay (stagger offset), not a duration.
  it("pins motion durations to CSS tokens (no literals in exam TSX)", () => {
    for (const file of sources) {
      const text = readText(file).replace(/animation-delay:[^\s\]"]*/g, "");
      expect(text).not.toMatch(/[0-9]+ms/);
    }
  });
});
