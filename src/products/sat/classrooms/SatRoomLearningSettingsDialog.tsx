import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { backendGet, backendPut, hasBackendStatusCode } from "../../../services/backendBridge";
import type { SatActivityPolicy } from "../../../shared/sat/learningPolicy";
import { SatFormDialog } from "../ui/ConfirmDialog";
import { SatButton } from "../ui/SatPage";
import {
  SatLearningSettings,
  SatSettingsScopeNote,
  satLearningSettingsError,
} from "./SatLearningSettings";

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
  const reloadAndDiscard = () => {
    setDraft(null);
    setConflict(false);
    save.reset();
    void query.refetch();
  };

  return (
    <SatFormDialog
      open
      eyebrow="SAT room"
      title="Results and retakes"
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap-reverse items-center justify-end gap-2 px-5 py-3">
          <SatButton variant="quiet" onClick={onClose} disabled={save.isPending}>
            Cancel
          </SatButton>
          <SatButton
            variant="primary"
            disabled={!draft || save.isPending || Boolean(satLearningSettingsError(draft))}
            onClick={() => { if (draft) save.mutate(draft); }}
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </SatButton>
        </div>
      }
    >
      <div className="grid gap-4 px-5 pb-5" aria-busy={query.isPending || undefined}>
        <SatSettingsScopeNote scope="room" title="Applies to this room only">
          Students already in this room see changes within a few seconds. An exam-wide save can update
          these fields later.
        </SatSettingsScopeNote>

        {query.isPending ? (
          <div role="status" className="grid gap-3">
            <p className="text-sm text-[var(--sat-staff-text-secondary,#515154)]">Loading room settings…</p>
            <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
              <div className="h-24 rounded-2xl bg-[var(--sat-staff-surface-raised,#f2f2f4)]" />
              <div className="h-20 rounded-2xl bg-[var(--sat-staff-surface-raised,#f2f2f4)]" />
            </div>
          </div>
        ) : policy ? (
          // Keep the scope visible and the footer reachable on short screens:
          // only the settings cards scroll.
          <div className="max-h-[min(58dvh,560px)] overflow-y-auto overscroll-contain">
            <SatLearningSettings
              heading={false}
              value={policy}
              onChange={setDraft}
              disabled={save.isPending}
            />
          </div>
        ) : null}

        <div aria-live="polite">
          {query.isError || save.isError ? (
            <p role="alert" className="text-sm text-[var(--sat-staff-danger,#d70015)]">
              {(save.error ?? query.error)?.message}
            </p>
          ) : null}
        </div>

        {conflict ? (
          <div
            className="grid gap-2 rounded-xl border border-[var(--sat-staff-danger-border)] bg-[var(--sat-staff-danger-tint)] px-4 py-3"
            data-sat-policy-conflict="room"
          >
            <p className="text-[13px] font-semibold text-[var(--sat-staff-text-primary,#1d1d1f)]">
              Someone else saved this room while you were editing.
            </p>
            <p className="text-[12.5px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
              Your edits are still here. Save them over the latest version, or switch to the latest settings.
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              <SatButton variant="quiet" disabled={save.isPending} onClick={() => void reapply()}>
                Save my changes
              </SatButton>
              <SatButton variant="quiet" disabled={save.isPending} onClick={reloadAndDiscard}>
                Use latest settings
              </SatButton>
            </div>
          </div>
        ) : query.isError ? (
          <div>
            <SatButton variant="quiet" onClick={reloadAndDiscard}>Try again</SatButton>
          </div>
        ) : save.isError ? (
          <div>
            <SatButton variant="quiet" onClick={() => { save.reset(); if (draft) save.mutate(draft); }}>
              Try saving again
            </SatButton>
          </div>
        ) : null}
      </div>
    </SatFormDialog>
  );
}
