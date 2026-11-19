import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { backendGet, backendPut } from "../../../services/backendBridge";
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
  const query = useQuery({
    queryKey: ["sat", "room-learning-settings", scheduleId],
    queryFn: () => backendGet<SatActivityPolicy>(path),
  });
  const save = useMutation({
    mutationFn: (policy: SatActivityPolicy) => backendPut<SatActivityPolicy>(path, {
      ...policy,
      expectedRevision: policy.revision,
    }),
    onSuccess: () => {
      void query.refetch();
      onClose();
    },
  });
  const policy = draft ?? query.data;
  return (
    <SatFormDialog open eyebrow="SAT room" title="Results and retakes" onClose={onClose} footer={
      <SatButton disabled={!draft || save.isPending || Boolean(satLearningSettingsError(draft))}
        onClick={() => { if (draft) save.mutate(draft); }}>
        {save.isPending ? "Saving…" : "Save settings"}
      </SatButton>
    }>
      {policy ? <SatLearningSettings value={policy} onChange={setDraft} disabled={save.isPending} /> : null}
      {query.isPending ? <p role="status">Loading room settings…</p> : null}
      {query.isError || save.isError ? (
        <div className="mt-3 space-y-2">
          <p role="alert">{(save.error ?? query.error)?.message}</p>
          <SatButton variant="quiet" onClick={() => {
            setDraft(null);
            save.reset();
            void query.refetch();
          }}>Reload settings</SatButton>
        </div>
      ) : null}
    </SatFormDialog>
  );
}
