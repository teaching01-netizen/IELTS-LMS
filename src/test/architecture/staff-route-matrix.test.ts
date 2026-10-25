import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RequireAuth } from "../../features/auth/RequireAuth";

/**
 * Staff route/role inventory (rewrite plan, Package 0).
 *
 * Every staff entry, alias, and its allowed roles is recorded here. The
 * frontend rewrite must keep route compatibility and permissions: a removed
 * path, a new path, or a widened/narrowed role list fails until this matrix
 * is updated deliberately in the same change.
 *
 * Aliases kept for old bookmarks:
 * - `/sat/exams/:examId/release` → SAT Settings (or Rooms for `?view=access|links`);
 *   IELTS keeps its review page at the same component.
 * - `/builder/:examId` serves both providers' authoring entry; IELTS adds
 *   `/builder/:examId/{builder,review,preview,answer-key}`.
 * - `/admin` and `/sat` index routes redirect to the role landing path.
 */
const STAFF_ROUTE_MATRIX: Record<string, string[]> = {
  "/admin": ["admin", "builder", "grader"],
  "/admin/exams": ["admin", "builder"],
  "/admin/library": ["admin", "builder"],
  "/admin/scheduling": ["admin", "builder", "grader"],
  "/admin/grading": ["admin", "grader"],
  "/admin/results": ["admin", "grader"],
  "/admin/settings": ["admin", "builder"],
  "/admin/answer-history/:submissionId": ["admin", "grader"],
  "/sat": ["admin", "builder", "proctor", "grader"],
  "/sat/exams": ["admin", "builder"],
  "/sat/sessions": ["admin", "proctor"],
  "/sat/results": ["admin", "grader", "proctor"],
  "/sat/forms": ["admin", "proctor"],
  "/sat/results/attempts/:attemptId": ["admin", "grader", "proctor"],
  "/sat/results/:resultId": ["admin", "grader", "proctor"],
  "/sat/score-conversion": ["admin"],
  "/sat/sessions/:scheduleId": ["admin", "proctor"],
  "/sat/exams/:examId": ["admin", "builder"],
  "/sat/exams/:examId/release": ["admin", "builder"],
  "/sat/exams/:examId/preview": ["admin", "builder"],
  "/sat/exams/:examId/access": ["admin", "builder"],
  "/sat/exams/:examId/settings": ["admin", "builder"],
  "/sat/exams/:examId/responses": ["admin"],
  "/builder/:examId": ["admin", "builder"],
  "/builder/:examId/builder": ["admin", "builder"],
  "/builder/:examId/review": ["admin", "builder"],
  "/builder/:examId/preview": ["admin", "builder"],
  "/builder/:examId/answer-key": ["admin", "builder"],
  "/proctor": ["admin", "proctor"],
  "/proctor/answer-history/:attemptId": ["admin", "proctor"],
};

const STAFF_PREFIXES = ["/admin", "/sat", "/builder", "/proctor"];

function joinPath(parent: string, child: string | undefined): string {
  if (!child) return parent;
  if (child.startsWith("/")) return child;
  return `${parent === "/" ? "" : parent}/${child}`;
}

function rolesOf(element: ReactNode): string[] | null {
  if (!isValidElement(element)) return null;
  const typed = element as ReactElement<{ allowedRoles?: string[]; children?: ReactNode }>;
  if (typed.type === RequireAuth) return typed.props.allowedRoles ?? [];
  return null;
}

async function collect(routes: RouteObject[], parent = ""): Promise<Record<string, string[]>> {
  const found: Record<string, string[]> = {};
  for (const route of routes) {
    if (route.index) continue;
    const path = joinPath(parent, route.path);
    let element = route.element;
    if (!element && typeof route.lazy === "function") {
      const resolved = (await route.lazy()) as { element?: ReactNode };
      element = resolved.element;
    }
    const roles = rolesOf(element);
    if (roles && STAFF_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      found[path] = [...roles];
    }
    if (route.children) Object.assign(found, await collect(route.children, path));
  }
  return found;
}

describe("staff route/role matrix", () => {
  it("matches the recorded inventory of staff entries, aliases, and roles", async () => {
    const { appRoutes } = await import("../../app/router/createRouter");
    const actual = await collect(appRoutes as RouteObject[]);
    expect(actual).toEqual(STAFF_ROUTE_MATRIX);
  }, 60_000);
});
