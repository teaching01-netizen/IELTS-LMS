import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { backendGet, backendPut, hasBackendStatusCode } from "../../../services/backendBridge";
import type { SatActivityPolicy } from "../../../shared/sat/learningPolicy";
import { SatFormDialog } from "../ui/ConfirmDialog";
import { SatButton } from "../ui/SatPage";
import { SatLearningSettings, satLearningSettingsError } from "./SatLearningSettings";

export function SatRoomLearningSettingsDialog({ scheduleId, onClose }: {
  scheduleId: string;
  onClose: () => void;
}) {
  const path = `/v1/schedules/${encodeURIComponent(scheduleId)}/sat-learning-settings`;
  const [draft, setDraft] = useState<SatActivityPolicy | null>(null);
  const [conflict, setConflict] = useState(false);
  const query = useQuery({
    queryKey: ["sat", "room-learning-settings", scheduleId],
    queryFn: () => backendGet<SatActivityPolicy>(path),
    // The dialog can stay open while another editor saves; foreground entry
    // and the cadence below refresh the effective values without a reload.
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });
  const save = useMutation({
    mutationFn: (policy: SatActivityPolicy) => backendPut<SatActivityPolicy>(path, {
      ...policy,
      expectedRevision: policy.revision,
    }),
    onSuccess: () => {
      setConflict(false);
      void query.refetch();
      onClose();
    },
    onError: (cause) => setConflict(hasBackendStatusCode(cause, 409)),
  });
  const policy = draft ?? query.data;
  const reapply = async () => {
    if (!draft) return;
    const latest = await query.refetch();
    const revision = latest.data?.revision;
    if (revision === undefined) return;
    const next = { ...draft, revision };
    setDraft(next);
    save.mutate(next);
  };
  return (
    <SatFormDialog open eyebrow="SAT room" title="Results and retakes" onClose={onClose} footer={
      <SatButton disabled={!draft || save.isPending || Boolean(satLearningSettingsError(draft))}
        onClick={() => { if (draft) save.mutate(draft); }}>
        {save.isPending ? "Saving…" : "Save settings"}
      </SatButton>
    }>
      {policy ? <SatLearningSettings value={policy} onChange={setDraft} disabled={save.isPending} /> : null}
      <p className="mt-3 text-sm text-[var(--sat-text-secondary)]" data-sat-policy-scope="room">
        These settings apply to this room only. An exam-wide save can change the same fields later; this
        room keeps the other values chosen here.
      </p>
      {query.isPending ? <p role="status">Loading room settings…</p> : null}
      <div aria-live="polite">
        {query.isError || save.isError ? (
          <p role="alert" className="mt-3">
            {(save.error ?? query.error)?.message}
          </p>
        ) : null}
      </div>
      {conflict || query.isError || save.isError ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {conflict ? (
            <>
              <SatButton variant="quiet" disabled={save.isPending} onClick={() => void reapply()}>
                Reapply my changes
              </SatButton>
              <SatButton variant="quiet" disabled={save.isPending} onClick={() => {
                setDraft(null);
                setConflict(false);
                save.reset();
                void query.refetch();
              }}>
                Reload and discard
              </SatButton>
            </>
          ) : (
            <SatButton variant="quiet" onClick={() => {
              setDraft(null);
              setConflict(false);
              save.reset();
              void query.refetch();
            }}>Reload settings</SatButton>
          )}
        </div>
      ) : null}
    </SatFormDialog>
  );
}
