import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";

type AxeViolation = { id: string; impact: string | null; targets: Array<{ selector: string; html: string; failure: string | null }> };

/** Fail browser audits on blocking axe findings; retain minor findings for the manual audit. */
export async function expectNoSeriousAxeViolations(page: Page, surface: string): Promise<void> {
  const axeLoaded = await page.evaluate(() => typeof (window as Window & { axe?: { run?: unknown } }).axe?.run === "function");
  if (!axeLoaded) {
    const axePath = resolve(process.cwd(), "node_modules/axe-core/axe.min.js");
    if (!existsSync(axePath)) throw new Error(`axe-core is not installed at ${axePath}`);
    await page.addScriptTag({ content: readFileSync(axePath, "utf8") });
  }
  const violations = await page.evaluate(async () => {
    const axe = (window as Window & { axe: { run: (context: Element, options: unknown) => Promise<unknown> } }).axe;
    const result = (await axe.run(document.body, {
      resultTypes: ["violations"],
    })) as { violations: Array<{ id: string; impact?: string | null; nodes: Array<{ target: string[]; html: string; failureSummary?: string }> }> };
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      targets: violation.nodes.map((node) => ({
        selector: node.target.join(" "),
        html: node.html,
        failure: node.failureSummary ?? null,
      })),
    }));
  });
  const blocking = (violations as AxeViolation[]).filter((violation) => violation.impact === "critical" || violation.impact === "serious");
  expect(blocking, `axe reported critical/serious violations in ${surface}`).toEqual([]);
}
