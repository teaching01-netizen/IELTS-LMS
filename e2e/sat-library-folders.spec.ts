import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoSeriousAxeViolations } from "./support/axeAudit";

const STAFF_SESSION = {
  success: true,
  data: {
    user: { id: "admin-1", email: "admin@example.com", displayName: "Admin", role: "admin", state: "active" },
    csrfToken: "csrf-e2e-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
};

type Exam = ReturnType<typeof exam>;
type Folder = ReturnType<typeof folder>;

function exam(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    slug: id,
    title,
    providerKey: "sat",
    examType: "Academic",
    status: "draft",
    visibility: "organization",
    organizationId: "org-1",
    ownerId: "admin-1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-30T10:00:00Z",
    currentDraftVersionId: `draft-${id}`,
    currentPublishedVersionId: null,
    satCustomModules: true,
    canEdit: true,
    canPublish: true,
    canDelete: true,
    schemaVersion: 4,
    revision: 0,
    ...extra,
  };
}

function folder(id: string, name: string, parentId: string | null = null, organizationId = "org-1", updatedAt = "2026-08-30T00:00:00Z") {
  return {
    id,
    scopeKey: `sat|${organizationId}`,
    providerKey: "sat",
    organizationId,
    parentId,
    name,
    revision: 0,
    createdBy: "admin-1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt,
  };
}

// A realistic library: dozens of mixed-type exams, published/draft/archived,
// long titles, nested folders, and repeated folder names in different branches.
function baseExams(): Exam[] {
  return [
    exam("sat-root", "Root Exam", { updatedAt: "2026-08-30T10:00:00Z" }),
    exam("sat-full-01", "Full-Length Mock 01", { satCustomModules: false, updatedAt: "2026-08-29T10:00:00Z" }),
    exam("sat-published", "Published Practice", { status: "published", currentPublishedVersionId: "pub-1", satCustomModules: false, updatedAt: "2026-08-28T10:00:00Z" }),
    exam("sat-long", "Autumn Full-Length Mock 04 — Reading & Writing and Mathematics with Adaptive Modules and Extended Time", { updatedAt: "2026-08-27T10:00:00Z" }),
    exam("sat-math-only", "Math Only Checkpoint", { satCustomModules: false, satSectionScope: "math", updatedAt: "2026-08-26T10:00:00Z" }),
    exam("sat-editing-changes", "Editing After Publish", { currentPublishedVersionId: "pub-2", updatedAt: "2026-08-25T10:00:00Z" }),
    exam("sat-root-2", "Root Practice 02", { updatedAt: "2026-08-24T10:00:00Z" }),
    exam("sat-root-3", "Root Practice 03", { satCustomModules: false, updatedAt: "2026-08-23T10:00:00Z" }),
    exam("sat-arch-root", "Old Root Mock", { status: "archived", satCustomModules: false, updatedAt: "2026-07-30T10:00:00Z" }),
    exam("sat-filed", "Filed Exam", { updatedAt: "2026-08-22T10:00:00Z" }),
    exam("sat-physics-2", "Physics Skills Check", { satCustomModules: false, updatedAt: "2026-08-22T09:00:00Z" }),
    exam("sat-mech-check", "Mechanics Checkpoint — Forces and Motion", { status: "published", currentPublishedVersionId: "pub-3", updatedAt: "2026-08-21T10:00:00Z" }),
    exam("sat-week9", "Week 9 Exit Ticket", { updatedAt: "2026-08-20T10:00:00Z" }),
    exam("sat-autumn-diag", "Autumn Diagnostic", { status: "published", currentPublishedVersionId: "pub-4", satCustomModules: false, updatedAt: "2026-08-19T10:00:00Z" }),
    exam("sat-week1a", "Week 1 Reading Sprint", { updatedAt: "2026-08-18T10:00:00Z" }),
    exam("sat-week1p", "Week 1 Math Sprint", { satCustomModules: false, updatedAt: "2026-08-17T10:00:00Z" }),
    exam("sat-past-1", "Spring 2025 Past Paper", { updatedAt: "2026-08-16T10:00:00Z" }),
    exam("sat-past-2", "Autumn 2024 Past Paper", { satCustomModules: false, updatedAt: "2026-08-15T10:00:00Z" }),
    exam("sat-arch-phys", "Archived Physics Exam", { status: "archived", updatedAt: "2026-07-29T10:00:00Z" }),
    exam("sat-arch-mech", "Archived Mechanics Quiz", { status: "archived", updatedAt: "2026-07-28T10:00:00Z" }),
    exam("sat-arch-autumn", "Archived Autumn Mock", { status: "archived", updatedAt: "2026-07-27T10:00:00Z" }),
    exam("sat-mech-1", "Forces Quiz 01", { updatedAt: "2026-08-14T10:00:00Z" }),
    exam("sat-mech-2", "Forces Quiz 02", { satCustomModules: false, updatedAt: "2026-08-13T10:00:00Z" }),
    exam("sat-mech-3", "Motion Review 01", { updatedAt: "2026-08-12T10:00:00Z" }),
    exam("sat-week9-2", "Week 9 Warm-up", { satCustomModules: false, updatedAt: "2026-08-11T10:00:00Z" }),
    exam("sat-autumn-2", "Autumn Reading Checkpoint", { updatedAt: "2026-08-10T10:00:00Z" }),
    exam("sat-autumn-3", "Autumn Math Checkpoint", { satCustomModules: false, updatedAt: "2026-08-09T10:00:00Z" }),
    exam("sat-past-3", "Summer 2024 Past Paper", { updatedAt: "2026-08-08T10:00:00Z" }),
    exam("sat-past-4", "Winter 2023 Past Paper", { satCustomModules: false, updatedAt: "2026-08-07T10:00:00Z" }),
    exam("sat-other-org", "Other Org Exam", { organizationId: "org-2", updatedAt: "2026-08-06T10:00:00Z" }),
  ];
}

function baseLibrary() {
  return {
    folders: [
      folder("f-autumn", "Autumn 2026"),
      folder("f-physics", "Physics"),
      folder("f-mech", "Mechanics", "f-physics"),
      folder("f-week9", "Week 9", "f-physics"),
      folder("f-week1a", "Week 1", "f-autumn"),
      folder("f-week1p", "Week 1", "f-physics"),
      folder("f-past", "Past papers"),
      folder("f-scratch", "Scratch"),
      folder("f-other", "Other Org", null, "org-2"),
    ],
    entries: [
      { examId: "sat-filed", folderId: "f-physics", revision: 0 },
      { examId: "sat-physics-2", folderId: "f-physics", revision: 0 },
      { examId: "sat-mech-check", folderId: "f-mech", revision: 0 },
      { examId: "sat-mech-1", folderId: "f-mech", revision: 0 },
      { examId: "sat-mech-2", folderId: "f-mech", revision: 0 },
      { examId: "sat-mech-3", folderId: "f-mech", revision: 0 },
      { examId: "sat-week9", folderId: "f-week9", revision: 0 },
      { examId: "sat-week9-2", folderId: "f-week9", revision: 0 },
      { examId: "sat-autumn-diag", folderId: "f-autumn", revision: 0 },
      { examId: "sat-autumn-2", folderId: "f-autumn", revision: 0 },
      { examId: "sat-autumn-3", folderId: "f-autumn", revision: 0 },
      { examId: "sat-week1a", folderId: "f-week1a", revision: 0 },
      { examId: "sat-week1p", folderId: "f-week1p", revision: 0 },
      { examId: "sat-past-1", folderId: "f-past", revision: 0 },
      { examId: "sat-past-2", folderId: "f-past", revision: 0 },
      { examId: "sat-past-3", folderId: "f-past", revision: 0 },
      { examId: "sat-past-4", folderId: "f-past", revision: 0 },
      { examId: "sat-arch-phys", folderId: "f-physics", revision: 0 },
      { examId: "sat-arch-mech", folderId: "f-mech", revision: 0 },
      { examId: "sat-arch-autumn", folderId: "f-autumn", revision: 0 },
      { examId: "sat-other-org", folderId: "f-other", revision: 0 },
    ],
  };
}

async function installStatefulTransport(
  page: Page,
  opts: { failLibrary?: boolean; delayLibraryMs?: number; holdLibrary?: Promise<void> } = {},
) {
  const exams = baseExams();
  const library = baseLibrary();
  const moves: Array<{ body: { items: Array<{ examId: string; revision: number }>; folderId: string | null }; headers: Record<string, string> }> = [];
  const folderCreates: Array<{ body: { name: string; parentId?: string | null; contextExamId?: string | null }; idempotencyKey: string | null }> = [];
  const folderWrites: Array<{ id: string; method: string; body: Record<string, unknown> }> = [];
  const receipts = new Map<string, { fingerprint: string; folder: Folder }>();
  const state = { failDeleteOnce: false };

  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-e2e-token" },
      body: JSON.stringify(STAFF_SESSION),
    }),
  );
  await page.route("**/api/v1/exams*", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: exams }) });
  });
  await page.route("**/api/v1/exam-library/move-exams", async (route) => {
    const body = route.request().postDataJSON() as { items: Array<{ examId: string; revision: number }>; folderId: string | null };
    moves.push({ body, headers: route.request().headers() });
    for (const item of body.items ?? []) {
      const existing = library.entries.find((entry) => entry.examId === item.examId);
      const folderId = body.folderId ?? null;
      if (existing) {
        if (existing.revision !== item.revision && existing.folderId !== folderId) {
          return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "CONFLICT", message: "An exam changed" } }) });
        }
        existing.folderId = folderId;
        existing.revision += 1;
      } else {
        if (item.revision !== 0) {
          return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "CONFLICT", message: "An exam changed" } }) });
        }
        library.entries.push({ examId: item.examId, folderId, revision: 1 });
      }
    }
    const out = library.entries.filter((entry) => (body.items ?? []).some((item) => item.examId === entry.examId));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { entries: out } }) });
  });
  await page.route("**/api/v1/exam-library/folders", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { name: string; parentId?: string | null; contextExamId?: string | null };
    const key = await route.request().headerValue("idempotency-key");
    folderCreates.push({ body, idempotencyKey: key });
    if (!key) {
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "VALIDATION", message: "Idempotency-Key is required." } }) });
    }
    const fingerprint = JSON.stringify(body);
    const replay = receipts.get(key);
    if (replay) {
      return route.fulfill({ status: replay.fingerprint === fingerprint ? 201 : 409, contentType: "application/json", body: JSON.stringify({ success: true, data: replay.folder }) });
    }
    const parentId = body.parentId ?? null;
    const org = library.folders.find((row) => row.id === parentId)?.organizationId
      ?? exams.find((row) => row.id === body.contextExamId)?.organizationId
      ?? "org-1";
    if (library.folders.some((row) => row.organizationId === org && (row.parentId ?? null) === parentId && row.name.toLowerCase() === body.name.trim().toLowerCase())) {
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "CONFLICT", message: "A folder with this name already exists here." } }) });
    }
    const created = folder(`f-new-${folderCreates.length}`, body.name.trim(), parentId, org, new Date().toISOString());
    library.folders.push(created);
    receipts.set(key, { fingerprint, folder: { ...created } });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ success: true, data: created }) });
  });
  await page.route("**/api/v1/exam-library/folders/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    const row = library.folders.find((candidate) => candidate.id === id);
    if (!row) {
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Folder not found." } }) });
    }
    const method = route.request().method();
    const body = method === "PATCH"
      ? (route.request().postDataJSON() as Record<string, unknown>)
      : { revision: Number(new URL(route.request().url()).searchParams.get("revision")) };
    folderWrites.push({ id, method, body });
    if (body.revision !== row.revision) {
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "CONFLICT", message: "Folder changed; retry." } }) });
    }
    if (method === "PATCH") {
      if ("name" in body) row.name = String(body.name);
      if ("parentId" in body) row.parentId = body.parentId as string | null;
      row.revision += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: row }) });
    }
    if (method === "DELETE") {
      if (state.failDeleteOnce) {
        state.failDeleteOnce = false;
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "Folder service unavailable" } }) });
      }
      if (library.folders.some((candidate) => candidate.parentId === id) || library.entries.some((entry) => entry.folderId === id)) {
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "CONFLICT", message: "Folder is not empty. Move its contents out first." } }) });
      }
      library.folders.splice(library.folders.indexOf(row), 1);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { ok: true } }) });
    }
    return route.fallback();
  });
  await page.route("**/api/v1/exam-library*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    if (opts.failLibrary) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "Folder service unavailable" } }) });
    }
    if (opts.holdLibrary) await opts.holdLibrary;
    if (opts.delayLibraryMs) await new Promise((resolve) => setTimeout(resolve, opts.delayLibraryMs));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: library }) });
  });
  await page.route("**/api/v1/sat/exam-config/defaults", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { preset: "standard_sat", config: {}, limits: {}, classroomCreationEnabled: true } }) }),
  );
  return { exams, library, moves, folderCreates, folderWrites, state };
}

async function pointerDrag(page: Page, source: Locator, destination: Locator) {
  await source.scrollIntoViewIfNeeded();
  // Let the list settle after any navigation/auto-scroll before measuring.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const from = await source.boundingBox();
  if (!from) throw new Error("Drag controls must have visible bounds");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 15, from.y + from.height / 2 + 3, { steps: 5 });
  // Give dnd-kit one frame to install the drag overlay before tracking the
  // destination; a synthetic pointer can otherwise outrun activation.
  await page.waitForTimeout(60);
  // Re-resolve the destination after activation: starting a drag can
  // auto-scroll a scrollable page, so coordinates cached before mouse.down()
  // go stale. A user tracks the live highlight; the test tracks the live box.
  let to = await destination.boundingBox();
  if (!to) throw new Error("Drop target must have visible bounds");
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 30 });
  // Collision detection settles a frame after the last pointer move. Track
  // any final layout shift, then release on the live target.
  await page.waitForTimeout(80);
  to = await destination.boundingBox();
  if (to) await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
  await page.mouse.up();
}

test("first use: one Exams place, both types, global search, reveal and archive", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("sat-exam-library-type:admin-1", "practice");
    } catch {
      // Storage may be unavailable; the browser must still show both types.
    }
  });
  await installStatefulTransport(page);
  await page.goto("/sat/exams");
  await expect(page.getByRole("heading", { level: 1, name: "Exams" })).toBeVisible({ timeout: 15_000 });

  // One location title; the rejected Library/All/Browse hierarchy is gone.
  await expect(page.getByText("Library", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "All exams" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Browse folders" })).toHaveCount(0);

  // Both creation taxonomies are visible at once despite the retired preference.
  await expect(page.getByText("Root Exam", { exact: true })).toBeVisible();
  await expect(page.getByText("Full-Length Mock 01", { exact: true })).toBeVisible();
  await expect(page.getByText("Custom modules").first()).toBeVisible();
  await expect(page.getByText("Full SAT").first()).toBeVisible();

  // Sections are local: Folders then Exams not in a folder, then collapsed Archived.
  await expect(page.getByRole("heading", { name: "Folders" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Exams not in a folder" })).toBeVisible();
  const archived = page.getByRole("button", { name: /^Archived/ });
  await expect(archived).toBeVisible();
  await expect(page.getByText("Old Root Mock", { exact: true })).toHaveCount(0);
  await archived.click();
  await expect(page.getByText("Old Root Mock", { exact: true })).toBeVisible();
  await archived.click();
  await expect(page.getByText("Old Root Mock", { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/sat-folders-review/final-root-1440.png", fullPage: true });

  const search = page.getByPlaceholder("Search all exams and folders");

  // Search reaches archived exams too: their section opens for the match.
  await search.fill("Archived Mechanics Quiz");
  await expect(page.getByText("Archived Mechanics Quiz", { exact: true })).toBeVisible();
  await expect(page.getByText("In Physics / Mechanics", { exact: true })).toBeVisible();
  await search.fill("");
  await expect(page.getByText("Root Exam", { exact: true })).toBeVisible();

  // Global search from the root finds a filed exam and names its location.
  await search.fill("Filed Exam");
  await expect(page.getByText("Results from all folders for “Filed Exam”.")).toBeVisible();
  await expect(page.getByText("Filed Exam", { exact: true })).toBeVisible();
  await expect(page.getByText("In Physics", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show Filed Exam in folder" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/sat-folders-review/final-search-1440.png", fullPage: true });

  // Show in folder navigates and clears the query.
  await page.getByRole("button", { name: "Show Filed Exam in folder" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Physics" })).toBeVisible();
  await expect(search).toHaveValue("");
  await expect(page.getByText("Filed Exam", { exact: true })).toBeVisible();
  const path = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(path.getByRole("link", { name: "Exams" })).toBeVisible();
  await expect(path).not.toContainText("Physics");

  // Back restores the previous location and query.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Exams" })).toBeVisible();
  await expect(search).toHaveValue("Filed Exam");
  await expect(page.getByText("Filed Exam", { exact: true })).toBeVisible();
  await search.fill("");
  await expect(page.getByText("Root Exam", { exact: true })).toBeVisible();

  // A nested folder has one H1, visible Rename/Move, and its own archive.
  await page.getByRole("link", { name: "Physics", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Physics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "More folder actions" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).not.toContainText("Physics");
  await expect(page.getByText("Archived Physics Exam", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^Archived/ }).click();
  await expect(page.getByText("Archived Physics Exam", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/sat-folders-review/final-nested-1440.png", fullPage: true });

  // Search from inside one folder finds an exam in a deeper folder, with path.
  await search.fill("Mechanics Checkpoint");
  await expect(page.getByText("Mechanics Checkpoint — Forces and Motion", { exact: true })).toBeVisible();
  await expect(page.getByText("In Physics / Mechanics", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Show Mechanics Checkpoint/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mechanics" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Physics");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).not.toContainText("Mechanics");

  await expectNoSeriousAxeViolations(page, "SAT exams first use");
});

test("organizing: create under search, rename/move current folder, sticky selection, move picker and pointer DnD", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { moves, folderWrites } = await installStatefulTransport(page);
  await page.goto("/sat/exams");
  const search = page.getByPlaceholder("Search all exams and folders");
  await expect(page.getByRole("heading", { level: 1, name: "Exams" })).toBeVisible({ timeout: 15_000 });

  // Create a folder while searching: the query clears, the row appears in its
  // real parent, and focus lands on it.
  await search.fill("Physics");
  await page.getByRole("button", { name: "New folder" }).click();
  const create = page.getByRole("dialog", { name: "New folder" });
  await create.getByLabel("Folder name").fill("Winter 2027");
  await create.getByRole("button", { name: "Create folder" }).click();
  await expect(create).toHaveCount(0);
  await expect(search).toHaveValue("");
  const winter = page.getByRole("link", { name: "Winter 2027", exact: true });
  await expect(winter).toBeVisible();
  await expect(winter).toBeFocused();
  await expect(page.locator('[data-revealed="true"]')).toHaveCount(1);

  // Selection replaces the toolbar, stays visible while the root list scrolls,
  // and Escape clears only the focused selection state.
  await page.getByRole("checkbox", { name: "Select Root Exam", exact: true }).check();
  await page.getByRole("checkbox", { name: "Select Full-Length Mock 01", exact: true }).check();
  const selection = page.getByRole("group", { name: "Selection actions" });
  await expect(selection.getByRole("status")).toHaveText("2 selected");
  await expect(selection.getByRole("button", { name: "Delete 2 exams" })).toBeVisible();
  await expect(selection.getByRole("button", { name: "Move to" })).toBeVisible();
  await page.screenshot({ path: "/tmp/sat-folders-review/final-selection-1440.png", fullPage: false });
  await page.evaluate(() => window.scrollTo(0, 800));
  const selectionBox = await selection.boundingBox();
  expect(selectionBox, "selection bar has bounds").not.toBeNull();
  expect(selectionBox!.y).toBeLessThan(40);
  await selection.getByRole("button", { name: "Clear selection" }).focus();
  await page.keyboard.press("Escape");
  await expect(search).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));

  // New subfolder invoked on another folder lands in that parent.
  await search.fill("Physics");
  await page.getByRole("button", { name: "Actions for Physics", exact: true }).click();
  await page.getByRole("menuitem", { name: "New subfolder" }).click();
  const subfolder = page.getByRole("dialog", { name: "New subfolder in Physics" });
  await subfolder.getByLabel("Folder name").fill("Optics");
  await subfolder.getByRole("button", { name: "Create folder" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Physics" })).toBeVisible();
  await expect(search).toHaveValue("");
  const optics = page.getByRole("link", { name: "Optics", exact: true });
  await expect(optics).toBeVisible();
  await expect(optics).toBeFocused();

  // Current-folder Rename is on the surface.
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename Physics" });
  await rename.getByLabel("Folder name").fill("Physics 2026");
  await rename.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(rename).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Physics 2026" })).toBeVisible();

  // Move the current folder into Autumn 2026, then back to Exams.
  await page.getByRole("button", { name: "Move", exact: true }).click();
  const moveFolder = page.getByRole("dialog", { name: "Move Physics 2026 to" });
  await moveFolder.getByRole("button", { name: "Open Autumn 2026" }).click();
  await moveFolder.getByRole("button", { name: "Move here", exact: true }).click();
  await expect(moveFolder).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Autumn 2026");
  await expect(page.getByRole("heading", { level: 1, name: "Physics 2026" })).toBeVisible();

  await page.getByRole("button", { name: "Move", exact: true }).click();
  const moveBack = page.getByRole("dialog", { name: "Move Physics 2026 to" });
  await moveBack.getByRole("button", { name: "Up one level" }).click();
  await moveBack.getByRole("button", { name: "Move here", exact: true }).click();
  await expect(moveBack).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).not.toContainText("Autumn 2026");
  expect(folderWrites.some((write) => write.id === "f-physics" && write.body.parentId === "f-autumn")).toBe(true);
  expect(folderWrites.some((write) => write.id === "f-physics" && write.body.parentId === null)).toBe(true);

  // Move one selected exam through the visible destination browser.
  await page.getByRole("checkbox", { name: "Select Filed Exam", exact: true }).check();
  await page.getByRole("button", { name: "Move to" }).click();
  const move = page.getByRole("dialog", { name: /Move exam to/ });
  await expect(move.getByRole("navigation", { name: "Destination path" })).toContainText("Physics 2026");
  await move.getByRole("button", { name: "Up one level" }).click();
  await move.getByRole("button", { name: "Open Autumn 2026" }).click();
  await expect(move).toHaveCSS("opacity", "1");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/sat-folders-review/final-move-1440.png", fullPage: false });
  await move.getByRole("button", { name: "Move", exact: true }).click();
  await expect.poll(() => moves.length).toBeGreaterThan(0);
  const lastMove = moves[moves.length - 1]!.body;
  expect(lastMove.items[0]!.examId).toBe("sat-filed");
  expect(lastMove.folderId).toBe("f-autumn");

  // Actual pointer DnD: exam row -> visible folder row.
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Exams" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Exams" })).toBeVisible();
  const movesBeforeDrag = moves.length;
  await pointerDrag(page, page.getByRole("button", { name: "Drag Root Exam", exact: true }), page.locator('[data-droppable="folder:f-autumn"]'));
  await expect.poll(() => moves.length).toBe(movesBeforeDrag + 1);
  expect(moves[moves.length - 1]!.body.folderId).toBe("f-autumn");

  // Actual pointer DnD: folder row -> visible ancestor breadcrumb target.
  await page.getByRole("link", { name: "Physics 2026", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Physics 2026" })).toBeVisible();
  const writesBeforeDrag = folderWrites.length;
  await pointerDrag(page, page.getByRole("button", { name: "Drag folder Mechanics", exact: true }), page.locator('[data-droppable="library-root"]'));
  await expect.poll(() => folderWrites.length).toBe(writesBeforeDrag + 1);
  expect(folderWrites[folderWrites.length - 1]).toMatchObject({ id: "f-mech", method: "PATCH", body: { parentId: null } });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Physics 2026" })).toBeVisible();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Exams" }).click();
  await expect(page.getByRole("link", { name: "Mechanics", exact: true })).toBeVisible();
});

test("folder deletion is empty-only, truthful, and keeps a server error visible for retry", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { state } = await installStatefulTransport(page);
  await page.goto("/sat/exams");
  await expect(page.getByRole("heading", { level: 1, name: "Exams" })).toBeVisible({ timeout: 15_000 });

  // Physics holds exams and subfolders: the dialog says so and blocks deletion.
  await page.getByRole("button", { name: "Actions for Physics", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const physics = page.getByRole("alertdialog", { name: "Delete Physics?" });
  await expect(physics).toContainText("This folder still holds");
  await expect(physics).toContainText("exams");
  await expect(physics).toContainText("subfolders");
  await expect(physics.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
  await physics.getByRole("button", { name: "Cancel" }).click();
  await expect(physics).toHaveCount(0);

  // An empty folder fails once; the dialog stays open with the server sentence
  // and the same Delete action retries successfully.
  await page.getByRole("button", { name: "Actions for Scratch", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const empty = page.getByRole("alertdialog", { name: "Delete Scratch?" });
  await expect(empty).toContainText("This folder is empty");
  state.failDeleteOnce = true;
  await empty.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("Folder service unavailable");
  await expect(empty.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
  await empty.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(empty).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Scratch", exact: true })).toHaveCount(0);
});

test("responsive 320..1920: no overflow, visible chevrons, legible meta and five mobile destinations", async ({ page }) => {
  await installStatefulTransport(page);
  await page.goto("/sat/exams");
  await expect(page.getByRole("heading", { level: 1, name: "Exams" })).toBeVisible({ timeout: 15_000 });

  for (const width of [320, 390, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `document overflow at ${width}`).toBeLessThanOrEqual(1);
    const folderRow = page.locator('[data-sat-row-id="folder-f-autumn"]');
    await expect(folderRow.locator(".sat-row-chevron")).toBeVisible();
    const longRow = page.locator('[data-sat-row-id="sat-long"]');
    await expect(longRow.getByText(/Autumn Full-Length Mock 04/)).toBeVisible();
    const rowOverflow = await longRow.evaluate((row) => row.scrollWidth - row.clientWidth);
    expect(rowOverflow, `long-title row overflow at ${width}`).toBeLessThanOrEqual(1);
  }

  // Phone at 390: the full first-use workflow.
  await page.setViewportSize({ width: 390, height: 900 });
  const bottomNav = page.locator('nav.fixed[aria-label="Digital SAT"]');
  await expect(bottomNav.getByRole("link", { name: "Form responses" })).toContainText("Forms");
  await expect(bottomNav.getByRole("link", { name: "Score Conversion" })).toContainText("Scores");
  expect(await bottomNav.evaluate((nav) => nav.scrollWidth - nav.clientWidth)).toBeLessThanOrEqual(1);
  for (const link of await bottomNav.getByRole("link").all()) {
    const box = await link.boundingBox();
    expect(box, "mobile destination has bounds").not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/sat-folders-review/final-root-390.png", fullPage: true });

  const search = page.getByPlaceholder("Search all exams and folders");
  await search.fill("Filed Exam");
  await expect(page.getByText("Filed Exam", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/sat-folders-review/final-search-390.png", fullPage: true });
  await search.fill("");
  await page.getByRole("checkbox", { name: "Select Root Exam", exact: true }).check();
  const selection = page.getByRole("group", { name: "Selection actions" });
  await expect(selection.getByRole("status")).toHaveText("1 selected");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/sat-folders-review/final-selection-390.png", fullPage: true });
  await page.getByRole("button", { name: "Move to" }).click();
  const move = page.getByRole("dialog", { name: /Move exam to/ });
  await expect(move).toBeVisible();
  await expect(move).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "/tmp/sat-folders-review/final-move-390.png", fullPage: false });
  await move.getByRole("button", { name: "Cancel" }).click();
  await expect(selection).toBeVisible();
  await selection.getByRole("button", { name: "Clear selection" }).click();

  // Nested phone view: actions wrap, chevrons stay visible, no overflow.
  await page.getByRole("link", { name: "Physics", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Physics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Move", exact: true })).toBeVisible();
  await expect(page.locator('[data-sat-row-id="folder-f-mech"] .sat-row-chevron')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/sat-folders-review/final-nested-390.png", fullPage: true });
  await expectNoSeriousAxeViolations(page, "SAT exams nested phone");

  // 320 edge: root controls wrap but stay operable at 44px, nothing clips,
  // every destination keeps its route and full accessible name.
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Exams" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Exams" })).toBeVisible();
  const toolbar = page.getByRole("group", { name: "Exams controls" });
  const sortControl = toolbar.getByLabel("Sort");
  const newFolder = toolbar.getByRole("button", { name: "New folder" });
  await expect(toolbar.getByPlaceholder("Search all exams and folders")).toBeVisible();
  await expect(sortControl).toBeVisible();
  await expect(newFolder).toBeVisible();
  for (const control of [search, sortControl, newFolder]) {
    const box = await control.boundingBox();
    expect(box, "320 toolbar control has bounds").not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await toolbar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(await bottomNav.evaluate((nav) => nav.scrollWidth - nav.clientWidth)).toBeLessThanOrEqual(1);
  for (const link of await bottomNav.getByRole("link").all()) {
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  for (const [name, href] of [
    ["Exams", "/sat/exams"],
    ["Rooms", "/sat/sessions"],
    ["Responses", "/sat/results"],
    ["Form responses", "/sat/forms"],
    ["Score Conversion", "/sat/score-conversion"],
  ] as const) {
    await expect(bottomNav.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "/tmp/sat-folders-review/final-root-320.png", fullPage: true });
});

test("delayed folder data cannot open creation in the wrong location", async ({ page }) => {
  let release!: () => void;
  const holdLibrary = new Promise<void>((resolve) => { release = resolve; });
  await installStatefulTransport(page, { holdLibrary });
  await page.goto("/sat/exams?folder=f-physics");
  await expect(page.getByRole("heading", { level: 1, name: "Exams" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Create exam" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "New folder" })).toBeDisabled();
  await expect(page.getByText("Filed Exam", { exact: true })).toHaveCount(0);
  release();
  await expect(page.getByRole("heading", { level: 1, name: "Physics" })).toBeVisible();
  await expect(page.getByText("Filed Exam", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create exam" })).toBeEnabled();
});

test("SAT exams fail-closed: library 500 never shows filed exams as unfiled", async ({ page }) => {
  const fault = { failLibrary: true };
  await installStatefulTransport(page, fault);
  await page.goto("/sat/exams");
  await expect(page.getByRole("heading", { level: 1, name: "Exams" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Filed Exam", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeVisible();
  const retry = page.getByRole("button", { name: /Retry/ }).first();
  await expect(retry).toBeVisible();
  fault.failLibrary = false;
  await retry.click();
  await expect(page.getByText("Root Exam", { exact: true })).toBeVisible();
  await expect(page.getByText("Filed Exam", { exact: true })).toHaveCount(0);
});
