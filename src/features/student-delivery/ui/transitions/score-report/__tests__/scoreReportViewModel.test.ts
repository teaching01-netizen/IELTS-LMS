import { describe, expect, it } from "vitest";
import type { AssessmentDeliverySection } from "../../../../contracts/assessmentDelivery";
import type { ClassroomReport } from "../../SatScoreReport";
import { buildStudentScoreReportView, fallbackModuleLabel } from "../scoreReportViewModel";

type Section = ClassroomReport["sections"][number];

const rw = (extra: Partial<Section> = {}): Section => ({ sectionKey: "reading-writing", rawCorrect: 40, total: 54, ...extra });
const math = (extra: Partial<Section> = {}): Section => ({ sectionKey: "math", rawCorrect: 34, total: 44, ...extra });
const converted = (low: number, high = low): Partial<Section> => ({ conversionStatus: "converted", scaled: { low, high } });
const report = (sections: Section[], extra: Partial<ClassroomReport> = {}): ClassroomReport => ({
  rawCorrect: sections.reduce((n, s) => n + s.rawCorrect, 0),
  total: sections.reduce((n, s) => n + s.total, 0),
  sections,
  ...extra,
});

describe("buildStudentScoreReportView", () => {
  it("labels SAT module keys with their module number", () => {
    expect(fallbackModuleLabel("rw-m1")).toBe("Module 1");
    expect(fallbackModuleLabel("math-m2-higher")).toBe("Module 2");
    expect(fallbackModuleLabel("math-m2-lower")).toBe("Module 2");
  });

  it("R01 full SAT, both converted: total primary, both sections", () => {
    const view = buildStudentScoreReportView(
      report([rw(converted(580)), math(converted(630))], { totalScaled: { low: 1210, high: 1210 }, conversion: { converterVersion: "v1" } }),
    );
    expect(view.layout).toBe("full-sat");
    expect(view.showCombinedScore).toBe(true);
    expect(view.primaryScore).toMatchObject({ kind: "estimated", low: 1210, high: 1210, scale: { min: 400, max: 1600 } });
    expect(view.subjects.map((s) => s.key)).toEqual(["reading-writing", "math"]);
    expect(view.subjects.map((s) => s.score.kind)).toEqual(["estimated", "estimated"]);
    expect(view.methodology).toEqual({ isEstimated: true, converterVersion: "v1" });
  });

  it("R02/R03 one converted subject: its section score is primary, no total, no other subject", () => {
    for (const [section, key] of [[math(converted(620)), "math"], [rw(converted(580)), "reading-writing"]] as const) {
      const view = buildStudentScoreReportView(report([section], { totalScaled: { low: 1200, high: 1200 } }));
      expect(view.layout).toBe("single-subject");
      expect(view.showCombinedScore).toBe(false);
      expect(view.subjects.map((s) => s.key)).toEqual([key]);
      expect(view.primaryScore).toMatchObject({ kind: "estimated", scale: { min: 200, max: 800 } });
    }
  });

  it("R04/R05/R11 one subject without a converter: raw is primary, never a fake zero", () => {
    for (const section of [math(), rw({ conversionStatus: "unavailable" })]) {
      const view = buildStudentScoreReportView(report([section]));
      expect(view.primaryScore).toEqual({ kind: "raw", correct: section.rawCorrect, total: section.total });
      expect(view.notice).toMatch(/not available/);
      expect(view.methodology.isEstimated).toBe(false);
    }
  });

  it("treats a blank converter version as absent instead of suppressing the raw result", () => {
    const view = buildStudentScoreReportView(
      report([math({ conversionStatus: "unavailable" })], {
        conversion: { converterVersion: " \t\n " },
      }),
    );

    expect(view.primaryScore).toEqual({ kind: "raw", correct: 34, total: 44 });
    expect(view.methodology.converterVersion).toBeNull();
  });

  it("treats malformed converter metadata as absent without throwing", () => {
    const view = buildStudentScoreReportView(
      report([math({ conversionStatus: "unavailable" })], {
        conversion: { converterVersion: 7 } as unknown as ClassroomReport["conversion"],
      }),
    );

    expect(view.primaryScore).toEqual({ kind: "raw", correct: 34, total: 44 });
    expect(view.methodology.converterVersion).toBeNull();
  });

  it("R06 full SAT with one converted section: no total, no invented combination", () => {
    const view = buildStudentScoreReportView(
      report([rw(), math(converted(630))], { totalScaled: { low: 1210, high: 1210 } }),
    );
    expect(view.layout).toBe("partial-results");
    expect(view.showCombinedScore).toBe(false);
    expect(view.primaryScore).toBeNull();
    expect(view.subjects[0]!.score).toEqual({ kind: "raw", correct: 40, total: 54 });
    expect(view.subjects[1]!.score.kind).toBe("estimated");
    expect(view.notice).toMatch(/combined score is unavailable/);
  });

  it("R07 full SAT, neither converted: raw total only", () => {
    const view = buildStudentScoreReportView(report([rw(), math()]));
    expect(view.layout).toBe("partial-results");
    expect(view.primaryScore).toEqual({ kind: "raw", correct: 74, total: 98 });
  });

  it("shows a dash for an unavailable single-subject estimate and retains raw details", () => {
    const section = math({
      conversionStatus: "unavailable",
      modules: [{ moduleKey: "math-m1", rawCorrect: 20, total: 22 }],
    });
    const view = buildStudentScoreReportView(
      report([section], {
        conversion: { converterVersion: "v1" },
        domains: [{ sectionKey: "math", domain: "Algebra", correct: 8, total: 10 }],
      }),
    );

    expect(view.primaryScore).toEqual({
      kind: "unavailable",
      reason: "Estimated Math score is unavailable.",
      display: "dash",
    });
    expect(view.subjects[0]).toMatchObject({
      rawCorrect: 34,
      rawTotal: 44,
      modules: [{ key: "math-m1", rawCorrect: 20, rawTotal: 22 }],
      domains: [{ name: "Algebra", correct: 8, total: 10, accuracy: 80 }],
    });
  });

  it("filters malformed fractional module and domain rows without hiding valid report details", () => {
    const view = buildStudentScoreReportView(
      report(
        [math({
          modules: [
            { moduleKey: "math-m1", rawCorrect: 20.5, total: 22 },
            { moduleKey: "math-m2", rawCorrect: 21, total: 22 },
          ],
        })],
        {
          domains: [
            { sectionKey: "math", domain: "Algebra", correct: 8.5, total: 10 },
            { sectionKey: "math", domain: "Geometry", correct: 7, total: 10 },
          ],
        },
      ),
    );

    expect(view.layout).toBe("single-subject");
    expect(view.primaryScore).toEqual({ kind: "raw", correct: 34, total: 44 });
    expect(view.subjects[0]!.modules.map((module) => module.key)).toEqual(["math-m2"]);
    expect(view.subjects[0]!.domains.map((domain) => domain.name)).toEqual(["Geometry"]);
    expect(view.issues).toContain("module-invalid");
    expect(view.issues).toContain("domain-invalid");
  });

  it("shows dashes for unavailable section and combined estimates while retaining converted sections", () => {
    const view = buildStudentScoreReportView(
      report(
        [rw({ conversionStatus: "unavailable" }), math(converted(620))],
        { conversion: { converterVersion: "v1" } },
      ),
    );

    expect(view.layout).toBe("partial-results");
    expect(view.primaryLabel).toBe("Estimated total SAT score");
    expect(view.primaryScore).toMatchObject({ kind: "unavailable", display: "dash" });
    expect(view.subjects.map((subject) => subject.score.kind)).toEqual(["unavailable", "estimated"]);
    expect(view.subjects[0]!.rawCorrect).toBe(40);
  });

  it("does not substitute a raw total when an active converter cannot convert either section", () => {
    const view = buildStudentScoreReportView(
      report(
        [rw({ conversionStatus: "unavailable" }), math({ conversionStatus: "unavailable" })],
        { conversion: { converterVersion: "v1" } },
      ),
    );

    expect(view.primaryScore).toMatchObject({ kind: "unavailable", display: "dash" });
    expect(view.subjects.map((subject) => subject.score)).toEqual([
      expect.objectContaining({ kind: "unavailable", display: "dash" }),
      expect.objectContaining({ kind: "unavailable", display: "dash" }),
    ]);
    expect(view.subjects.map((subject) => [subject.rawCorrect, subject.rawTotal])).toEqual([
      [40, 54],
      [34, 44],
    ]);
  });

  it("R08/R09 only the administered module is listed, with no placeholder for the other", () => {
    const view = buildStudentScoreReportView(report([math({ modules: [{ moduleKey: "math-2", rawCorrect: 15, total: 22 }] })]));
    expect(view.subjects[0]!.modules).toEqual([{ key: "math-2", label: "Module 2", rawCorrect: 15, rawTotal: 22 }]);
  });

  it("R10 a range stays an exact interval", () => {
    const view = buildStudentScoreReportView(report([math(converted(500, 520))]));
    expect(view.primaryScore).toMatchObject({ low: 500, high: 520 });
  });

  it("rejects scaled scores outside their scale or inverted, falling back to raw", () => {
    for (const bad of [converted(900), converted(100), converted(605), converted(600, 500), { conversionStatus: "converted" as const }]) {
      const view = buildStudentScoreReportView(report([math(bad)]));
      expect(view.primaryScore?.kind).toBe("raw");
    }
    const total = buildStudentScoreReportView(
      report([rw(converted(580)), math(converted(630))], { totalScaled: { low: 1700, high: 1700 } }),
    );
    expect(total.layout).toBe("partial-results");
    expect(total.issues).toContain("total-scaled-invalid");
  });

  it("shows a dash instead of accepting malformed converted score intervals", () => {
    const malformed = [
      { conversionStatus: "converted" as const, scaled: { low: 600.5, high: 600.5 } },
      { conversionStatus: "converted" as const, scaled: { low: 605, high: 605 } },
      { conversionStatus: "converted" as const, scaled: { low: 600, high: 615 } },
      { conversionStatus: "converted" as const },
    ];
    for (const badScore of malformed) {
      const view = buildStudentScoreReportView(
        report([math(badScore)], {
          conversion: { converterVersion: "v1" },
        }),
      );

      expect(view.primaryScore).toMatchObject({ kind: "unavailable", display: "dash" });
      expect(view.issues).toContain("scaled-invalid");
    }

    for (const totalScaled of [{ low: 1215, high: 1215 }, { low: 1210.5, high: 1210.5 }]) {
      const total = buildStudentScoreReportView(
        report([rw(converted(580)), math(converted(630))], {
          conversion: { converterVersion: "v1" },
          totalScaled,
        }),
      );
      expect(total.primaryScore).toMatchObject({ kind: "unavailable", display: "dash" });
      expect(total.subjects.map((subject) => subject.score.kind)).toEqual(["estimated", "estimated"]);
      expect(total.issues).toContain("total-scaled-invalid");
    }
  });

  it("R13 duplicate or invalid sections give the unavailable state", () => {
    const bad = [
      [math(), math()],
      [math({ rawCorrect: 50 })],
      [math({ rawCorrect: -1 })],
      [math({ rawCorrect: 10.5 })],
      [math({ total: 44.5 })],
      [math({ total: Number.NaN })],
      [{ sectionKey: "history", rawCorrect: 1, total: 2 }],
      [rw(), math({ rawCorrect: 99 })],
    ];
    for (const sections of bad) {
      const view = buildStudentScoreReportView(report(sections));
      expect(view.layout).toBe("unavailable");
      expect(view.subjects).toEqual([]);
      expect(view.primaryScore?.kind).toBe("unavailable");
    }
  });

  it("ignores unknown sections next to a recognized one without changing the layout inputs", () => {
    const view = buildStudentScoreReportView(report([math(), { sectionKey: "history", rawCorrect: 1, total: 2 }]));
    expect(view.layout).toBe("single-subject");
    expect(view.issues).toContain("section-unknown");
  });

  it("R14/R15 domains: no percentage without scored questions, exact counts for one question", () => {
    const view = buildStudentScoreReportView(
      report([math()], {
        domains: [
          { sectionKey: "math", domain: "Algebra", correct: 0, total: 0 },
          { sectionKey: "math", domain: "Geometry", correct: 1, total: 1 },
          { sectionKey: "reading-writing", domain: "Craft", correct: 1, total: 2 },
          { sectionKey: "math", domain: "Broken", correct: 3, total: 2 },
          { sectionKey: "math", domain: "Geometry", correct: 0, total: 1 },
        ],
      }),
    );
    expect(view.subjects[0]!.domains).toEqual([
      { name: "Algebra", correct: 0, total: 0, accuracy: null },
      { name: "Geometry", correct: 1, total: 1, accuracy: 100 },
    ]);
  });

  it("titles and orders modules from the delivered assessment, falling back to readable labels", () => {
    const delivered = [
      {
        sectionKey: "math",
        modules: [
          { moduleKey: "a", title: "Second", displayOrder: 1 },
          { moduleKey: "b", title: "First", displayOrder: 0 },
        ],
      },
    ] as unknown as AssessmentDeliverySection[];
    const modules = [
      { moduleKey: "a", rawCorrect: 1, total: 2 },
      { moduleKey: "b", rawCorrect: 2, total: 2 },
    ];
    expect(buildStudentScoreReportView(report([math({ modules })]), delivered).subjects[0]!.modules.map((m) => m.label)).toEqual(["First", "Second"]);
    expect(buildStudentScoreReportView(report([math({ modules })])).subjects[0]!.modules.map((m) => m.label)).toEqual(["A", "B"]);
  });
});
