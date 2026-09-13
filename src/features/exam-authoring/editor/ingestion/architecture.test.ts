/**
 * Phase 01 — boundary guard. domain/ + application/ + security/ stay free of
 * rendering frameworks and host APIs; math validation stays in phase 03.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Phase 03 exception (Main Agent ruling): mathConfidence.ts + mathIngest.ts are
// the ONLY ingestion modules allowed to import katex (validation gate).
// mathInputRules.ts + mathDelimiters.ts + mathmlConvert.ts import no katex.
const KATEX_ALLOWED = new Set(["mathConfidence.ts", "mathIngest.ts"]);
const ROOTS = ["domain", "application", "security"] as const;

const FORBIDDEN_SOURCES = [
  'from "react"',
  "from 'react'",
  'from "@tiptap',
  "from '@tiptap",
  'from "prosemirror',
  "from 'prosemirror",
  'from "katex"',
  "from 'katex'",
  'from "mathlive"',
  "from 'mathlive'",
  'require("react")',
  "require('react')",
  'require("katex")',
  "require('katex')",
] as const;

const FORBIDDEN_HOST = [
  "window.",
  "document.",
  "navigator.",
  "ClipboardItem",
  "DataTransfer",
] as const;

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

describe("ingestion core architecture boundary", () => {
  it("has no framework or math imports in domain/application/security", () => {
    const base = dirname(fileURLToPath(import.meta.url));
    const violations: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourcesUnder(join(base, root))) {
        const text = readFileSync(file, "utf8");
        for (const token of FORBIDDEN_SOURCES) {
          if (text.includes(token)) violations.push(file + " contains " + token);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("allows katex ONLY in the phase-03 grandfathered math modules", () => {
    const base = dirname(fileURLToPath(import.meta.url));
    const violations: string[] = [];
    for (const file of sourcesUnder(base)) {
      if (file.endsWith(".test.ts")) continue;
      const text = readFileSync(file, "utf8");
      const usesKatex = text.includes('from "katex"') || text.includes("from 'katex'");
      if (!usesKatex) continue;
      const name = file.split("/").pop() ?? file;
      if (!KATEX_ALLOWED.has(name)) violations.push(file + " imports katex outside the phase-03 exception");
    }
    expect(violations).toEqual([]);
  });

  it("touches no host globals in domain sources", () => {
    const base = dirname(fileURLToPath(import.meta.url));
    const violations: string[] = [];
    for (const file of sourcesUnder(join(base, "domain"))) {
      const text = readFileSync(file, "utf8");
      for (const token of FORBIDDEN_HOST) {
        if (text.includes(token)) violations.push(file + " uses " + token);
      }
    }
    expect(violations).toEqual([]);
  });
});
