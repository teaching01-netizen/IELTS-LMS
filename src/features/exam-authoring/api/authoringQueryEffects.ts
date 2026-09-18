/**
 * The ONE owner of authoring query-cache policy.
 *
 * WHY THIS EXISTS
 * ---------------
 * "Which projections does this mutation invalidate?" used to be answered in
 * three unrelated places: the mutation hooks in assessmentQueries, the
 * collaboration boundary's command/acknowledgement switches, and inline
 * `invalidateQueries` calls inside the workspace. The same triple —
 * shell + readiness + release — was retyped in eleven of them, so a change to
 * one projection silently missed the others.
 *
 * Mutations and realtime events now name their semantic effect, and this module
 * decides what that means for the cache. Callers never build a key list.
 *
 * Responsibility split:
 *   - the KEY factories name projections (assessmentKeys, accessLinkKeys)
 *   - the EFFECTS below own which projections an event affects
 *   - the query hooks own fetching and retry policy
 *   - components own rendering
 *
 * Dependencies point one way: this module imports the key factories and the
 * task contracts; nothing imported here imports this module back.
 *
 * VOCABULARY
 * ----------
 * The effects come in two shapes, and the difference is deliberate:
 *
 *   - composite effects name a DOMAIN fact and imply the whole projection set
 *     it touches: `shellChanged` (the tree and the reports derived from it),
 *     `published`, `questionsReplaced`, `questionRemoved`.
 *   - projection effects name EXACTLY ONE projection family and imply nothing
 *     else: `shellDocumentChanged`, `readinessAndReleaseChanged`,
 *     `questionDetailChanged`, `questionDetailRemoved`. They exist because the
 *     realtime reconciler's port must express a policy that differs per
 *     projection — a remote `question.changed` refetches that question
 *     actively while only marking the tree stale, so naming the tree there
 *     would refetch the whole shell on every keystroke-adjacent event and
 *     flicker the list.
 *   - write effects install payload the caller ALREADY has (`questionSaved`,
 *     `questionDetailLoaded`); they are not invalidations at all.
 *
 * Every effect is async because some callers must ORDER on the refresh — the
 * route-change composite in particular, which must complete before the next
 * screen mounts. Callers that only report an event use `void` and get the same
 * fire-and-forget behavior they had before.
 */
import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../shared/api/queryClient";
import { examKeys } from "./examQueries";
import { accessLinkKeys } from "./accessLinkKeys";
import { summaryFromRevision } from "../application/authoringQuestionSummary";
import type {
  AssessmentAuthoringShell,
  AssessmentAuthoringShellResult,
  AssessmentQuestionDetail,
  QuestionRevision,
} from "../contracts/assessment";
import type { AssessmentReleaseState } from "../contracts/release";
import type { SatWorkspaceCommand } from "../realtime/coedit/workspaceCommands";

export const assessmentKeys = {
  shell: (examId: string) => ["assessment", examId, "shell"] as const,
  release: (examId: string) => ["assessment", examId, "release"] as const,
  readinessRoot: (examId: string) => ["assessment", examId, "readiness"] as const,
  readiness: (examId: string, versionId: string, versionRevision: number) =>
    ["assessment", examId, "readiness", versionId, versionRevision] as const,
  question: (examQuestionId: string) => ["assessment-question", examQuestionId] as const,
};

/**
 * How a projection is refreshed. "none" marks it stale without an active
 * refetch, which is what bulk-shaped writes want: the screen already applied
 * the change optimistically and must not refetch mid-edit.
 */
export type AuthoringRefetchType = "active" | "none";

/**
 * The shell cache always holds a lifecycle result, never a bare shell.
 *
 * A mutation that produced a shell has by definition produced READY, so every
 * writer goes through this instead of hand-building the envelope — that is what
 * keeps the cache from holding two shapes at once.
 */
export function readyShellResult(shell: AssessmentAuthoringShell): AssessmentAuthoringShellResult {
  return { state: "READY", shell };
}

/** Apply a READY shell to the shell cache without waiting for a refetch. */
export function setReadyShell(
  queryClient: QueryClient,
  examId: string,
  shell: AssessmentAuthoringShell
): void {
  queryClient.setQueryData(assessmentKeys.shell(examId), readyShellResult(shell));
}

/**
 * Invalidate the tree projections: the shell, its readiness report, its release.
 *
 * `refetchType` applies to ALL THREE. A caller that says "do not refetch" is
 * describing the whole structural refresh, not two thirds of it: letting the
 * release key keep its default active refetch would let a quiet bulk write
 * still kick a release read, which is the refetch storm the option exists to
 * prevent.
 */
async function invalidateStructure(
  queryClient: QueryClient,
  examId: string,
  refetchType?: AuthoringRefetchType
): Promise<void> {
  await Promise.allSettled([
    invalidateShellDocument(queryClient, examId, refetchType),
    invalidateReadinessAndRelease(queryClient, examId, refetchType),
  ]);
}

/**
 * Invalidate the two REPORTS derived from the tree: the readiness report and
 * the release state. Cheaper than the shell when neither the rows nor their
 * order moved, and the only pair a caller may want on its own.
 */
async function invalidateReadinessAndRelease(
  queryClient: QueryClient,
  examId: string,
  refetchType?: AuthoringRefetchType
): Promise<void> {
  const refetchOption = refetchType ? { refetchType } : {};
  await Promise.allSettled([
    queryClient.invalidateQueries({
      queryKey: assessmentKeys.readinessRoot(examId),
      ...refetchOption,
    }),
    queryClient.invalidateQueries({
      queryKey: assessmentKeys.release(examId),
      ...refetchOption,
    }),
  ]);
}

/** Invalidate the shell document alone: the tree's rows, no derived reports. */
async function invalidateShellDocument(
  queryClient: QueryClient,
  examId: string,
  refetchType?: AuthoringRefetchType
): Promise<void> {
  const refetchOption = refetchType ? { refetchType } : {};
  await queryClient.invalidateQueries({
    queryKey: assessmentKeys.shell(examId),
    ...refetchOption,
  });
}

/** Remove one question's cached detail. The tree is not touched. */
function removeQuestionDetail(queryClient: QueryClient, examQuestionId: string): void {
  queryClient.removeQueries({ queryKey: assessmentKeys.question(examQuestionId) });
}

/** Invalidate one question's cached detail. The tree is not touched. */
async function invalidateQuestionDetail(
  queryClient: QueryClient,
  examQuestionId: string,
  refetchType?: AuthoringRefetchType
): Promise<void> {
  const refetchOption = refetchType ? { refetchType } : {};
  await queryClient.invalidateQueries({
    queryKey: assessmentKeys.question(examQuestionId),
    ...refetchOption,
  });
}

async function invalidateQuestionDetails(
  queryClient: QueryClient,
  questionIds: Iterable<string>,
  refetchType?: AuthoringRefetchType
): Promise<void> {
  await Promise.allSettled(
    [...questionIds].map((questionId) =>
      invalidateQuestionDetail(queryClient, questionId, refetchType)
    )
  );
}

/** Every question id a workspace command payload names. */
function questionIdsFromCommand(command: SatWorkspaceCommand): Set<string> {
  const payload = command.payload;
  const ids = new Set<string>();
  if (typeof payload["questionId"] === "string") ids.add(payload["questionId"]);
  if (Array.isArray(payload["questionIds"])) {
    for (const value of payload["questionIds"]) {
      if (typeof value === "string" && value.trim()) ids.add(value);
    }
  }
  return ids;
}

/**
 * The vocabulary every authoring write and realtime event speaks.
 *
 * Each effect answers "what did this change?" — never "which keys do I know
 * about?". Adding a projection means editing exactly one of these.
 */
export const authoringEffects = {
  /**
   * The shell TREE changed without one specific question being the subject:
   * rows added, removed, reordered, or a draft opened underneath us.
   *
   * `refetchType: "none"` is for writes whose result the caller already applied
   * to the cache (bulk/batch), where an active refetch would race the edit. It
   * applies to every projection in the tree, shell included.
   */
  async shellChanged(
    queryClient: QueryClient,
    examId: string,
    options?: { refetchType?: AuthoringRefetchType }
  ): Promise<void> {
    await invalidateStructure(queryClient, examId, options?.refetchType);
  },

  /**
   * The shell DOCUMENT alone — the tree's rows — and none of the reports
   * derived from them. Always paired by the caller with an explicit
   * `readinessAndReleaseChanged` when those are stale too.
   *
   * This is the projection the realtime reconciler's `invalidateShell` port
   * speaks: "the rows may have moved, re-read them" without asserting anything
   * about readiness or release.
   */
  async shellDocumentChanged(
    queryClient: QueryClient,
    examId: string,
    refetchType?: AuthoringRefetchType
  ): Promise<void> {
    await invalidateShellDocument(queryClient, examId, refetchType);
  },

  /**
   * The reports DERIVED from the tree — the readiness report and the release
   * state — without re-reading the rows.
   *
   * The reconciler's `invalidateReadinessAndRelease` port speaks this, which is
   * why it stays separate from `shellChanged`: a structural event refreshes
   * both reports, while a passive tree touch must not.
   */
  async readinessAndReleaseChanged(
    queryClient: QueryClient,
    examId: string,
    refetchType?: AuthoringRefetchType
  ): Promise<void> {
    await invalidateReadinessAndRelease(queryClient, examId, refetchType);
  },

  /**
   * ONE question's cached detail, and nothing else.
   *
   * For callers that decide the tree's fate themselves — the reconciler's
   * `invalidateQuestion` port refetches the changed question actively while
   * deliberately leaving the shell passive.
   */
  async questionDetailChanged(
    queryClient: QueryClient,
    examQuestionId: string,
    refetchType?: AuthoringRefetchType
  ): Promise<void> {
    await invalidateQuestionDetail(queryClient, examQuestionId, refetchType);
  },

  /**
   * ONE question's cached detail is dropped, and nothing else.
   *
   * The reconciler's `removeQuestionCache` port speaks this for a clean remote
   * delete; the tree is refetched by the caller's own structural effect.
   */
  questionDetailRemoved(queryClient: QueryClient, examQuestionId: string): void {
    removeQuestionDetail(queryClient, examQuestionId);
  },

  /**
   * One question's detail arrived over HTTP and is now the authoritative
   * snapshot for that key (snapshot recovery). A WRITE, not an invalidation:
   * the data is already in hand, and refetching it would be a second read of
   * what the caller just fetched.
   */
  questionDetailLoaded(
    queryClient: QueryClient,
    examQuestionId: string,
    detail: AssessmentQuestionDetail
  ): void {
    queryClient.setQueryData(assessmentKeys.question(examQuestionId), detail);
  },

  /**
   * THIS client saved a revision. The response IS the new truth for two
   * projections, so both are written rather than invalidated:
   *
   *   - the question detail, so the editor's reload sees its own save;
   *   - the summary embedded in the shell tree, re-derived through the same
   *     provider validation the backend enforces, so the queue row's readiness
   *     and answer-key preview move with the edit without a shell refetch.
   *
   * Only the summary for `examQuestionId` is replaced: a save cannot change
   * another row's content or the tree's order, and marking the whole shell
   * stale mid-keystroke is exactly the flicker this layer exists to prevent.
   */
  questionSaved(
    queryClient: QueryClient,
    examId: string,
    examQuestionId: string,
    saved: QuestionRevision
  ): void {
    queryClient.setQueryData<AssessmentAuthoringShellResult>(
      assessmentKeys.shell(examId),
      (current) =>
        current && current.state === "READY" && current.shell
          ? {
              ...current,
              shell: {
                ...current.shell,
                sections: current.shell.sections.map((section) => ({
                  ...section,
                  modules: section.modules.map((module) => ({
                    ...module,
                    questions: module.questions.map((summary) =>
                      summary.examQuestionId === examQuestionId
                        ? summaryFromRevision(summary, saved)
                        : summary
                    ),
                  })),
                })),
              },
            }
          : current
    );
    queryClient.setQueryData<AssessmentQuestionDetail>(
      assessmentKeys.question(examQuestionId),
      (current) => (current ? { ...current, question: saved } : current)
    );
  },

  /**
   * Prefetch one question's detail ahead of selection.
   *
   * The stale-time policy is part of this vocabulary on purpose: the neighbours
   * of the open question are worth one speculative read, but a prefetched
   * detail must still go stale on the same schedule as a fetched one.
   */
  questionPrefetched(
    queryClient: QueryClient,
    examQuestionId: string,
    fetch: () => Promise<AssessmentQuestionDetail>
  ): Promise<void> {
    return queryClient.prefetchQuery({
      queryKey: assessmentKeys.question(examQuestionId),
      queryFn: fetch,
      staleTime: 60_000,
    });
  },

  /** A question's cached detail was removed entirely (deleted, or superseded). */
  async questionRemoved(
    queryClient: QueryClient,
    examId: string,
    examQuestionId: string
  ): Promise<void> {
    authoringEffects.questionDetailRemoved(queryClient, examQuestionId);
    await authoringEffects.shellChanged(queryClient, examId);
  },

  /**
   * THIS client saved delivery settings, and the response carried the new tree.
   *
   * The shell key is therefore already authoritative and is deliberately NOT
   * invalidated — an active refetch here would race the save that just landed.
   * Only the projections derived from it go stale. A delivery change made by
   * ANOTHER client has no fresh tree to install, so that path is `shellChanged`.
   */
  async deliveryChanged(
    queryClient: QueryClient,
    examId: string,
    shell: AssessmentAuthoringShell
  ): Promise<void> {
    setReadyShell(queryClient, examId, shell);
    // Mark readiness stale without an active refetch storm: the page's explicit
    // "Run checks" is the source of truth for validateExam.
    await Promise.allSettled([
      queryClient.invalidateQueries({
        queryKey: assessmentKeys.readinessRoot(examId),
        refetchType: "none",
      }),
      queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) }),
    ]);
  },

  /** Student Access changed: the link projections, its release, and (if named) that link. */
  async accessChanged(
    queryClient: QueryClient,
    examId: string,
    linkId?: string | null
  ): Promise<void> {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: accessLinkKeys.overview(examId) }),
      queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) }),
      ...(linkId
        ? [
            queryClient.invalidateQueries({ queryKey: accessLinkKeys.link(linkId) }),
            queryClient.invalidateQueries({ queryKey: accessLinkKeys.members(linkId) }),
          ]
        : []),
    ]);
  },

  /**
   * A release was published. The working draft is sealed into a version, so the
   * draft shell key is DROPPED (not refetched): the next read must come from the
   * server, and every list/overview that counts releases is stale.
   */
  async published(
    queryClient: QueryClient,
    examId: string,
    releaseState: AssessmentReleaseState
  ): Promise<void> {
    queryClient.setQueryData(assessmentKeys.release(examId), releaseState);
    queryClient.removeQueries({ queryKey: assessmentKeys.shell(examId) });
    await Promise.allSettled([
      // Two exam-list families: the legacy `exams` keys still drive the exam
      // library, and examKeys owns the authoring routes' own list.
      queryClient.invalidateQueries({ queryKey: queryKeys.exams.all }),
      queryClient.invalidateQueries({ queryKey: examKeys.all }),
      queryClient.invalidateQueries({ queryKey: examKeys.detail(examId) }),
      queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) }),
      queryClient.invalidateQueries({ queryKey: accessLinkKeys.overview(examId) }),
    ]);
  },

  /**
   * An editable draft was opened (or returned) by an explicit command.
   *
   * The draft pointer is part of the exam entity, and the collaboration
   * boundary refuses to open a room until the exam says there is a draft to
   * co-edit, so the entity must be refreshed too — otherwise the room stays
   * shut until the cache expires.
   */
  async draftOpened(
    queryClient: QueryClient,
    examId: string,
    shell: AssessmentAuthoringShell
  ): Promise<void> {
    setReadyShell(queryClient, examId, shell);
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: examKeys.detail(examId) }),
      queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) }),
      queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) }),
    ]);
  },

  /**
   * The draft's question set was REPLACED wholesale (workbook import, its undo,
   * or loading the sample). Every cached question detail belongs to the replaced
   * tree, so they are dropped rather than refetched.
   */
  async questionsReplaced(
    queryClient: QueryClient,
    examId: string,
    shell: AssessmentAuthoringShell
  ): Promise<void> {
    setReadyShell(queryClient, examId, shell);
    queryClient.removeQueries({ queryKey: ["assessment-question"] });
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: assessmentKeys.readinessRoot(examId) }),
      queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) }),
    ]);
  },

  /**
   * Make the projections the NEXT route reads fresh BEFORE we unmount.
   *
   * Awaited deliberately by the caller: the preview must not mount on a cached
   * exam detail that is still inside its five-minute staleTime.
   */
  async refreshBeforeRouteChange(queryClient: QueryClient, examId: string): Promise<void> {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: examKeys.detail(examId) }),
      queryClient.invalidateQueries({ queryKey: assessmentKeys.shell(examId) }),
      queryClient.invalidateQueries({ queryKey: assessmentKeys.release(examId) }),
    ]);
  },

  /**
   * A collaborator announced a workspace command.
   *
   * Command payloads name their subject, so the effect is derived from the
   * command instead of the caller guessing at key families.
   */
  async applyWorkspaceCommand(
    queryClient: QueryClient,
    examId: string,
    command: SatWorkspaceCommand
  ): Promise<void> {
    const linkId = typeof command.payload["linkId"] === "string" ? command.payload["linkId"] : null;
    switch (command.command) {
      case "question.created":
      case "question.duplicated":
      case "question.deleted":
      case "question.reordered":
      case "question.bulk_changed":
      case "workbook.imported":
      case "workbook.undone":
      case "sample.loaded":
        await Promise.all([
          invalidateQuestionDetails(queryClient, questionIdsFromCommand(command)),
          invalidateStructure(queryClient, examId),
        ]);
        return;
      case "delivery.changed":
        // A remote delivery change: no fresh tree arrived with it, so the tree
        // itself is what went stale.
        await authoringEffects.shellChanged(queryClient, examId);
        return;
      case "access.created":
      case "access.updated":
      case "access.lifecycle_changed":
      case "access.duplicated":
        await authoringEffects.accessChanged(queryClient, examId, linkId);
        return;
      case "exam.published":
        await Promise.all([
          authoringEffects.shellChanged(queryClient, examId),
          authoringEffects.accessChanged(queryClient, examId),
        ]);
        return;
    }
  },

  /**
   * The collaboration service acknowledged a workspace revision.
   *
   * Rich/scalar co-edited edits have no structural command to relay, so this
   * walks the changed value paths instead. The editors render straight from
   * Yjs, so this is a quiet projection refresh — never a reload, never a source
   * of caret or content flicker.
   */
  async applyWorkspaceAcknowledgement(
    queryClient: QueryClient,
    examId: string,
    values: Record<string, unknown>
  ): Promise<void> {
    const questionIds = new Set<string>();
    let hasDelivery = false;
    let hasAccess = false;
    for (const path of Object.keys(values)) {
      const questionPath = path.startsWith("rich:question/") ? path.slice("rich:".length) : path;
      if (questionPath.startsWith("question/")) {
        const questionId = questionPath.split("/")[1];
        if (questionId) questionIds.add(questionId);
      } else if (path.startsWith("delivery/")) {
        hasDelivery = true;
      } else if (path.startsWith("access/")) {
        hasAccess = true;
      }
    }
    await invalidateQuestionDetails(queryClient, questionIds);
    if (questionIds.size > 0 || hasDelivery) {
      await invalidateStructure(queryClient, examId);
    }
    if (hasAccess) {
      await authoringEffects.accessChanged(queryClient, examId);
    }
  },
};
