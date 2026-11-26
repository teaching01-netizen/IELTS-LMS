import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SatButton } from "../../../../products/sat/ui/SatPage";
import { wordCountLabel as words } from "@shared/sat/wordVault";
import { assessmentKeys, authoringEffects } from "../../api/authoringQueryEffects";
import { wordVaultApi } from "../../api/wordVaultApi";
import { WordVaultImportSheet } from "../../import/WordVaultImportSheet";
import { releaseSurfaceClass } from "../release/releaseUi";

/**
 * The Word Vault panel on exam Settings.
 *
 * The import itself lives where authors already edit the draft (the Questions
 * workspace Import menu, beside the exam workbook import); this panel is the
 * exam-level STATUS surface: draft and published counts, stale references, and
 * the destination a `sat.word_vault.stale` publish finding opens. It keeps its
 * own import button because that finding must be fixable in place, and both
 * buttons open the same sheet.
 */
export function WordVaultSettings({ examId, canEdit, onEditExam }: {
  examId: string;
  canEdit: boolean;
  onEditExam: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const cacheKey = assessmentKeys.wordVault(examId);
  const status = useQuery({ queryKey: cacheKey, queryFn: () => wordVaultApi.status(examId), retry: false });
  const data = status.data;

  return (
    <section id="sat-settings-word-vault" tabIndex={-1} aria-labelledby="sat-word-vault-title" className={releaseSurfaceClass + " space-y-3 p-5 sm:p-6"}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="sat-word-vault-title" className="font-semibold">The Word Vault</h3>
          <p className="mt-1 text-sm text-muted-foreground">Vocabulary from the published exam version appears at the end of the student’s score-report PDF.</p>
          {data ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {data.draftId ? `Draft · ${words(data.draftCount)}. ` : "No editable draft. "}
              Published · {words(data.publishedCount)}.
            </p>
          ) : null}
        </div>
        {canEdit && data?.draftId ? <SatButton variant="secondary" onClick={() => setOpen(true)}>Import Vocabulary Excel</SatButton> : null}
        {canEdit && data && !data.draftId ? <SatButton variant="secondary" onClick={onEditExam}>Open an editable draft</SatButton> : null}
      </div>
      {status.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading vocabulary…</p> : null}
      {status.isError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-au-danger-text" role="alert">Couldn’t load vocabulary.</p>
          <SatButton variant="secondary" onClick={() => void status.refetch()}>Retry</SatButton>
        </div>
      ) : null}
      {data && data.staleCount > 0 ? (
        <p className="text-sm text-au-warning-text">{words(data.staleCount)} refer to changed questions. Import a corrected workbook before publishing.</p>
      ) : null}
      <p role="status" className={saved === null ? "sr-only" : "text-sm text-au-success-text"}>
        {saved === null ? "" : saved === 0 ? "Draft vocabulary removed." : `${words(saved)} saved to the draft.`}
      </p>
      {open ? (
        <WordVaultImportSheet
          open
          examId={examId}
          onClose={() => setOpen(false)}
          onSaved={(count) => {
            setSaved(count);
            setOpen(false);
            void queryClient.invalidateQueries({ queryKey: cacheKey });
            void authoringEffects.shellChanged(queryClient, examId);
          }}
        />
      ) : null}
    </section>
  );
}
