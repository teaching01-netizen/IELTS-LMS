import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

describe("PostCSS Safari 100vh fallback", () => {
  const projectRoot = resolve(__dirname, "../..");
  const configPath = resolve(projectRoot, "postcss.config.cjs");
  const studentAppSource = readFileSync(
    resolve(projectRoot, "src/components/student/StudentApp.tsx"),
    "utf8"
  );
  const studentShellSource = readFileSync(
    resolve(projectRoot, "src/components/student/layout/StudentExamShell.tsx"),
    "utf8"
  );
  const appCss = readFileSync(resolve(projectRoot, "src/index.css"), "utf8");

  it("emits -webkit-fill-available after the modern viewport cascade", async () => {
    expect(existsSync(configPath)).toBe(true);
    if (!existsSync(configPath)) return;

    const packageJson = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.devDependencies?.["postcss-100vh-fix"]).toBeDefined();

    const require = createRequire(import.meta.url);
    const config = require(configPath) as { plugins: postcss.AcceptedPlugin[] };
    const result = await postcss(config.plugins).process(
      `.student-exam-shell {
        height: 100vh;
        height: 100svh;
        height: 100dvh;
      }`,
      { from: undefined }
    );

    expect(result.css).toContain("@supports (-webkit-touch-callout: none)");
    expect(result.css).toMatch(
      /@supports \(-webkit-touch-callout: none\)[\s\S]*height: -webkit-fill-available/
    );
    expect(result.css).toContain("height: 100dvh");
  });

  it("keeps the active exam shell height-owned by a single semantic CSS variable", () => {
    const shellStyle = studentAppSource.match(
      /const studentShellStyle = useMemo\(([\s\S]*?)as React\.CSSProperties/
    )?.[1];
    expect(shellStyle).toBeDefined();
    expect(shellStyle).not.toMatch(/height:/);

    const activeShellClass = studentShellSource.match(
      /className=\{`([^`]*student-exam-shell[^`]*)`\}/
    )?.[1];
    expect(activeShellClass).toBeDefined();
    expect(activeShellClass).not.toContain("h-screen");
    expect(appCss).toMatch(/height:\s*var\(--student-exam-height,\s*100dvh\)\s*;/);
    expect(appCss).not.toContain("--student-visual-viewport-height");
    expect(appCss).not.toMatch(/@supports\s*\(height:\s*100svh\)/);
  });
});
