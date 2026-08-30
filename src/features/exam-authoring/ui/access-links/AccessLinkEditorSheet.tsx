import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Clock3, Link2, LockKeyhole, Users, X } from "lucide-react";
import type {
  AccessLinkAudienceType,
  AccessLinkAvailabilityType,
  AccessLinkMemberInput,
  AccessLinkMode,
  AssessmentAccessLink,
  CreateAssessmentAccessLinkRequest,
  UpdateAssessmentAccessLinkRequest,
} from "../../contracts/accessLinks";
import { localDateTimeToIso, parseAccessLinkMembers, serializeAccessLinkMembers, toLocalDateTimeInput } from "./accessLinkUi";

interface AccessLinkEditorSheetProps {
  open: boolean;
  link: AssessmentAccessLink | null;
  members: readonly AccessLinkMemberInput[];
  isSaving: boolean;
  onClose: () => void;
  onCreate: (request: CreateAssessmentAccessLinkRequest) => Promise<void>;
  onUpdate: (linkId: string, request: UpdateAssessmentAccessLinkRequest) => Promise<void>;
}

function defaultScheduledWindow(): { opensAt: string; closesAt: string } {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
  return { opensAt: toLocalDateTimeInput(start.toISOString()), closesAt: toLocalDateTimeInput(end.toISOString()) };
}

export function AccessLinkEditorSheet(props: AccessLinkEditorSheetProps) {
  const defaults = useMemo(defaultScheduledWindow, []);
  const [name, setName] = useState("");
  const [audienceType, setAudienceType] = useState<AccessLinkAudienceType>("anyone");
  const [audienceLabel, setAudienceLabel] = useState("");
  const [accessMode, setAccessMode] = useState<AccessLinkMode>("student_code");
  const [availabilityType, setAvailabilityType] = useState<AccessLinkAvailabilityType>("scheduled");
  const [opensAt, setOpensAt] = useState(defaults.opensAt);
  const [closesAt, setClosesAt] = useState(defaults.closesAt);
  const [membersSource, setMembersSource] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    const link = props.link;
    setName(link?.name ?? "");
    setAudienceType(link?.audienceType ?? "anyone");
    setAudienceLabel(link?.audienceLabel ?? "");
    setAccessMode(link?.accessMode ?? "student_code");
    setAvailabilityType(link?.availabilityType ?? "scheduled");
    setOpensAt(link?.availabilityType === "scheduled" ? toLocalDateTimeInput(link.opensAt) : defaults.opensAt);
    setClosesAt(link?.availabilityType === "scheduled" ? toLocalDateTimeInput(link.closesAt) : defaults.closesAt);
    setMembersSource(serializeAccessLinkMembers(props.members));
    setError(null);
  }, [defaults.closesAt, defaults.opensAt, props.link, props.members, props.open]);

  const submit = async () => {
    setError(null);
    const normalizedName = name.trim();
    if (!normalizedName) return setError("Give this Student Link a name people will recognize.");
    if ((audienceType === "cohort" || audienceType === "selected_students") && !audienceLabel.trim()) {
      return setError("Add an audience name for this link.");
    }
    let selectedStudents: AccessLinkMemberInput[] = [];
    if (audienceType === "selected_students") {
      try {
        selectedStudents = parseAccessLinkMembers(membersSource);
      } catch (parseError) {
        return setError(parseError instanceof Error ? parseError.message : "Selected students could not be read.");
      }
      if (!selectedStudents.length) return setError("Add at least one selected student.");
    }
    const scheduledOpensAt = availabilityType === "scheduled" ? localDateTimeToIso(opensAt) : null;
    const scheduledClosesAt = availabilityType === "scheduled" ? localDateTimeToIso(closesAt) : null;
    if (availabilityType === "scheduled") {
      if (!scheduledOpensAt || !scheduledClosesAt) return setError("Choose both an opening and closing time.");
      if (new Date(scheduledClosesAt) <= new Date(scheduledOpensAt)) return setError("Closing time must be after opening time.");
    }
    const shared = {
      name: normalizedName,
      audienceType,
      ...(audienceLabel.trim() ? { audienceLabel: audienceLabel.trim() } : { audienceLabel: null }),
      accessMode: audienceType === "selected_students" ? "student_code" as const : accessMode,
      availabilityType,
      ...(availabilityType === "scheduled"
        ? { opensAt: scheduledOpensAt, closesAt: scheduledClosesAt }
        : { opensAt: null, closesAt: null }),
    };
    try {
      if (props.link) {
        await props.onUpdate(props.link.id, {
          revision: props.link.revision,
          ...shared,
          selectedStudents,
        });
      } else {
        await props.onCreate({
          ...shared,
          selectedStudents,
        });
      }
      props.onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Student Link could not be saved.");
    }
  };

  return (
    <AnimatePresence>
      {props.open ? (
        <motion.div className="fixed inset-0 z-[100] flex justify-end bg-black/20 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget && !props.isSaving) props.onClose(); }}>
          <motion.section role="dialog" aria-modal="true" aria-labelledby="access-link-editor-title" initial={{ x: 30, opacity: 0.8 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 30, opacity: 0 }} transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }} className="flex h-full w-full max-w-[520px] flex-col border-l border-black/[0.08] bg-[#f5f5f7] shadow-[-20px_0_70px_rgba(0,0,0,0.12)]">
            <header className="flex items-center gap-3 border-b border-black/[0.06] bg-white/88 px-5 py-4 backdrop-blur-2xl">
              <div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-slate-400">Digital SAT · Current release</p><h2 id="access-link-editor-title" className="mt-0.5 text-lg font-semibold tracking-[-0.02em] text-slate-950">{props.link ? "Edit Student Link" : "Create Student Link"}</h2></div>
              <button type="button" onClick={props.onClose} disabled={props.isSaving} aria-label="Close Student Link editor" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-black/[0.05] disabled:opacity-40"><X size={16}/></button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="space-y-5">
                <Field label="Name" description="Use the name staff will recognize when sharing or monitoring this link."><input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} aria-label="Student Link name" className={inputClass} placeholder="Saturday Class — September" /></Field>
                <Field label="Who is this for?">
                  <div className="grid grid-cols-3 gap-2">
                    <Choice active={audienceType === "anyone"} onClick={() => setAudienceType("anyone")} icon={<Link2 size={15}/>} title="Anyone" subtitle="With the link" />
                    <Choice active={audienceType === "cohort"} onClick={() => setAudienceType("cohort")} icon={<Users size={15}/>} title="Cohort" subtitle="Named group" />
                    <Choice active={audienceType === "selected_students"} onClick={() => { setAudienceType("selected_students"); setAccessMode("student_code"); }} icon={<LockKeyhole size={15}/>} title="Selected" subtitle="Allowlist" />
                  </div>
                  {audienceType !== "anyone" ? <input aria-label="Audience name" value={audienceLabel} onChange={(event) => setAudienceLabel(event.target.value)} className={`${inputClass} mt-2`} placeholder={audienceType === "cohort" ? "SAT September · Saturday" : "Scholarship Students"} /> : null}
                </Field>
                <Field label="Student identification" description={audienceType === "selected_students" ? "Selected-student links always require the allowlisted student code." : "Choose how this link identifies a student."}>
                  <div className="authoring-segmented flex w-full rounded-xl p-1">
                    <Segment active={accessMode === "student_code"} onClick={() => setAccessMode("student_code")}>Require student code</Segment>
                    <Segment active={accessMode === "open"} disabled={audienceType === "selected_students"} onClick={() => setAccessMode("open")}>Name + email only</Segment>
                  </div>
                </Field>
                {audienceType === "selected_students" ? <Field label="Selected students" description="One student per line: code, name, email. Name and email are optional; code is required."><textarea aria-label="Selected students" value={membersSource} onChange={(event) => setMembersSource(event.target.value)} spellCheck={false} className="min-h-36 w-full resize-y rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 font-mono text-[11px] leading-5 outline-none focus:border-[#0071e3]/35 focus:ring-4 focus:ring-[#0071e3]/10" placeholder={'W123456, Jane Doe, jane@example.com\nW123457, John Doe, john@example.com'} /></Field> : null}
                <Field label="When can students enter?">
                  <div className="grid grid-cols-2 gap-2">
                    <Choice active={availabilityType === "scheduled"} onClick={() => setAvailabilityType("scheduled")} icon={<Clock3 size={15}/>} title="Scheduled" subtitle="Set a window" />
                    <Choice active={availabilityType === "anytime"} onClick={() => setAvailabilityType("anytime")} icon={<Link2 size={15}/>} title="Anytime" subtitle="While active" />
                  </div>
                  {availabilityType === "scheduled" ? <div className="mt-2 grid grid-cols-2 gap-2"><label htmlFor="access-link-opens-at" className="text-[10px] font-medium text-slate-500">Opens<input id="access-link-opens-at" aria-label="Opens" type="datetime-local" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} className={`${inputClass} mt-1`} /></label><label htmlFor="access-link-closes-at" className="text-[10px] font-medium text-slate-500">Closes<input id="access-link-closes-at" aria-label="Closes" type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} className={`${inputClass} mt-1`} /></label></div> : <div className="mt-2 rounded-xl bg-white px-3 py-3 text-[11px] leading-5 text-slate-500">Students can enter whenever this link is Active. Pause or revoke it at any time without changing the published exam.</div>}
                </Field>
              </div>
            </div>
            <footer className="border-t border-black/[0.06] bg-white/92 px-5 py-4 backdrop-blur-xl">
              {error ? <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-medium text-red-700">{error}</p> : null}
              <div className="flex justify-end gap-2"><button type="button" onClick={props.onClose} disabled={props.isSaving} className="min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-600 hover:bg-black/[0.04]">Cancel</button><button type="button" onClick={() => void submit()} disabled={props.isSaving} className="min-h-11 rounded-xl bg-[#0071e3] px-5 text-sm font-semibold text-white hover:bg-[#0077ed] disabled:opacity-45">{props.isSaving ? "Saving…" : props.link ? "Save Changes" : "Create Link"}</button></div>
            </footer>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

const inputClass = "h-11 w-full rounded-xl border border-black/[0.08] bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0071e3]/35 focus:ring-4 focus:ring-[#0071e3]/10";
function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) { return <section><div className="mb-2"><h3 className="text-[12px] font-semibold text-slate-800">{label}</h3>{description ? <p className="mt-0.5 text-[10px] leading-4 text-slate-400">{description}</p> : null}</div>{children}</section>; }
function Choice({ active, onClick, icon, title, subtitle }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; subtitle: string }) { return <button type="button" aria-pressed={active} onClick={onClick} className={`min-h-[68px] rounded-xl border p-2.5 text-left transition ${active ? "border-[#0071e3]/35 bg-[#0071e3]/[0.055] text-[#0066cc]" : "border-black/[0.07] bg-white text-slate-600 hover:bg-black/[0.02]"}`}><span className="flex items-center gap-1.5 text-[11px] font-semibold">{icon}{title}</span><span className="mt-1 block text-[9px] font-medium text-slate-400">{subtitle}</span></button>; }
function Segment({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" disabled={disabled} aria-pressed={active} onClick={onClick} className={`min-h-9 flex-1 rounded-lg px-2 text-[10px] font-semibold transition ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"} disabled:opacity-35`}>{children}</button>; }
