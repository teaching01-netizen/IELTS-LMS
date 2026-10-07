import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";
import { createRunningSatSession } from "./support/satStudentSession";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

/**
 * SAT module entry: the first answer must ride the ack's control epoch.
 *
 * Contract pinned here (client-side adoption, no server change):
 * `modules/.../start` bumps `student_attempts.control_epoch` inside the same
 * transaction that activates the module and then answers with the POST-commit
 * epoch. The client drops that value when it merges the ack into the bootstrap
 * payload, so before this fix the first `responses:batch` after entry was
 * refused 409 CONTROL_EPOCH_STALE and the engine had to spend a heal round trip
 * (snapshot fetch + re-issue under a new writeId/version) to deliver a keystroke
 * the student made seconds after the module appeared.
 *
 * The pin is deliberately about the wire, not about internals: it compares the
 * epoch printed on the entry ack with the epoch on the first response batch, and
 * requires that no batch is refused with CONTROL_EPOCH_STALE. A server that
 * stops bumping on entry (or a client that stops reporting it) fails here rather
 * than silently passing.
 *
 * Honesty notes:
 * - The engine's adoption is an optimization with a fallback: when any guard
 *   refuses (work already outstanding, pre-recovery, conflict posture) the old
 *   refuse-then-heal path is still correct. This spec therefore pins "the epoch
 *   travelled", never "no heal happened for some other reason".
 * - The answer is typed as soon as the exam shell paints (the field is present
 *   the moment the module renders), which is the window the fix exists for.
 */

interface BatchSample {
  controlEpoch: number;
  writeIds: string[];
}

async function waitForExamShell(page: Page): Promise<void> {
  await expect(page.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
}

test.describe("SAT entry control-epoch adoption", () => {
  test.describe.configure({ timeout: 300_000 });

  test("the first batch after module entry carries the ack's control epoch", async ({
    page,
    browser,
  }) => {
    // Leave the runtime unstarted so the module-entry traffic (and therefore
    // the start ack) happens while this test is already listening.
    const { studentContext, studentPage, scheduleId, examTitle, linkName } =
      await createRunningSatSession(browser, page, {
        label: "entry-epoch",
        startRuntime: false,
      });

    const batches: BatchSample[] = [];
    const batchStatuses: number[] = [];
    let entryAckEpoch: number | null = null;

    // Click on the first answerable frame inside the browser, so Playwright's
    // command latency cannot turn the one-second entry window into a false
    // failure (or conceal a slow render). The controller emits module advance
    // before React paints that frame.
    await studentPage.addInitScript(() => {
      const timing: { openedAt: number | null; answeredAt: number | null } = {
        openedAt: null,
        answeredAt: null,
      };
      Object.defineProperty(window, "__satFirstAnswerTiming", { value: timing });
      window.addEventListener("student-observability-metric", (event) => {
        if ((event as CustomEvent).detail?.name === "sat_module_advance") {
          timing.openedAt = performance.now();
        }
      });
      document.addEventListener("DOMContentLoaded", () => {
        const answer = () => {
          if (timing.openedAt === null || timing.answeredAt !== null) return;
          const shell = document.querySelector('[data-testid="sat-exam-shell"]');
          const inputs = shell?.querySelectorAll<HTMLInputElement>('input[type="radio"]');
          const input = Array.from(inputs ?? []).find(
            (candidate) => !candidate.disabled && candidate.getClientRects().length > 0
          );
          const label = input?.labels?.[0];
          if (!label) return;
          timing.answeredAt = performance.now();
          label.click();
        };
        new MutationObserver(answer).observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
        });
        answer();
      });
    });

    studentPage.on("request", (request) => {
      if (!request.url().includes("/responses:batch")) return;
      try {
        const body = request.postDataJSON() as {
          controlEpoch?: number;
          commands?: Array<{ writeId?: string }>;
        } | null;
        batches.push({
          controlEpoch: Number(body?.controlEpoch ?? -1),
          writeIds: (body?.commands ?? []).map((command) => String(command.writeId ?? "")),
        });
      } catch {
        // Non-JSON batch bodies are not part of this pin.
      }
    });
    studentPage.on("response", (response) => {
      const url = response.url();
      if (url.includes("/responses:batch")) {
        batchStatuses.push(response.status());
        return;
      }
      // The compact entry ack: the authoritative post-commit epoch.
      if (!url.includes("/modules/") || !url.includes("start")) return;
      void response
        .json()
        .then((body: unknown) => {
          const epoch = (body as { controlEpoch?: unknown } | null)?.controlEpoch;
          if (typeof epoch === "number") entryAckEpoch = epoch;
        })
        .catch(() => undefined);
    });

    try {
      await page.goto("/sat/sessions");
      const sessionRow = page
        .locator("button")
        .filter({ hasText: examTitle })
        .filter({ hasText: linkName })
        .first();
      await expect(sessionRow).toBeVisible({ timeout: 30_000 });
      await sessionRow.click();
      await expect(page).toHaveURL(new RegExp(`/sat/sessions/${scheduleId}$`));
      await page.getByRole("button", { name: "Start", exact: true }).click();

      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await waitForExamShell(studentPage);

      // The browser answered as soon as the first radio control was usable.
      await expect
        .poll(
          () =>
            studentPage.evaluate(
              () =>
                (
                  window as Window & {
                    __satFirstAnswerTiming?: { openedAt: number | null; answeredAt: number | null };
                  }
                ).__satFirstAnswerTiming?.answeredAt ?? null
            ),
          { timeout: 30_000 }
        )
        .not.toBeNull();
      const finalTiming = await studentPage.evaluate(
        () =>
          (
            window as Window & {
              __satFirstAnswerTiming?: { openedAt: number | null; answeredAt: number | null };
            }
          ).__satFirstAnswerTiming
      );
      expect(finalTiming?.openedAt).not.toBeNull();
      expect(finalTiming?.answeredAt).not.toBeNull();
      expect(
        (finalTiming?.answeredAt ?? Infinity) - (finalTiming?.openedAt ?? 0)
      ).toBeLessThanOrEqual(1000);
      await expect(studentPage.getByTestId("sat-exam-shell")).toHaveAttribute(
        "data-sat-save-state",
        "idle",
        { timeout: 30_000 }
      );

      // The epoch the server handed out on entry must be what the first batch
      // carried — no first-batch 409, no heal round trip to get there.
      await expect.poll(() => entryAckEpoch, { timeout: 30_000 }).not.toBeNull();
      await expect.poll(() => batches.length, { timeout: 30_000 }).toBeGreaterThan(0);
      await expect.poll(() => batchStatuses.length, { timeout: 30_000 }).toBeGreaterThan(0);
      expect(batches[0]?.controlEpoch).toBe(entryAckEpoch);
      expect(batchStatuses[0]).toBe(200);
      expect(batchStatuses).not.toContain(409);
    } finally {
      await studentContext.close();
    }
  });
});
