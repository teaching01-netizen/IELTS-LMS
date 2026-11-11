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

// Stateful transport tests reload/navigation behavior; Go tests verify database persistence.
function baseExams() {
  return [
    {
      id: "sat-root", slug: "sat-root", title: "Root Exam", providerKey: "sat", examType: "Academic",
      status: "draft", visibility: "organization", organizationId: "org-1", ownerId: "admin-1",
      createdAt: "2026-08-29T00:00:00Z", updatedAt: "2026-08-30T00:00:00Z",
      currentDraftVersionId: "draft-1", currentPublishedVersionId: null, satCustomModules: true,
      canEdit: true, canPublish: true, canDelete: true, schemaVersion: 4, revision: 0,
    },
    {
      id: "sat-filed", slug: "sat-filed", title: "Filed Exam", providerKey: "sat", examType: "Academic",
      status: "draft", visibility: "organization", organizationId: "org-1", ownerId: "admin-1",
      createdAt: "2026-08-29T00:00:00Z", updatedAt: "2026-08-30T00:00:00Z",
      currentDraftVersionId: "draft-2", currentPublishedVersionId: null, satCustomModules: true,
      canEdit: true, canPublish: true, canDelete: true, schemaVersion: 4, revision: 0,
    },
    {
      id: "sat-other", slug: "sat-other", title: "Other Org Exam", providerKey: "sat", examType: "Academic",
      status: "draft", visibility: "organization", organizationId: "org-2", ownerId: "admin-1",
      createdAt: "2026-08-29T00:00:00Z", updatedAt: "2026-08-30T00:00:00Z",
      currentDraftVersionId: "draft-3", currentPublishedVersionId: null, satCustomModules: true,
      canEdit: true, canPublish: true, canDelete: true, schemaVersion: 4, revision: 0,
    },
  ];
}

function baseLibrary() {
  return {
    folders: [
      { id: "f-phys", scopeKey: "sat|org-1", providerKey: "sat", organizationId: "org-1", parentId: null, name: "Physics", revision: 0, createdBy: "admin-1", createdAt: "2026-08-29T00:00:00Z", updatedAt: "2026-08-30T00:00:00Z" },
      { id: "f-mech", scopeKey: "sat|org-1", providerKey: "sat", organizationId: "org-1", parentId: "f-phys", name: "Mechanics", revision: 0, createdBy: "admin-1", createdAt: "2026-08-29T00:00:00Z", updatedAt: "2026-08-30T00:00:00Z" },
      { id: "f-other", scopeKey: "sat|org-2", providerKey: "sat", organizationId: "org-2", parentId: null, name: "Other Org", revision: 0, createdBy: "admin-1", createdAt: "2026-08-29T00:00:00Z", updatedAt: "2026-08-30T00:00:00Z" },
    ],
    entries: [{ examId: "sat-filed", folderId: "f-phys", revision: 1 }],
  };
}

async function installStatefulTransport(page: Page, opts: { failLibrary?: boolean; delayLibraryMs?: number; holdLibrary?: Promise<void> } = {}) {
  const exams = baseExams();
  const library = baseLibrary();
  const moves: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const folderCreates: Array<{ body: unknown; idempotencyKey: string | null }> = [];
  const folderWrites: Array<{ id: string; method: string; body: Record<string, unknown> }> = [];
  const receipts = new Map<string, { fingerprint: string; folder: ReturnType<typeof baseLibrary>['folders'][number] }>();
  ;(page as unknown as { __moves?: unknown }).__moves = moves;
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
    moves.push({ url: route.request().url(), body, headers: route.request().headers() });
    // Apply statefully: update entries revisions.
    for (const item of body.items ?? []) {
      const existing = library.entries.find((e) => e.examId === item.examId);
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
    const out = library.entries.filter((e) => (body.items ?? []).some((i) => i.examId === e.examId));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { entries: out } }) });
  });
  await page.route("**/api/v1/exam-library/folders", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { name: string; parentId?: string | null; contextExamId?: string | null };
      const key = await route.request().headerValue("idempotency-key");
      folderCreates.push({ body, idempotencyKey: key });
      if (!key) {
        return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "VALIDATION", message: "Idempotency-Key is required." } }) });
      }
      const fingerprint = JSON.stringify(body);
      const replay = receipts.get(key);
      if (replay) {
        return route.fulfill({ status: replay.fingerprint === fingerprint ? 201 : 409, contentType: 'application/json', body: JSON.stringify({ success: true, data: replay.folder }) });
      }
      const org = library.folders.find(f => f.id === body.parentId)?.organizationId
        ?? exams.find(e => e.id === body.contextExamId)?.organizationId ?? '';
      if (library.folders.some(f => f.organizationId === org && (f.parentId ?? null) === (body.parentId ?? null) && f.name.toLowerCase() === body.name.trim().toLowerCase())) {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'CONFLICT', message: 'A folder with this name already exists here.' } }) });
      }
      const id = `f-new-${folderCreates.length}`;
      const parentId = body.parentId ?? null;
      // Root scope follows the actor; nested/context creation derives its scope.
      const folder = { id, scopeKey: `sat|${org}`, providerKey: "sat", organizationId: org, parentId, name: body.name.trim(), revision: 0, createdBy: "admin-1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      library.folders.push(folder);
      receipts.set(key, { fingerprint, folder: { ...folder } });
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ success: true, data: folder }) });
    }
    return route.fallback();
  });
  await page.route('**/api/v1/exam-library/folders/*', async route => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    const folder = library.folders.find(f => f.id === id);
    if (!folder) return route.fulfill({ status: 404, json: { success: false, error: { code: 'NOT_FOUND', message: 'Folder not found.' } } });
    const method = route.request().method();
    const body = method === 'PATCH' ? route.request().postDataJSON() : { revision: Number(new URL(route.request().url()).searchParams.get('revision')) };
    folderWrites.push({ id, method, body });
    if (body.revision !== folder.revision) return route.fulfill({ status: 409, json: { success: false, error: { code: 'CONFLICT', message: 'Folder changed; retry.' } } });
    if (method === 'PATCH') {
      if ('name' in body) folder.name = body.name;
      if ('parentId' in body) folder.parentId = body.parentId;
      folder.revision++;
      return route.fulfill({ status: 200, json: { success: true, data: folder } });
    }
    if (method === 'DELETE') {
      if (library.folders.some(f => f.parentId === id) || library.entries.some(e => e.folderId === id)) {
        return route.fulfill({ status: 409, json: { success: false, error: { code: 'CONFLICT', message: 'Folder is not empty. Move its contents to the Library first.' } } });
      }
      library.folders.splice(library.folders.indexOf(folder), 1);
      return route.fulfill({ status: 200, json: { success: true, data: { ok: true } } });
    }
    return route.fallback();
  });
  await page.route("**/api/v1/exam-library*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    if (opts.failLibrary) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, error: { code: "INTERNAL_ERROR", message: "Folder service unavailable" } }) });
    }
    if (opts.holdLibrary) await opts.holdLibrary;
    if (opts.delayLibraryMs) await new Promise((r) => setTimeout(r, opts.delayLibraryMs));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: library }) });
  });
  await page.route("**/api/v1/sat/exam-config/defaults", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { preset: "standard_sat", config: {}, limits: {}, classroomCreationEnabled: true } }) }),
  );
  return { exams, library, moves, folderCreates, folderWrites };
}

async function showFolderTree(page: Page) {
  const toggle = page.getByRole('button', { name: 'Browse folders', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('navigation', { name: 'Folders' })).toBeVisible();
}

async function pointerDrag(page: Page, source: Locator, destination: Locator) {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  if (!from) throw new Error('Drag controls must have visible bounds');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 15, from.y + from.height / 2 + 3, { steps: 5 });
  // Re-resolve the destination after activation: starting a drag can
  // auto-scroll a scrollable page, so coordinates cached before mouse.down()
  // go stale. A user tracks the live highlight; the test tracks the live box.
  const to = await destination.boundingBox();
  if (!to) throw new Error('Drop target must have visible bounds');
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 30 });
  await page.mouse.up();
}

test("SAT library folders: stateful CRUD, pointer physics, fail-closed library, axe", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { moves, folderWrites } = await installStatefulTransport(page);
  await page.goto("/sat/exams");
  await expect(page.getByRole("heading", { name: "Exams" })).toBeVisible({ timeout: 15_000 });

  // Library root shows unfiled exams + child folders.
  await expect(page.getByText("Root Exam")).toBeVisible();
  await expect(page.getByRole("link", { name: "Physics" }).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Library");

  // Row menu click opens (not just visible) and has a visible icon.
  const menuButton = page.getByRole("button", { name: "Actions for Root Exam", exact: true });
  await expect(menuButton).toBeVisible();
  await expect(menuButton.locator("svg")).toBeVisible();
  await menuButton.click({ timeout: 5000 });
  await expect(page.getByRole("menuitem", { name: "Move to" }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // Tree button opens the folder; Back returns to the Library root.
  await showFolderTree(page);
  await page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: "Physics", exact: true }).click();
  await expect(page.getByText("Filed Exam")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Physics");
  await page.goBack();
  await expect(page.getByText("Root Exam")).toBeVisible();

  // Drag handles are real buttons with pointer-events auto.
  const dragHandle = page.getByRole("button", { name: "Drag Root Exam" });
  await expect(dragHandle).toBeVisible();
  const pointerEvents = await dragHandle.evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(pointerEvents).not.toBe("none");

  // Exam-to-folder pointer drag: Root Exam -> Physics, assert payload + reloaded UI.
  // Tree and content targets have distinct IDs; both resolve to the same folder.
  const target = page.getByRole("list", { name: "Subfolders" }).locator('[data-droppable="folder:f-phys"]');
  await expect(target).toBeVisible();
  await pointerDrag(page, dragHandle, target);
  await expect.poll(() => moves.length, { timeout: 5000 }).toBeGreaterThan(0);
  const lastMove = moves[moves.length - 1]!.body as { items: Array<{ examId: string }>; folderId: string | null };
  expect(lastMove.items[0]!.examId).toBe("sat-root");
  expect(lastMove.folderId).toBe("f-phys");
  // Destination UI reflects the move after reload (stateful transport).
  // Root Exam left the Library root, so root no longer lists it.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Exams" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Root Exam")).toHaveCount(0);
  await showFolderTree(page);
  await page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: "Physics", exact: true }).click();
  await expect(page.getByText("Root Exam")).toBeVisible({ timeout: 15_000 });

  // Folder-to-folder pointer drag: Mechanics -> Library root.
  await showFolderTree(page);
  await page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: "Physics", exact: true }).click();
  await expect(page.getByText("Filed Exam")).toBeVisible();
  const folderHandle = page.getByRole('button', { name: 'Drag folder Mechanics', exact: true });
  await showFolderTree(page);
  await pointerDrag(page, folderHandle, page.locator('[data-droppable="library-root"]'));
  await expect.poll(() => folderWrites.length).toBe(1);
  expect(folderWrites[0]).toMatchObject({ id: 'f-mech', method: 'PATCH', body: { parentId: null } });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Physics', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Subfolders' })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await showFolderTree(page);
  await pointerDrag(page, page.getByRole('button', { name: 'Drag folder Mechanics', exact: true }), page.locator('[data-droppable="tree-folder:f-phys"]'));
  await expect.poll(() => folderWrites.length).toBe(2);
  expect(folderWrites[1]).toMatchObject({ id: 'f-mech', body: { parentId: 'f-phys' } });
  await page.reload();
  await showFolderTree(page);
  await page.getByRole('navigation', { name: 'Folders' }).getByRole('link', { name: 'Physics', exact: true }).click();
  // Return to Library to exercise folder-name validation.
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Library" }).click();
  await expect(page.getByText("Root Exam")).toHaveCount(0);
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Folder name").fill("a/b");
  await dialog.getByRole("button", { name: "Create folder" }).click();
  await expect(dialog.getByText('Folder name cannot contain "/" or "\\".')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // Move-to dialog offers compatible targets and actually moves.
  // Root Exam already moved to Physics; use Physics contents for the dialog move.
  await showFolderTree(page);
  await page.getByRole("navigation", { name: "Folders" }).getByRole("link", { name: "Physics", exact: true }).click();
  await expect(page.getByText("Filed Exam")).toBeVisible();
  await page.getByRole("checkbox", { name: "Select Filed Exam" }).check();
  await page.getByRole("button", { name: "Move to" }).click();
  const move = page.getByRole("dialog", { name: /Move exam to/ });
  await expect(move).toBeVisible();
  // Drive-style browser: starts in the common current folder (Physics).
  await expect(move.getByRole("navigation", { name: "Destination path" })).toContainText("Physics");
  // Drill up: another org's folder is never offered for an org-1 selection.
  await move.getByRole("button", { name: "Up one level" }).click();
  await expect(move.getByRole("navigation", { name: "Destination path" })).toContainText("Library");
  await expect(move.getByRole("button", { name: /Open Other Org/ })).toHaveCount(0);
  await move.getByRole("button", { name: /Open Physics/ }).click();
  await move.getByRole("button", { name: /Open Mechanics/ }).click();
  await move.getByRole("button", { name: "Move", exact: true }).click();
  await expect.poll(() => moves.length, { timeout: 5000 }).toBeGreaterThan(1);


  // Mobile: no horizontal overflow, menu icon still visible.
  await page.setViewportSize({ width: 390, height: 950 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: /Actions for Root Exam/ }).first()).toBeVisible();

  await expectNoSeriousAxeViolations(page, "sat-library-folders");
});

test("SAT library fail-closed: library 500 never shows filed exams as unfiled", async ({ page }) => {
  const fault = { failLibrary: true };
  await installStatefulTransport(page, fault);
  await page.goto("/sat/exams");
  await expect(page.getByRole("heading", { name: "Exams" })).toBeVisible({ timeout: 15_000 });
  // Library error is shown with Retry; filed exam must not appear as unfiled root.
  await expect(page.getByText("Filed Exam", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeVisible();
  const retry = page.getByRole("button", { name: /Retry/ }).first();
  await expect(retry).toBeVisible();
  fault.failLibrary = false;
  await retry.click();
  await expect(page.getByText('Root Exam', { exact: true })).toBeVisible();
  await expect(page.getByText('Filed Exam', { exact: true })).toHaveCount(0);
});


test('nested folders can be created, renamed, moved, deleted and reopened after reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { folderCreates, folderWrites } = await installStatefulTransport(page);
  await page.goto('/sat/exams');
  await expect(page.getByText('Root Exam', { exact: true })).toBeVisible();
  const create = async (name: string, parent?: string) => {
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: parent ? `New subfolder in ${parent}` : 'New folder', exact: true });
    await dialog.getByLabel('Folder name').fill(name);
    await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Subfolders' }).getByText(name, { exact: true })).toBeVisible();
  };
  await create('Autumn');
  await page.getByRole('button', { name: 'Actions for Autumn', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename Autumn', exact: true });
  await rename.getByLabel('Folder name').fill('Autumn 2026');
  await rename.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(rename).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('list', { name: 'Subfolders' }).getByText('Autumn 2026', { exact: true })).toBeVisible();
  await create('Autumn');
  expect(folderCreates).toHaveLength(2);
  expect(folderCreates[0]!.idempotencyKey).toBeTruthy();
  expect(folderCreates[1]!.idempotencyKey).not.toBe(folderCreates[0]!.idempotencyKey);
  await showFolderTree(page);
  await page.getByRole('navigation', { name: 'Folders' }).getByRole('link', { name: 'Autumn 2026', exact: true }).click();
  await create('Week 1', 'Autumn 2026');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Autumn 2026', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Week 1', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move to', exact: true }).click();
  const move = page.getByRole('dialog', { name: 'Move Week 1 to', exact: true });
  // Same-parent confirm stays disabled until the destination actually changes.
  await expect(move.getByRole('button', { name: 'Already here' })).toBeDisabled();
  await move.getByRole('button', { name: 'Up one level' }).click();
  await expect(move.getByRole('navigation', { name: 'Destination path' })).toContainText('Library');
  await move.getByRole('button', { name: 'Move here', exact: true }).click();
  await expect(move).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Subfolders' }).getByText('Week 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Week 1', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const remove = page.getByRole('alertdialog', { name: 'Delete Week 1?', exact: true });
  await remove.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(remove).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Root Exam', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Subfolders' }).getByText('Week 1', { exact: true })).toHaveCount(0);
  expect(folderWrites.map(write => write.method)).toEqual(['PATCH', 'PATCH', 'DELETE']);
});

test('dragging a selection moves the entire visible batch to a sidebar folder', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { moves } = await installStatefulTransport(page);
  await page.goto('/sat/exams?folder=all');
  await expect(page.getByText('Root Exam', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select Root Exam', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Select Filed Exam', exact: true }).check();
  await showFolderTree(page);
  await pointerDrag(page, page.getByRole('button', { name: 'Drag Root Exam', exact: true }), page.locator('[data-droppable="tree-folder:f-mech"]'));
  await expect.poll(() => moves.length).toBe(1);
  const body = moves[0]!.body as { folderId: string; items: Array<{ examId: string }> };
  expect(body.folderId).toBe('f-mech');
  expect(body.items.map(item => item.examId).sort()).toEqual(['sat-filed', 'sat-root']);
  await page.reload();
  await showFolderTree(page);
  await page.getByRole('navigation', { name: 'Folders' }).getByRole('link', { name: 'Mechanics', exact: true }).click();
  await expect(page.getByText('Root Exam', { exact: true })).toBeVisible();
  await expect(page.getByText('Filed Exam', { exact: true })).toBeVisible();
});


test('library browser: Up, current-folder menu, right-click, create-then-move', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { moves, folderCreates } = await installStatefulTransport(page);
  await page.goto('/sat/exams');
  await expect(page.getByText('Root Exam', { exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Browse folders' })).toHaveAttribute('aria-expanded', 'false');

  // Folders render as rows in the same grouped surface as the exam rows.
  const subfolders = page.getByRole('list', { name: 'Subfolders' });
  await expect(subfolders.getByRole('link', { name: 'Physics' })).toBeVisible();

  // Drill in, then Up one level returns to Library with the search cleared.
  await page.getByPlaceholder('Search exams').fill('Filed');
  // A folder search filters the row list, so navigate through the tree.
  await showFolderTree(page);
  await page.getByRole('navigation', { name: 'Folders' }).getByRole('link', { name: 'Physics' }).click();
  await expect(page.getByRole('heading', { name: 'Physics', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Search exams')).toHaveValue('');
  await page.getByRole('button', { name: 'Up one level' }).click();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();

  // Current-folder menu creates a subfolder without leaving the folder.
  await subfolders.getByRole('link', { name: 'Physics' }).click();
  await page.getByRole('button', { name: 'Actions for current folder' }).click();
  await page.getByRole('menuitem', { name: 'New subfolder' }).click();
  const create = page.getByRole('dialog', { name: 'New subfolder in Physics' });
  await create.getByLabel('Folder name').fill('Week 9');
  await create.getByRole('button', { name: 'Create folder' }).click();
  await expect(subfolders.getByText('Week 9', { exact: true })).toBeVisible();

  // Right-clicking an exam row offers the same Move action as the row menu.
  // The stretched row link sits above the title text, so the row link is
  // what receives the press — exactly as for a staff member's pointer.
  const filedLink = page.getByRole('link', { name: 'Edit Filed Exam' });
  const filedActions = page.getByRole('button', { name: 'Actions for Filed Exam', exact: true });
  await filedLink.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Move to' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(filedActions).toBeFocused();
  await filedLink.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to' }).click();
  await page.getByRole('dialog', { name: /Move exam to/ }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: /Move exam to/ })).toHaveCount(0);
  await expect(filedActions).toBeFocused();
  await page.setViewportSize({ width: 390, height: 1000 });
  const headingLines = await page.getByRole('heading', { name: 'Physics', exact: true }).evaluate((heading) => heading.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(heading).lineHeight));
  expect(headingLines, 'a short folder name stays readable on a phone').toBeLessThanOrEqual(1.5);
  await page.screenshot({ path: '/tmp/sat-folders-review/nested-folder-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await filedLink.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to' }).click();
  const move = page.getByRole('dialog', { name: /Move exam to/ });
  await expect(move.getByRole('navigation', { name: 'Destination path' })).toContainText('Physics');

  // New folder here creates and selects without moving; Move confirms after.
  await move.getByRole('button', { name: 'New folder here' }).click();
  await move.getByLabel('New folder name').fill('Catch-up');
  await move.getByRole('button', { name: 'Create folder' }).click();
  await expect(move.getByRole('navigation', { name: 'Destination path' })).toContainText('Catch-up');
  expect(moves).toHaveLength(0);
  await page.screenshot({ path: '/tmp/sat-folders-review/move-picker-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(move.getByRole('button', { name: 'Move', exact: true })).toBeVisible();
  await expectNoSeriousAxeViolations(page, 'SAT destination picker');
  await page.screenshot({ path: '/tmp/sat-folders-review/move-picker-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect.poll(() => moves.length).toBe(1);
  await expect(page.getByRole('heading', { name: 'Physics', exact: true })).toBeFocused();
  const created = folderCreates[folderCreates.length - 1]!.body as { name: string };
  expect(created.name).toBe('Catch-up');
  expect((moves[0]!.body as { folderId: string }).folderId).toBeTruthy();

  // Right-clicking a folder row opens it through the same Open action.
  await subfolders.getByRole('link', { name: 'Week 9', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Week 9', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Up one level' }).click();
  await expect(page.getByRole('heading', { name: 'Physics', exact: true })).toBeVisible();
});

test('compact rows keep titles and editing accessible without overlapping controls', async ({ page }) => {
  await installStatefulTransport(page);
  const longExam = { ...baseExams()[0]!, id: 'sat-long', slug: 'sat-long', title: 'Autumn Full-Length Mock 04 — Reading & Writing and Mathematics with Adaptive Modules and Extended Time', satCustomModules: true };
  const exams = [...baseExams().map(exam => exam.id === 'sat-root' ? { ...exam, status: 'published', currentPublishedVersionId: 'sealed-1' } : exam), longExam];
  await page.route('**/api/v1/exams*', route => route.fulfill({ status: 200, json: { success: true, data: exams } }));
  await page.goto('/sat/exams');
  await expect(page.getByText('Root Exam', { exact: true })).toBeVisible();
  // A realistic long title stays readable: it wraps instead of clipping.
  await expect(page.getByText(longExam.title)).toBeVisible();
  for (const width of [320, 390, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bounds = await page.locator('[data-sat-row-id="sat-root"]').evaluate(row => {
      const title = Array.from(row.querySelectorAll('span')).find(node => node.textContent === 'Root Exam')!;
      const checkbox = row.querySelector('input[type="checkbox"]')!.getBoundingClientRect();
      const drag = row.querySelector('[data-drag-handle]')!.getBoundingClientRect();
      return { title: title.getBoundingClientRect().width, overlap: Math.min(checkbox.right, drag.right) > Math.max(checkbox.left, drag.left) && Math.min(checkbox.bottom, drag.bottom) > Math.max(checkbox.top, drag.top), overflow: document.documentElement.scrollWidth - innerWidth };
    });
    expect(bounds.overflow, `overflow at ${width}`).toBeLessThanOrEqual(1);
    expect(bounds.title, `title width at ${width}`).toBeGreaterThanOrEqual(90);
    expect(bounds.overlap, `checkbox and drag overlap at ${width}`).toBe(false);
    await page.getByRole('button', { name: 'Actions for Root Exam', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Edit exam', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    if ([320, 390, 1024, 1440].includes(width)) await page.screenshot({ path: `/tmp/sat-folders-review/after-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(page.getByRole('navigation', { name: 'Folders' })).toBeHidden();
  await page.getByRole('button', { name: 'Browse folders', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Folders' })).toBeVisible();
  await showFolderTree(page);
  await page.getByRole('navigation', { name: 'Folders' }).getByRole('link', { name: 'Physics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Physics', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Folders' })).toBeHidden();
  await expectNoSeriousAxeViolations(page, 'SAT folders mobile');
});

test('delayed folder data cannot open creation in the wrong location', async ({ page }) => {
  let release!: () => void;
  const holdLibrary = new Promise<void>(resolve => { release = resolve; });
  await installStatefulTransport(page, { holdLibrary });
  await page.goto('/sat/exams?folder=f-phys');
  await expect(page.getByRole('heading', { name: 'Exams', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create exam', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New exam', exact: true })).toHaveCount(0);
  await expect(page.getByText('Filed Exam', { exact: true })).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: 'Physics', exact: true })).toBeVisible();
  await expect(page.getByText('Filed Exam', { exact: true })).toBeVisible();
});
