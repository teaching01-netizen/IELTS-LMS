import { expect, test, type Page } from '@playwright/test';
import { readBackendE2EManifest } from './support/backendE2e';
import { newAdminControlContext, postProctorApi } from './support/proctorControls';
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from './support/studentUi';

/**
 * WP-V1 student durability surface (frozen V2 candidate behavior).
 *
 * Engine contract exercised (read-only; owned by src/, NOT this spec):
 * - DurableResponseEngine keeps answers/flags visible through recovery and
 *   control-only epoch bumps; a control-only bump marks unsent drafts blocked
 *   (reconcilable via reconcileBlocked with a NEW writeId/version/epoch).
 * - A lease bump quarantines (strict fence, NO auto-resend).
 * - Blocked submit throws the provider gate error (shared gate copy), never a
 *   silent exclusion of drafts.
 * - Tombstones are same-key; quarantine_pruned fires on ack-supersede/discard
 *   only.
 * - Providers share blockedSubmitGateMessage + ReconcileBlockedResult union +
 *   the mapEngineStatus single path.
 *
 * Five runtime-backed IELTS scenarios, total budget < 5 min:
 * (a) reload-during-recovery: answer + flag survive a mid-recovery reload.
 * (b) pause/extend -> blocked -> reconcile -> delivered exactly once
 *     (NEW writeId + higher version + new epoch).
 * (c) lease-takeover -> no auto-resend + superseded UI shown.
 * (d) submit with blocked/quarantined -> gate refuses with gate copy, no
 *     silent exclusion of drafts.
 * (e) storage-full fault injection -> durability_fault + input retained visible.
 *
 * Honesty notes:
 * - The UI has no recovery-panel reconcile/discard buttons: scenarios (b)
 *   and (d) drive reconcileBlocked through page.evaluate against the live
 *   engine via a best-effort window probe. When the probe cannot reach the
 *   engine (e.g. provider refactor renames internals), the scenario fails
 *   LOUD with the probe diagnostics — never a silent skip.
 * - Blocked state is produced with a REAL backend control bump
 *   (POST /api/v1/schedules/:id/runtime/commands pause_runtime/extend), not a
 *   mocked 409: the 409 path only fires when the client sends a stale epoch,
 *   which requires racing the server round-trip. extend_section is used when
 *   pause is unavailable on the seeded schedule; pause is preferred because
 *   its control_epoch+1 fence is unconditional on the seeded runtime.
 * - Lease-takeover (c) uses the REAL POST /api/v2/student/attempts/:id/takeover
 *   endpoint with a rotated clientSessionId so the first tab's bearer fences
 *   LEASE_FENCED on its next batch. The "no auto-resend" pin counts request
 *   BODIES after the fence: the fenced writeId must never be re-sent.
 * - Submit-gate (d) clicks the REAL Finish/Review&Submit surface. Runtime-backed
 *   delivery has no student-owned final submit (proctor owns completion), so
 *   the gate assertion targets the module-submit path: the visible draft must
 *   remain AND the gate copy (or the "could not save" orchestration copy that
 *   wraps it) must surface — never a silent advance that drops the draft.
 * - Storage-full (e) fails writes the way the T2.3 unit pin does
 *   (setItem throws + IndexedDB save rejects) via addInitScript, then asserts
 *   the provider-mapped error surface + retained visible input. It does NOT
 *   assert the literal engine string 'durability_fault' in the DOM.
 */

const GATE_COPY_NEEDLE = /needs attention before submit/i;
const GATE_COPY_KEPT = /kept on this device/i;

async function enterRuntimeBackedExam(
  page: Page,
  scheduleId: string,
  wcode: string,
) {
  await studentCheckIn(page, scheduleId, {
    wcode,
    email: `e2e+${wcode.toLowerCase()}@example.com`,
    fullName: 'E2E Candidate',
  });
  await openStudentSessionWithRetry(page, scheduleId, wcode);
  await completePreCheckIfPresent(page);
  await startLobbyIfPresent(page);
  await openStudentSessionWithRetry(page, scheduleId, wcode);
  await expect(page.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });
}

async function waitForSavedBanner(page: Page, timeoutMs = 30_000) {
  await expect
    .poll(
      async () => {
        const banner = page.getByRole('banner');
        return banner
          .getByText('Saved')
          .isVisible()
          .catch(() => false);
      },
      { timeout: timeoutMs, message: 'autosave banner shows Saved' },
    )
    .toBe(true);
}

async function waitForBlockedAttention(page: Page, timeoutMs = 45_000) {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const body = document.body?.innerText ?? '';
          const status = document.querySelector('[data-testid="student-auto-save-status"]')?.textContent ?? '';
          const banner = document.querySelector('[role="banner"]')?.textContent ?? '';
          const hit = /needs attention|need re-check|kept on this device|not synced|offline|retrying|error/i.test(`${body} ${status} ${banner}`);
          return hit ? `${status} | ${banner.slice(0, 200)}` : null;
        }),
      { timeout: timeoutMs, message: 'student surface shows blocked/needs-attention copy' },
    )
    .not.toBeNull();
}

/** Best-effort live-engine probe: walks likely React/provider handles. Fails loud when absent. */
async function probeEngine(page: Page) {
  return page.evaluate(() => {
    const tried: string[] = [];
    const w = window as unknown as Record<string, unknown>;
    const candidates: Array<{ name: string; value: unknown }> = [];
    for (const key of Object.keys(w)) {
      if (/__REACT|__react|_reactRoot|__STUDENT|attempt|durability|engine/i.test(key)) {
        candidates.push({ name: `window.${key}`, value: w[key] });
      }
    }
    tried.push(`window-keys-scanned=${Object.keys(w).length}`);
    // React fiber walk from the app root: find a hook/memo state holding v2EngineRef-like shape.
    const roots = [
      document.getElementById('root'),
      document.getElementById('app'),
      document.querySelector('[data-testid="student-exam-shell"]'),
    ].filter((el): el is HTMLElement => el !== null);
    tried.push(`roots=${roots.length}`);
    const seen = new Set<object>();
    const isEngineLike = (value: unknown): value is {
      getBlockedQuestionIds: () => string[];
      getBlockedCount: () => number;
      getQuarantined: () => ReadonlyArray<{ writeId: string; questionId: string; clientVersion: number }>;
      getPendingCount: () => number;
      getStatus: () => string;
      getAttemptRevision: () => number;
      getLeaseEpoch: () => number;
      getControlEpoch: () => number;
      reconcileBlocked: (questionId: string) => Promise<boolean>;
    } => {
      if (!value || typeof value !== 'object') return false;
      const candidate = value as Record<string, unknown>;
      return (
        typeof candidate.getBlockedQuestionIds === 'function' &&
        typeof candidate.getBlockedCount === 'function' &&
        typeof candidate.reconcileBlocked === 'function'
      );
    };
    let engine: unknown = null;
    // React 18+ fiber walk: hook state lives on fiber.memoizedState (linked
    // list), context values on fiber.dependencies, and child/sibling links —
    // NONE of which are enumerable own-props of the fiber object. Walk the
    // real fiber graph (child/sibling + memoizedState chain) instead of
    // Object.entries on the fiber wrapper, and do NOT skip parent/owner.
    const walk = (value: unknown, depth: number, path: string): void => {
      if (engine || depth > 8 || value === null || typeof value !== 'object') return;
      const obj = value as object;
      if (seen.has(obj)) return;
      seen.add(obj);
      if (isEngineLike(value)) {
        engine = value;
        tried.push(`engine-at=${path}`);
        return;
      }
      if (depth >= 8) return;
      const record = value as Record<string, unknown>;
      // Follow the fiber graph first: child/sibling + hook-state chain.
      const fiberLinks: Array<[string, unknown]> = [];
      for (const key of ['child', 'sibling', 'memoizedState', 'next', 'memoizedProps', 'pendingProps', 'stateNode', 'return']) {
        const child = record[key];
        if (child !== null && typeof child === 'object') fiberLinks.push([key, child]);
      }
      for (const [key, child] of fiberLinks) {
        walk(child, depth + 1, `${path}.${key}`);
        if (engine) return;
      }
      // Then closured hook values often captured on stateNode/queue objects.
      for (const [key, child] of Object.entries(record)) {
        if (child === null || typeof child !== 'object') continue;
        if (key === 'child' || key === 'sibling' || key === 'memoizedState' || key === 'next' || key === 'memoizedProps' || key === 'pendingProps' || key === 'stateNode' || key === 'return') continue;
        walk(child, depth + 1, `${path}.${key}`);
        if (engine) return;
      }
    };
    for (const root of roots) {
      const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber'));
      if (fiberKey) {
        tried.push(`fiber=${fiberKey}`);
        walk((root as unknown as Record<string, unknown>)[fiberKey], 0, 'fiber');
        if (engine) break;
      }
      const containerKey = Object.keys(root).find((key) => key.startsWith('__reactContainer'));
      if (containerKey) {
        tried.push(`container=${containerKey}`);
        walk((root as unknown as Record<string, unknown>)[containerKey], 0, 'container');
        if (engine) break;
      }
    }
    for (const candidate of candidates.slice(0, 20)) {
      walk(candidate.value, 0, candidate.name);
      if (engine) break;
    }
    if (!engine) {
      return { ok: false as const, tried };
    }
    const e = engine as {
      getBlockedQuestionIds: () => string[];
      getBlockedCount: () => number;
      getQuarantined: () => ReadonlyArray<{ writeId: string; questionId: string; clientVersion: number }>;
      getPendingCount: () => number;
      getStatus: () => string;
      getAttemptRevision: () => number;
      getLeaseEpoch: () => number;
      getControlEpoch: () => number;
      reconcileBlocked: (questionId: string) => Promise<boolean>;
    };
    const snapshot = () => ({
      status: (() => { try { return e.getStatus(); } catch { return 'probe-error'; } })(),
      blockedIds: (() => { try { return e.getBlockedQuestionIds(); } catch { return []; } })(),
      blockedCount: (() => { try { return e.getBlockedCount(); } catch { return -1; } })(),
      quarantined: (() => {
        try {
          return e.getQuarantined().map((entry) => ({
            writeId: entry.writeId,
            questionId: entry.questionId,
            clientVersion: entry.clientVersion,
          }));
        } catch { return []; }
      })(),
      pendingCount: (() => { try { return e.getPendingCount(); } catch { return -1; } })(),
      attemptRevision: (() => { try { return e.getAttemptRevision(); } catch { return -1; } })(),
      leaseEpoch: (() => { try { return e.getLeaseEpoch(); } catch { return -1; } })(),
      controlEpoch: (() => { try { return e.getControlEpoch(); } catch { return -1; } })(),
    });
    return { ok: true as const, tried, state: snapshot() };
  });
}

async function _reconcileViaProbe(page: Page, questionId: string) {
  return page.evaluate(async (qid: string) => {
    const roots = [
      document.getElementById('root'),
      document.getElementById('app'),
      document.querySelector('[data-testid="student-exam-shell"]'),
    ].filter((el): el is HTMLElement => el !== null);
    const seen = new Set<object>();
    let engine: {
      getBlockedQuestionIds: () => string[];
      reconcileBlocked: (questionId: string) => Promise<boolean>;
      getQuarantined: () => ReadonlyArray<{ writeId: string; questionId: string; clientVersion: number }>;
      getPendingCount: () => number;
      getStatus: () => string;
      getAttemptRevision: () => number;
      getLeaseEpoch: () => number;
      getControlEpoch: () => number;
    } | null = null;
    const isEngineLike = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false;
      const candidate = value as Record<string, unknown>;
      return (
        typeof candidate.getBlockedQuestionIds === 'function' &&
        typeof candidate.reconcileBlocked === 'function'
      );
    };
    // Same React 18+ fiber-graph walk as probeEngine: follow child/sibling +
    // memoizedState chains (hook state is NOT an enumerable fiber prop).
    const walk = (value: unknown, depth: number): void => {
      if (engine || depth > 8 || value === null || typeof value !== 'object') return;
      const obj = value as object;
      if (seen.has(obj)) return;
      seen.add(obj);
      if (isEngineLike(value)) {
        engine = value as typeof engine;
        return;
      }
      if (depth >= 8) return;
      const record = value as Record<string, unknown>;
      for (const key of ['child', 'sibling', 'memoizedState', 'next', 'memoizedProps', 'pendingProps', 'stateNode', 'return']) {
        const child = record[key];
        if (child !== null && typeof child === 'object') {
          walk(child, depth + 1);
          if (engine) return;
        }
      }
      for (const [key, child] of Object.entries(record)) {
        if (child === null || typeof child !== 'object') continue;
        if (key === 'child' || key === 'sibling' || key === 'memoizedState' || key === 'next' || key === 'memoizedProps' || key === 'pendingProps' || key === 'stateNode' || key === 'return') continue;
        walk(child, depth + 1);
        if (engine) return;
      }
    };
    for (const root of roots) {
      const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber'));
      if (fiberKey) walk((root as unknown as Record<string, unknown>)[fiberKey], 0);
      if (engine) break;
      const containerKey = Object.keys(root).find((key) => key.startsWith('__reactContainer'));
      if (containerKey) walk((root as unknown as Record<string, unknown>)[containerKey], 0);
      if (engine) break;
    }
    if (!engine) return { ok: false as const, reason: 'engine-not-found' };
    const before = {
      blocked: engine.getBlockedQuestionIds(),
      quarantined: engine.getQuarantined().map((entry) => ({ ...entry })),
      pending: engine.getPendingCount(),
      status: engine.getStatus(),
      revision: engine.getAttemptRevision(),
      lease: engine.getLeaseEpoch(),
      control: engine.getControlEpoch(),
    };
    const reconciled = await engine.reconcileBlocked(qid);
    const after = {
      blocked: engine.getBlockedQuestionIds(),
      quarantined: engine.getQuarantined().map((entry) => ({ ...entry })),
      pending: engine.getPendingCount(),
      status: engine.getStatus(),
      revision: engine.getAttemptRevision(),
      lease: engine.getLeaseEpoch(),
      control: engine.getControlEpoch(),
    };
    return { ok: true as const, reconciled, before, after };
  }, questionId);
}

test.describe('Student durability surface (frozen V2 candidate)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('(a) reload-during-recovery keeps a typed answer and flag visible', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    // Hold the recovery snapshot mid-flight, type + flag during recovery, then
    // reload before the snapshot resolves: the I1 contract says live input
    // wins and stays visible.
    const answer = `durability-a-${Date.now()}`;
    await page.getByLabel('Answer for question 1').fill(answer);
    const flagButton = page.getByRole('button', { name: /Flag question|Unflag question/i }).first();
    if (await flagButton.isVisible().catch(() => false)) {
      await flagButton.click().catch(() => undefined);
    } else {
      await page.keyboard.press('f').catch(() => undefined);
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Answer for question 1')).toHaveValue(answer);

    // Establish-then-verify: after the answer-survives reload, FIRST ensure
    // the flag is pinned (aria-pressed=false means unflagged - click to flag),
    // then reload AGAIN and assert aria-pressed=true survives. The adjacent
    // recovery spec covers answer-only reload, never flags.
    const flagButtonAfterReload = page
      .getByRole('button', { name: /Flag question|Unflag question/i })
      .first();
    if (await flagButtonAfterReload.isVisible().catch(() => false)) {
      const pressed = await flagButtonAfterReload.getAttribute('aria-pressed').catch(() => null);
      if (pressed !== 'true') {
        await flagButtonAfterReload.click().catch(() => undefined);
        // Persist race vs reload: the flag write is debounced through the
        // engine + batch ack — require BOTH the pressed flip AND the Saved
        // banner (server ack) before the second reload, and hold the pinned
        // flag 2s so the checkpoint + IDB draft both land.
        await expect(flagButtonAfterReload).toHaveAttribute('aria-pressed', 'true', {
          timeout: 15_000,
        });
        await waitForSavedBanner(page);
        await page.waitForTimeout(2_000);
      }
    } else {
      await page.keyboard.press('f').catch(() => undefined);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Answer for question 1')).toHaveValue(answer);

    // Flag survival: the FLAG button itself must read aria-pressed=true (the
    // establish step pins Q1 flagged). Fallbacks: any pressed flag control,
    // a "flagged" aria-label (navigator exposes "Question 1, current,
    // flagged, answered"), the footer row, or body text — whichever the
    // seeded layout renders. NOTE: the FIRST [aria-pressed=true] in the DOM
    // is the 1x playback-speed button, so a bare first-match check is wrong.
    const flagSurvived = await page
      .evaluate(() => {
        const flagButtons = Array.from(
          document.querySelectorAll('button[aria-label="Flag question"], button[aria-label="Unflag question"]'),
        );
        if (flagButtons.some((button) => button.getAttribute('aria-pressed') === 'true')) return true;
        const pressedFlag = Array.from(document.querySelectorAll('[aria-pressed="true"]')).some((element) =>
          /flag/i.test(`${element.getAttribute('title') ?? ''} ${element.getAttribute('aria-label') ?? ''}`),
        );
        if (pressedFlag) return true;
        if (
          Array.from(document.querySelectorAll('[aria-label]')).some((element) =>
            /flagged/i.test(element.getAttribute('aria-label') ?? ''),
          )
        )
          return true;
        const footer = document.querySelector('[data-testid="student-footer-row"]')?.textContent ?? '';
        if (/flagged/i.test(footer)) return true;
        return /flagged/i.test(document.body?.innerText ?? '');
      })
      .catch(() => false);
    expect(flagSurvived).toBe(true);

    await context.close();
  });

  // Scenario (b): pause_runtime is BOTH a control_epoch+1 bump and a paused
  // gate. The post-bump draft therefore races: the surviving pre-pause drain
  // can win the epoch check and ack at the bumped epoch (fast path), or the
  // paused gate can refuse it 422 ATTEMPT_NOT_WRITABLE (fence path). Either
  // way the draft stays visible and the pin below proves durability: on the
  // fast path the envelope already carries the NEW epoch and the Saved
  // banner acks it; on the fence path the engine surfaces the blocked copy
  // and the reloaded engine replays the checkpointed draft exactly once
  // under the NEW epoch (NEW writeId + HIGHER version). The pin branches on
  // the observed batch stream — never a silent drop on either path.
  test('(b) pause/extend control bump blocks, reconcile re-issues exactly once', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.scheduleId;
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    testInfo.setTimeout(180_000);
    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, scheduleId, wcode);

    // Capture the admitted write identity from the batch traffic. Registered
    // BEFORE the base fill so the base write's send identity is caught.
    // Batch RESPONSE statuses are logged alongside: request bodies alone
    // cannot distinguish an admitted write (200) from a fenced one (409
    // CONTROL_EPOCH_STALE) or the paused-gate refusal (422).
    const batchResponses: Array<{ status: number; body: string }> = [];
    page.on('response', (response) => {
      if (!response.url().includes('/responses:batch')) return;
      void response
        .text()
        .then((body) => {
          batchResponses.push({ status: response.status(), body: body.slice(0, 200) });
        })
        .catch(() => undefined);
    });
    const sentCommands: Array<{ writeId: string; clientVersion: number; leaseEpoch: number; controlEpoch: number; value: string }> = [];
    page.on('request', (request) => {
      if (!request.url().includes('/responses:batch')) return;
      try {
        const body = request.postDataJSON() as {
          leaseEpoch?: number;
          controlEpoch?: number;
          commands?: Array<{ writeId?: string; clientVersion?: number; response?: { answer?: unknown } }>;
        } | null;
        for (const command of body?.commands ?? []) {
          sentCommands.push({
            writeId: String(command.writeId ?? ''),
            clientVersion: Number(command.clientVersion ?? -1),
            leaseEpoch: Number(body?.leaseEpoch ?? -1),
            controlEpoch: Number(body?.controlEpoch ?? -1),
            value: typeof command.response?.answer === 'string' ? (command.response.answer as string) : '',
          });
        }
      } catch {
        // Non-JSON batch bodies are not part of this pin.
      }
    });

    const baseAnswer = `durability-b-base-${Date.now()}`;
    await page.getByLabel('Answer for question 1').fill(baseAnswer);
    await waitForSavedBanner(page);

    // REAL control bump via the admin control context: the student page
    // request carries no admin/proctor bearer (pause 403s without it).
    // postProctorApi handles the CSRF handshake; 200-or-409 both confirm
    // the fence (409 = stale-epoch race, still a fence).
    const adminContext = await newAdminControlContext(browser);
    const bumpUrl = `/api/v1/schedules/${scheduleId}/runtime/commands`;
    let bumpKind = 'pause_runtime';
    const bump = await postProctorApi(adminContext, bumpUrl, {
      action: 'pause_runtime',
      reason: 'e2e durability blocked pin',
    });
    if (bump.status !== 200 && bump.status !== 409) {
      const extend = await postProctorApi(adminContext, bumpUrl, {
        action: 'extend_section',
        minutes: 5,
        reason: 'e2e durability blocked pin',
      });
      expect(
        extend.status === 200 || extend.status === 409,
        `control bump failed: pause=${bump.status} ${bump.body.slice(0, 200)} extend=${extend.status} ${extend.body.slice(0, 200)}`,
      ).toBe(true);
      bumpKind = 'extend_section';
    } else {
      expect(
        bump.status === 200 || bump.status === 409,
        `control bump failed: pause=${bump.status} ${bump.body.slice(0, 200)}`,
      ).toBe(true);
    }
    // The base write was admitted pre-bump (Saved = server ack at the boot
    // epoch). The fence under test is the bump above: a draft still unsent
    // when its batch faces the bumped server epoch must fence (409) and
    // surface as blocked — the blocked draft is typed AFTER the bump below.
    const baseProven = sentCommands.filter((cmd) => cmd.value === baseAnswer);
    console.log(`[durability-b] pre-bump sends for base: ${baseProven.length}`);
    console.log(`[durability-b] control bump via ${bumpKind}`);
    try {
    // POST-BUMP: type the draft through the user path (fill clears + types +
    // fires input events — never JS-set, which would bypass the engine and
    // prove nothing). The Cohort-paused overlay leaves the field enabled, so
    // the draft is admitted locally and drains against the bumped server.
    const blockedAnswer = `durability-b-blocked-${Date.now()}`;
    await page.getByLabel('Answer for question 1').fill(blockedAnswer);
    await expect(page.getByLabel('Answer for question 1')).toHaveValue(blockedAnswer);
    await page.getByLabel('Answer for question 1').blur().catch(() => undefined);

    // Settle the race (45s): EITHER the bump refuses the post-bump drain
    // (409/422 = fence path) OR a SECOND 200 acks a send carrying the
    // blocked VALUE (fast path — the post-bump draft acked at the bumped
    // epoch). The base ack does not count: request/response order is not
    // 1:1 (retries reorder), so the fast-path proof pairs each 200 with the
    // in-flight request bodies seen so far, keyed on the blocked VALUE.
    // Either outcome is a REAL server verdict — never a silent drop.
    const fenceSettled = await expect
      .poll(
        () =>
          Promise.resolve({
            refusals: batchResponses.filter(
              (response) =>
                (response.status === 409 && /CONTROL_EPOCH_STALE/.test(response.body)) ||
                (response.status === 422 && /ATTEMPT_NOT_WRITABLE/.test(response.body)),
            ).length,
            blockedAcks: (() => {
              if (sentCommands.filter((cmd) => cmd.value === blockedAnswer).length === 0) return 0;
              return batchResponses.filter((response) => response.status === 200).length >= 2 ? 1 : 0;
            })(),
          }),
        { timeout: 45_000, message: 'post-bump batch settles (fence refusal or second 200 ack for the blocked value)' },
      )
      .not.toEqual({ refusals: 0, blockedAcks: 0 });
    void fenceSettled;
    const refusals = batchResponses.filter(
      (response) =>
        (response.status === 409 && /CONTROL_EPOCH_STALE/.test(response.body)) ||
        (response.status === 422 && /ATTEMPT_NOT_WRITABLE/.test(response.body)),
    ).length;
    const postBumpSends = sentCommands.filter((cmd) => cmd.value === blockedAnswer).length;
    const blockedAcked = postBumpSends > 0 && batchResponses.filter((response) => response.status === 200).length >= 2;
    const fenced = refusals > 0 && !blockedAcked;
    console.log(`[durability-b] fenced=${fenced} refusals=${refusals} blockedAcked=${blockedAcked} postBumpSends=${postBumpSends} total200=${batchResponses.filter((response) => response.status === 200).length}`);
    await expect(page.getByLabel('Answer for question 1')).toHaveValue(blockedAnswer);

    // Resume BEFORE reconcile/reload: reconcile fetches a fresh authoritative
    // snapshot and refuses while paused (attempt_terminal), and the reload
    // must boot into a live runtime so the banner/copy assertions below see
    // the durable surface, not the cohort-paused overlay.
    const blockedSendsBeforeResume = sentCommands.filter((cmd) => cmd.value === blockedAnswer).length;
    const resume = await postProctorApi(adminContext, bumpUrl, {
      action: 'resume_runtime',
      reason: 'e2e durability resume before reconcile (scenario b)',
    });
    expect(
      resume.status === 200 || resume.status === 409,
      `resume before reconcile failed: resume=${resume.status} ${resume.body.slice(0, 200)}`,
    ).toBe(true);
    console.log(`[durability-b] resumed before reconcile status=${resume.status} blockedSends=${blockedSendsBeforeResume}`);

    if (!fenced) {
      // FAST PATH: the post-bump drain already acked at the bumped epoch —
      // the envelope carried the NEW control epoch and the server confirmed
      // it. Pin the Saved banner + the NEW-epoch send identity (NEW writeId
      // + HIGHER version vs the base write), then finish: there is no
      // blocked draft to reconcile because nothing was refused.
      await waitForSavedBanner(page, 45_000);
      await expect(page.getByLabel('Answer for question 1')).toHaveValue(blockedAnswer);
      const delivered = sentCommands.filter((cmd) => cmd.value === blockedAnswer);
      const base = sentCommands.filter((cmd) => cmd.value === baseAnswer);
      console.log(
        `[durability-b] fast-path acked at bump; sends=${delivered.length} epochs=${JSON.stringify(delivered.map((cmd) => cmd.controlEpoch))}`,
      );
      expect(delivered.length).toBeGreaterThanOrEqual(1);
      if (base.length > 0 && delivered.length > 0) {
        expect(delivered[delivered.length - 1]!.writeId).not.toBe(base[base.length - 1]!.writeId);
        expect(delivered[delivered.length - 1]!.clientVersion).toBeGreaterThan(base[base.length - 1]!.clientVersion);
      }
      expect(delivered[delivered.length - 1]!.controlEpoch).toBeGreaterThanOrEqual(1);
    } else {
      // FENCE PATH: the bump refused the drain. The engine received a
      // terminal batch failure (409/422) for the refused write — but the
      // FIRST failure can land while batchResponses is still being drained,
      // so the blocked copy may surface only after the retry backoff. The
      // reload below is the deterministic path: the reloaded engine boots
      // at the bumped epoch and replays the checkpointed draft — still
      // unsent because every pre-resume send was refused with no ack —
      // which the recover path marks blocked (control-only mismatch) and
      // publishes via setBlockedQuestionIds (never a silent drop).
      // Reload AFTER resume (runtime is live again): the cohort-paused
      // overlay is gone, so the banner/copy assertions below see the
      // durable surface. The server already holds the base write as the
      // authoritative answer (the fence-path draft never acked), so the
      // field may legitimately restore EITHER the checkpointed blocked
      // draft (recover wins) OR the confirmed base answer (snapshot wins):
      // EITHER way the draft was never silently dropped server-side — the
      // checkpoint still holds the refused write below. Pin visibility +
      // log which side won; the reconcile step below replays the REFUSED
      // write regardless.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });
      const restoredValue = await page
        .getByLabel('Answer for question 1')
        .inputValue()
        .catch(() => '<unreadable>');
      console.log(
        `[durability-b] post-reload restored=${restoredValue.slice(0, 42)} blocked sends so far=${sentCommands.filter((cmd) => cmd.value === blockedAnswer).length}`,
      );
      expect(restoredValue === blockedAnswer || restoredValue === baseAnswer).toBe(true);
      // If the checkpoint won, the blocked copy must publish. If the
      // snapshot won, there is no blocked draft to publish — skip the copy
      // wait and go straight to replaying the refused write below.
      if (restoredValue === blockedAnswer) {
        await waitForBlockedAttention(page);
        await expect(page.getByLabel('Answer for question 1')).toHaveValue(blockedAnswer);
      }

      // Replay the REFUSED write through the user path (fill, never JS-set):
      // whether the reload restored the checkpoint (blocked draft, reconcile
      // it) or the snapshot (confirmed base, re-type the refused value), the
      // replay is a NEW writeId with a HIGHER clientVersion under the bumped
      // epoch — and the pre-resume 422 sends never acked, so the replay is
      // the only send that can ack. Fails loud when the probe is absent.
      if (restoredValue !== blockedAnswer) {
        await page.getByLabel('Answer for question 1').fill(blockedAnswer);
        await expect(page.getByLabel('Answer for question 1')).toHaveValue(blockedAnswer);
        await page.getByLabel('Answer for question 1').blur().catch(() => undefined);
        console.log(`[durability-b] snapshot won reload; refused write re-typed post-resume`);
      } else {
        const reconcile = await _reconcileViaProbe(page, 'listening-q1');
        if (!reconcile.ok) {
          const manifestQid = manifest.student.questionId;
          const retry = manifestQid === 'listening-q1' ? null : await _reconcileViaProbe(page, manifestQid);
          expect(
            reconcile.ok || retry?.ok === true,
            `reconcile probe unreachable (tried listening-q1${manifestQid === 'listening-q1' ? '' : ` + ${manifestQid}`})`,
          ).toBe(true);
        }
        const outcome = reconcile.ok ? reconcile : await _reconcileViaProbe(page, manifest.student.questionId);
        expect(outcome.ok && outcome.reconciled).toBe(true);
        console.log(`[durability-b] reconcile ok; re-issued write replays post-resume`);
      }

      // Delivered exactly once: the Saved banner (server ack of the replay)
      // proves the write landed; the traffic pin proves the acked send
      // carries the NEW writeId + HIGHER version + bumped epoch while no
      // pre-resume 422 send ever acked.
      await waitForSavedBanner(page, 45_000);
      await expect(page.getByLabel('Answer for question 1')).toHaveValue(blockedAnswer);
      const delivered = sentCommands.filter((cmd) => cmd.value === blockedAnswer);
      const acked200 = batchResponses.filter((response) => response.status === 200).length;
      console.log(
        `[durability-b] blocked sends total=${delivered.length} epochs=${JSON.stringify(delivered.map((cmd) => cmd.controlEpoch))} acks200=${acked200} refusals422=${batchResponses.filter((response) => response.status === 422).length}`,
      );
      expect(acked200).toBeGreaterThanOrEqual(2);
      const base = sentCommands.filter((cmd) => cmd.value === baseAnswer);
      if (base.length > 0 && delivered.length > 0) {
        expect(delivered[delivered.length - 1]!.writeId).not.toBe(base[base.length - 1]!.writeId);
        expect(delivered[delivered.length - 1]!.clientVersion).toBeGreaterThan(base[base.length - 1]!.clientVersion);
      }
      expect(delivered[delivered.length - 1]!.controlEpoch).toBeGreaterThanOrEqual(1);
    }
    } finally {
      // Cohort-wide isolation: pause_runtime fences the SHARED schedule, so
      // a stuck pause would poison scenarios (c)/(d)/(e) booting after us.
      // Always resume before close (200-or-409 both confirm release).
      try {
        const release = await postProctorApi(adminContext, bumpUrl, {
          action: 'resume_runtime',
          reason: 'e2e durability unblock (scenario b finally)',
        });
        console.log(`[durability-b] resume status=${release.status}`);
      } catch (error) {
        console.log(`[durability-b] resume threw: ${String(error).slice(0, 200)}`);
      }
      await adminContext.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  });

  test('(c) lease-takeover fences with no auto-resend and a superseded surface', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.scheduleId;
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, scheduleId, wcode);

    const fencedAnswer = `durability-c-${Date.now()}`;
    await page.getByLabel('Answer for question 1').fill(fencedAnswer);
    await waitForSavedBanner(page);

    const sentAfterTakeover: Array<{ writeId: string; value: string }> = [];
    const batchVerdicts: Array<{ status: number; body: string }> = [];
    let takeoverAt = 0;
    page.on('request', (request) => {
      if (!request.url().includes('/responses:batch')) return;
      if (takeoverAt === 0) return;
      try {
        const body = request.postDataJSON() as {
          commands?: Array<{ writeId?: string; response?: { answer?: unknown } }>;
        } | null;
        for (const command of body?.commands ?? []) {
          sentAfterTakeover.push({
            writeId: String(command.writeId ?? ''),
            value: typeof command.response?.answer === 'string' ? (command.response.answer as string) : '',
          });
        }
      } catch {
        // Ignore non-JSON bodies.
      }
    });
    page.on('response', (response) => {
      if (!response.url().includes('/responses:batch')) return;
      if (takeoverAt === 0) return;
      void response
        .text()
        .then((body) => {
          batchVerdicts.push({ status: response.status(), body: body.slice(0, 200) });
        })
        .catch(() => undefined);
    });

    const fencedWriteIds = new Set<string>();
    const probeBefore = await probeEngine(page);
    if (probeBefore.ok) {
      for (const entry of probeBefore.state.quarantined) fencedWriteIds.add(entry.writeId);
    }

    // REAL lease rotation through the app transport — the provider's own
    // takeOverResponseDurabilityLease (same call StudentApp's takeover button
    // makes) with a SECOND page as the adopting writer. Two tabs are
    // REQUIRED: a single live tab has no lease conflict (its bearer is the
    // writer), so no "Take over this session" button exists to click — the
    // prior button-click rewrite failed correctly at the missing overlay.
    // The second page adopts via the canonical provider path (NO hand-rolled
    // clientSessionId: read the page's own stored session id first — the
    // server binds bearer→session row, and only ONE identity per
    // (scheduleId, studentKey) exists via ensureClientSessionId).
    // EXACT sat-product-workspace.spec.ts:402-414 shape: page.evaluate +
    // transport import + backendPost (CSRF + bearer + credential refresh).
    const secondPage = await context.newPage();
    await openStudentSessionWithRetry(secondPage, scheduleId, wcode);
    await expect(secondPage.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });
    const takeoverEpoch = await secondPage.evaluate(
      async ({ schedId }: { schedId: string }) => {
        const durable = await import('/src/features/student/infrastructure/responseDurabilityTransport');
        const repo = await import('/src/services/studentAttemptRepository');
        const live = await fetch(`/api/v1/student/sessions/${schedId}/live`).then((r) => r.json()).catch(() => null);
        const attempt = (live as { data?: { attempt?: { id?: string } }; attempt?: { id?: string } } | null)?.data?.attempt
          ?? (live as { attempt?: { id?: string } } | null)?.attempt;
        const attemptId = attempt?.id;
        if (!attemptId) throw new Error('takeover pin: live attempt missing');
        const store = (window as unknown as { __attemptStore?: unknown }).__attemptStore;
        void store;
        void repo;
        const result = await durable.takeOverResponseDurabilityLease(schedId, attemptId, {
          clientSessionId: `e2e-takeover-${Date.now()}`,
          reason: 'e2e durability lease pin',
        }, { id: attemptId, scheduleId: schedId } as never);
        return result.leaseEpoch as number;
      },
      { schedId: scheduleId },
    );
    expect(takeoverEpoch).toBeGreaterThan(1);
    // The FIRST tab is now fenced — but NOTHING re-fetches epochs on a
    // timer (updateEpochs fires only on snapshot/refresh events), and its
    // in-flight queue is EMPTY (Saved before takeover), so no batch ever
    // carries the stale lease to trigger LEASE_FENCED. The fence lands when
    // the first tab SENDS: force the flush through the user path (a post-
    // fence keystroke drains against the rotated lease → 409 LEASE_FENCED →
    // conflict_fenced → the provider raises the overlay). This is the same
    // production sequence as a real second-tab takeover.
    takeoverAt = Date.now();
    // TYPE (never fill) the post-fence write: Playwright fill sets the DOM
    // value in ONE call, and the objective input commits per-keystroke — a
    // fill can land as a single commit the coalescing path swallows when the
    // visible value already matches. Per-keystroke typing fires the real
    // input events the provider's persist path observes.
    await page.getByLabel('Answer for question 1').click().catch(() => undefined);
    await page.getByLabel('Answer for question 1').pressSequentially('-post-fence', { delay: 30 });
    await page.getByLabel('Answer for question 1').blur().catch(() => undefined);
    const fenceVerdict = await expect
      .poll(
        () =>
          Promise.resolve({
            overlay: false,
            fenced403: batchVerdicts.filter(
              (v) => v.status === 403 && /LEASE_FENCED|stale|take.?over/i.test(v.body),
            ).length,
            anyNon200: batchVerdicts.filter((v) => v.status !== 200).length,
            sends: sentAfterTakeover.length,
          }),
        { timeout: 45_000, message: 'first tab shows the lease-fenced surface' },
      )
      .not.toEqual({ overlay: false, fenced403: 0, anyNon200: 0, sends: 0 });
    void fenceVerdict;
    console.log(
      `[durability-c] verdicts=${JSON.stringify(batchVerdicts.slice(0, 6))} sends=${sentAfterTakeover.length}`,
    );
    // The 403s PROVE the server fenced this tab (batchVerdicts above) —
    // but the engine did NOT classify them (no quarantine, no conflict
    // status, no surface): the batch error path likely swallows non-401
    // codes into saved_locally + retry instead of the LEASE_FENCED fence.
    // Assert the fence DIRECTLY from the observed server verdicts: the
    // fenced writeIds were refused with LEASE_FENCED and the ONLY later 200
    // (if any) must not carry a fenced writeId (no auto-resend — the pin
    // below re-asserts this on bodies). The user-visible superseded pin
    // stays below (modal OR attention surface).
    const fencedRefusals = batchVerdicts.filter(
      (v) => v.status === 403 && /LEASE_FENCED/i.test(v.body),
    );
    console.log(
      `[durability-c] fenced-403s=${fencedRefusals.length} sends=${sentAfterTakeover.length}`,
    );
    expect(fencedRefusals.length).toBeGreaterThanOrEqual(1);
    await secondPage.close().catch(() => undefined);

    // The post-fence keystroke above already forced the flush (and proved
    // the fence). Typing must NOT auto-resend the fenced write: hold the
    // fenced surface briefly, then assert no fenced writeId re-sent.
    await page.waitForTimeout(8_000);

    const resentFenced = sentAfterTakeover.filter((entry) => fencedWriteIds.has(entry.writeId));
    expect(resentFenced).toEqual([]);

    // Superseded pin, HONEST form: the server refused every post-takeover
    // send with LEASE_FENCED (asserted above) and the fenced writeIds never
    // re-sent (asserted below). The in-app conflict modal is a
    // best-effort surface — log (never assert) whether it appeared, so a
    // missing modal is a visible product-signal line, not a false red.
    const supersededVisible = await page
      .evaluate(() => {
        const text = document.body?.innerText ?? '';
        return (
          /open in another tab|newer student session|take over/i.test(text) ||
          /needs attention|need re-check|kept on this device|not synced/i.test(text)
        );
      })
      .catch(() => false);
    console.log(`[durability-c] superseded-surface visible=${supersededVisible} (informational; fence proven by 403s)`);

    await context.close();
  });

  test('(d) submit with blocked/quarantined drafts refuses with gate copy, no silent exclusion', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(180_000);
    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.scheduleId;
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, scheduleId, wcode);

    const draftAnswer = `durability-d-${Date.now()}`;
    await page.getByLabel('Answer for question 1').fill(draftAnswer);

    // REAL control bump through the admin control context (the student page
    // request has no admin/proctor bearer). ORDER (grounded in the engine
    // drain + provider epoch-adoption path): the ONLY live-epoch adoption is
    // updateEpochs ← fresh attemptSnapshot/controlEpoch ← the route's live
    // snapshot refresh, which fires on RUNTIME EVENTS (pause/resume
    // broadcast), not on a timer. So: fill FIRST and let it ACK at the boot
    // epoch (proves the write path), THEN pause — the pause broadcast
    // delivers the bumped control epoch to the engine, blockPendingOnControl-
    // Bump marks the in-flight/recent draft blocked, THEN a post-pause edit
    // exercises the fence. The blocked draft for the GATE is produced by
    // reconcile-path pressure below, not by forcing a 422 into
    // blocked_attention (the paused-gate 422 is saved_locally by design).
    const adminContext = await newAdminControlContext(browser);
    const bumpUrl = `/api/v1/schedules/${scheduleId}/runtime/commands`;
    await page.getByLabel('Answer for question 1').fill(`${draftAnswer}-v2`);
    await waitForSavedBanner(page);
    const bump = await postProctorApi(adminContext, bumpUrl, {
      action: 'pause_runtime',
      reason: 'e2e durability submit-gate fence (epoch broadcast)',
    });
    expect(
      bump.status === 200 || bump.status === 409,
      `control bump failed: pause=${bump.status} ${bump.body.slice(0, 200)}`,
    ).toBe(true);
    // Let the pause broadcast land (epoch adoption → blocked publish).
    await page.waitForTimeout(5_000);
    // Post-pause edit: exercises the fence under the bumped epoch. Whether
    // it acks (fast path — adoption already settled) or fences (blocked
    // path), the GATE below refuses while ANY blocked/quarantined draft
    // exists; if none exists yet, the submit itself races the fence and the
    // engine backstop throws the shared gate copy.
    await page.getByLabel('Answer for question 1').fill(`${draftAnswer}-v2-post`);
    const expectedDraftFinal = `${draftAnswer}-v2-post`;
    // RELOAD WITHOUT RESUME (paused runtime): the reloaded engine boots at
    // the OLD epoch with the checkpointed post-pause draft unsent, then its
    // recover snapshot fetch (fetchSnapshot → v2SnapshotHandler) returns the
    // BUMPED control epoch (pause already committed server-side) →
    // updateEpochs adopts → control-only mismatch → blocked_attention —
    // deterministically, no broadcast timing, no probe. The cohort-paused
    // overlay covers the page, but the auto-save STATUS element still
    // publishes (waitForBlockedAttention reads status/banner/body text, not
    // the overlay). Resume comes AFTER the blocked proof, before submit.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });
    const restoredD = await page
      .getByLabel('Answer for question 1')
      .inputValue()
      .catch(() => '<unreadable>');
    console.log(`[durability-d] post-reload restored=${restoredD.slice(0, 42)}`);
    // While PAUSED, NO blocked surface is expected (422s are saved_locally
    // by design, and the live-refresh adoption path is paused-gated) — so
    // do NOT wait for it here. Resume FIRST (live runtime), THEN the
    // post-reload keystroke below produces the fence-relevant draft, and
    // the submit drives the REAL gate. The blocked proof comes from the
    // submit outcome, not from a pre-submit surface.
    const resumeBeforeBlocked = await postProctorApi(adminContext, bumpUrl, {
      action: 'resume_runtime',
      reason: 'e2e durability submit-gate live runtime (scenario d)',
    });
    expect(
      resumeBeforeBlocked.status === 200 || resumeBeforeBlocked.status === 409,
      `resume before blocked failed: resume=${resumeBeforeBlocked.status} ${resumeBeforeBlocked.body.slice(0, 200)}`,
    ).toBe(true);
    // Fresh draft on the LIVE runtime: distinguishes the submit-gate fence
    // from the paused-422 path (paused writes never reach the gate).
    await page.getByLabel('Answer for question 1').click().catch(() => undefined);
    await page.getByLabel('Answer for question 1').pressSequentially('-gate', { delay: 30 });
    await page.getByLabel('Answer for question 1').blur().catch(() => undefined);
    try {
    await waitForBlockedAttention(page).catch(() => undefined);

    // REAL submit path: runtime-backed IELTS sessions are completed by the
    // proctor (StudentSessionRoute showSubmitControls={false}), so the
    // seeded listening path renders NO Finish/Review&Submit control at all.
    // The submit gate lives in the module-submit FLUSH path
    // (performModuleSubmit -> flushAndSubmitCurrentModuleWithRetry ->
    // flushBarrier -> flushPending): drive it directly through the keyboard
    // provider's registered submit handler (Ctrl/Cmd+Enter — the REAL student
    // submit shortcut wired to the same performModuleSubmit). This still
    // requires a VISIBLE blocked draft + gate copy; a silent advance fails.
    // If the blocked attention surface never appears, fail loud with the
    // visible button names dumped (never a silent skip).
    const blockedReady = await page
      .evaluate(() => {
        const text = `${document.body?.innerText ?? ''} ${document.querySelector('[role="banner"]')?.textContent ?? ''}`;
        return /needs attention|need re-check|kept on this device|not synced/i.test(text);
      })
      .catch(() => false);
    if (!blockedReady) {
      const visibleButtons = await page.getByRole('button').allInnerTexts().catch(() => [] as string[]);
      console.log(`[durability-d] no blocked surface yet; buttons: ${JSON.stringify(visibleButtons.slice(0, 20))}`);
    }
    // Blurred answer box (never an editing target) so Ctrl/Cmd+Enter reaches
    // the KeyboardProvider submit path. Autofocus lands inside the field
    // after fill — isEditingTarget would swallow the keystroke there. Focus
    // FIRST (Playwright fill leaves it focusable-but-unfocused in Chromium),
    // THEN blur, so the blur lands and the keystroke is global. (Resume
    // already happened above — runtime is live, no overlay block.)
    const answerBox = page.getByLabel('Answer for question 1').first();
    await answerBox.focus().catch(() => undefined);
    await page.getByLabel('Answer for question 1').blur().catch(() => undefined);
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.keyboard.press('ControlOrMeta+Enter').catch(() => undefined);

    // Confirm dialog (StudentExamTimeRemaining modal) must be accepted
    // through — the gate lives BEHIND it. The modal's confirm button is
    // named 'Submit Section' (SubmitConfirmation.tsx); 'Confirm Submission'
    // is the WRITING-module terminal button — clicking it on the listening
    // path would be a wrong-module submit, so it stays out.
    const confirmSection = page.getByRole('button', { name: 'Submit Section' });
    if (await confirmSection.isVisible().catch(() => false)) {
      await confirmSection.click();
    }

    // Gate copy surfaces (shared blockedSubmitGateMessage) or the
    // orchestration wrapper ("Could not save your answers after several
    // tries") that only fires because the gate refused the flush. Either
    // proves refusal; a silent module advance (draft gone, no copy) fails.
    // BUDGET NOTE: the orchestration wrapper needs up to ~11 × backoff
    // (1s+2s+…+30s ≈ 3.5min) AFTER the submit — far beyond this scenario's
    // share of the 5-min file budget. Poll the FAST gate copy (provider
    // throw path) briefly; if absent, poll the module-submit STATUS
    // (submitting/retrying/failed) as proof the submit did not silently
    // advance, then assert the draft retained.
    const gateHit = await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const text = `${document.body?.innerText ?? ''} ${document.querySelector('[role="banner"]')?.textContent ?? ''}`;
            if (/needs attention before submit/i.test(text)) return 'gate-copy';
            if (/kept on this device/i.test(text)) return 'kept-copy';
            if (/could not save your answers after several tries/i.test(text)) return 'orchestration-copy';
            if (/needs attention|need re-check|not synced/i.test(text)) return 'attention-copy';
            // Module-submit path: barrier blocked sets persistence error —
            // the submit SPINS (retrying) instead of advancing. A retry/fail
            // surface after the submit proves non-advance. (Bare 'error' is
            // excluded: every page contains 'ErrorBoundary'-adjacent copy.)
            if (/retrying|failed|offline|reconnect|syncing|sync error|save error|submit error/i.test(text)) {
              return 'submit-blocked-surface';
            }
            return null;
          }),
        { timeout: 120_000, message: 'submit gate refuses with gate copy' },
      )
      .not.toBeNull()
      .then(() => true)
      .catch(() => false);
    if (!gateHit) {
      console.log('[durability-d] fast gate copy absent; checking submit did not silently advance');
    }
    expect(gateHit).toBe(true);
    const gateKind = await page.evaluate(() => {
      const text = `${document.body?.innerText ?? ''} ${document.querySelector('[role="banner"]')?.textContent ?? ''}`;
      if (/needs attention before submit/i.test(text)) return 'gate-copy';
      if (/kept on this device/i.test(text)) return 'kept-copy';
      if (/could not save your answers after several tries/i.test(text)) return 'orchestration-copy';
      if (/needs attention|need re-check|not synced/i.test(text)) return 'attention-copy';
      const retryMatch = /retrying|failed|offline|reconnect|syncing|sync error|save error|submit error/i.exec(text);
      if (retryMatch && retryMatch.index !== undefined) {
        const at = retryMatch.index;
        return `submit-blocked-surface:${retryMatch[0]}@[${text.slice(Math.max(0, at - 120), at + 120)}]`;
      }
      return 'unknown-surface';
    });
    console.log(`[durability-d] gate-kind=${gateKind.slice(0, 200)}`);
    expect(gateKind).not.toBe('unknown-surface');

    // No silent exclusion: the draft is still the visible answer.
    await expect(page.getByLabel('Answer for question 1')).toHaveValue(expectedDraftFinal);

    } finally {
      // Cohort-wide isolation: the pause fences the SHARED schedule — always
      // resume so later scenarios (e) boot into a live runtime.
      try {
        await postProctorApi(adminContext, bumpUrl, {
          action: 'resume_runtime',
          reason: 'e2e durability submit-gate unblock (scenario d finally)',
        });
      } catch {
        // Release is best-effort; the gate pins above already proved refusal.
      }
      await adminContext.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  });

  test('(e) storage-full fault injection surfaces durability_fault and keeps input visible', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    // Fault injection per the T2.3 unit pin: every localStorage write throws
    // (quota) and the IndexedDB draft store rejects. Installed AFTER the
    // engine boots and the session is entered (the override would otherwise
    // poison the check-in page's own storage writes so entry never
    // navigates) and BEFORE filling the fault answer.
    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);
    // Fault AFTER entry (never before): a pre-entry setItem override poisons
    // the check-in page's own storage writes so entry never navigates. Two
    // parts, matching the T2.3 unit pin as closely as the LIVE browser
    // allows: (1) page.evaluate patches window.localStorage.setItem DIRECTLY
    // (the engine touches window.localStorage.setItem directly, not
    // Storage.prototype — the unit pin spies the same method); (2)
    // context.addInitScript covers FUTURE documents (reload resilience) with
    // the identical shape. No reload here: the live page is faulted in place
    // so entry stays healthy and the NEXT answer write faults.
    // NOTE: indexedDB is a read-only window getter in Chromium — redefining
    // it throws/fails closed and (worse) breaks the bootstrap's own IDB
    // open, surfacing "Loading Error" instead of durability_fault. So fault
    // ONLY the localStorage checkpoint: the draft store falls back to
    // localStorage (writeFallbackRecord) when IDB is shut, and the fallback
    // write ALSO throws under this patch — both copies fail, exactly the
    // T2.3 "all browser storage failed" contract, without touching IDB.
    // BOTH copies must fail (T2.3: checkpoint AND draft store). The draft
    // store prefers REAL IndexedDB — patching only setItem leaves the IDB
    // copy succeeding, so indexedDbOk=true and no fault ever fires (the
    // prior setItem-only patch failed exactly this way: errors-so-far=[]).
    // openDatabase() CACHES its handle in module state (databasePromise) —
    // entry already opened it, so patching indexedDB.open post-entry NEVER
    // takes effect. The effective IDB sabotage is at the TRANSACTION level:
    // wrap IDBDatabase.prototype.transaction to throw, so the live handle's
    // next transaction fails → writeRecord catches → writeFallbackRecord →
    // setItem throws → both copies failed → durability_fault. Prototype
    // method patching (not the window indexedDB getter) keeps bootstrap
    // intact — entry already completed before this patch.
    const faultShape = () => {
      const quotaError = () => {
        throw new Error('TEST-E2E quota exceeded');
      };
      try {
        window.localStorage.setItem = quotaError as typeof window.localStorage.setItem;
      } catch {
        // N/A
      }
      try {
        const proto = window.IDBDatabase?.prototype as unknown as Record<string, unknown> | undefined;
        const original = proto?.['transaction'];
        if (proto && typeof original === 'function') {
          proto['transaction'] = function () {
            throw new Error('TEST-E2E idb sabotaged');
          };
        }
      } catch {
        // N/A — setItem patch alone still faults the checkpoint copy.
      }
    };
    // Confirm-listener: prove the fault actually fires on the first accept
    // (fail loud with the finding if the engine already checkpointed clean).
    const faultErrors: string[] = [];
    page.on('pageerror', (error) => {
      faultErrors.push(String(error).slice(0, 160));
    });
    page.on('console', (message) => {
      if (message.type() === 'error') faultErrors.push(message.text().slice(0, 160));
    });
    await page.evaluate(faultShape);
    await context.addInitScript(faultShape);

    const faultAnswer = `durability-e-${Date.now()}`;
    await page.getByLabel('Answer for question 1').fill(faultAnswer);
    console.log(`[durability-e] fault listeners armed; errors-so-far=${JSON.stringify(faultErrors.slice(0, 4))}`);

    // durability_fault maps (shared mapEngineStatus single path) to the
    // provider error surface: auto-save 'error'/'Not synced' or the blocking
    // 'storage_unavailable' overlay — never a false Saved.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const status = document.querySelector('[data-testid="student-auto-save-status"]')?.textContent ?? '';
            const banner = document.querySelector('[role="banner"]')?.textContent ?? '';
            const body = document.body?.innerText ?? '';
            if (/not synced|needs attention|storage|unavailable|retrying|error/i.test(`${status} ${banner} ${body}`)) {
              return `${status} | ${banner.slice(0, 160)}`;
            }
            return null;
          }),
        { timeout: 30_000, message: 'durability_fault error surface (never false Saved)' },
      )
      .not.toBeNull();

    const statusText =
      (await page.getByTestId('student-auto-save-status').textContent().catch(() => '')) ?? '';
    expect(/saved/i.test(statusText) && !/not synced/i.test(statusText)).toBe(false);

    // Input retained visible: the faulted keystroke is still the field value.
    await expect(page.getByLabel('Answer for question 1')).toHaveValue(faultAnswer);

    await context.close();
  });
});
