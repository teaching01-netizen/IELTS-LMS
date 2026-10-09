import type { AccessLinkMemberInput, AccessLinkStatus, AssessmentAccessLink } from "../../contracts/accessLinks";

export function studentJoinUrl(linkId: string): string {
  const path = `/join/${encodeURIComponent(linkId)}`;
  return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
}

/**
 * The one student entry URL for a room. Access-backed rooms use their link
 * (/join/:linkId, where admission policy is checked up front); rooms without a
 * known link fall back to the schedule entry (/student/:scheduleId).
 */
export function roomEntryUrl(room: { accessLinkId?: string | null; scheduleId: string }): string {
  if (room.accessLinkId) return studentJoinUrl(room.accessLinkId);
  const path = `/student/${encodeURIComponent(room.scheduleId)}`;
  return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
}

export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === "undefined") throw new Error("Clipboard is unavailable.");
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard copy was rejected.");
  } finally {
    textarea.remove();
  }
}

export function formatAccessLinkStatus(status: AccessLinkStatus): string {
  switch (status) {
    case "live": return "Check-in open";
    case "upcoming": return "Check-in opens later";
    case "ended": return "Check-in closed";
    case "paused": return "Check-in paused";
    case "revoked": return "Check-in revoked";
  }
}

export function accessLinkStatusDescription(link: AssessmentAccessLink, now = new Date()): string {
  if (link.status === "paused") return "Student check-in is temporarily disabled. Students already in the exam are not affected.";
  if (link.status === "revoked") return "This link can no longer be used.";
  if (link.availabilityType === "anytime") return "Check-in stays open until the link is paused or revoked.";
  const opens = link.opensAt ? new Date(link.opensAt) : null;
  const closes = link.closesAt ? new Date(link.closesAt) : null;
  if (link.status === "upcoming" && opens) return `Opens ${formatCompactDateTime(opens, now)}.`;
  if (link.status === "ended" && closes) return `Closed ${formatCompactDateTime(closes, now)}.`;
  if (link.status === "live" && closes) return `Closes ${formatCompactDateTime(closes, now)}.`;
  return "Availability follows this room's check-in settings.";
}

/**
 * Who a session admits. A group label is only a name: it never implies a restriction,
 * so the restriction ("Listed students") is stated by the audience, not the label.
 */
export function describeAccessLinkAudience(link: Pick<AssessmentAccessLink, "audienceType" | "audienceLabel" | "selectedStudentCount">): string {
  const label = link.audienceLabel?.trim();
  if (link.audienceType === "selected_students") {
    const count = `${link.selectedStudentCount} ${link.selectedStudentCount === 1 ? "student" : "students"}`;
    return label ? `Listed students · ${count} · ${label}` : `Listed students · ${count}`;
  }
  return label ? `Anyone with link · ${label}` : "Anyone with link";
}

/** Map a link lifecycle status to the shared Calm Ops Bento pill tone. Single mapping — rows and detail must reuse this. */
export function accessLinkStatusTone(status: AccessLinkStatus): "live" | "ready" | "paused" | "finished" | "invalidated" {
  switch (status) {
    case "live": return "live";
    case "upcoming": return "ready";
    case "paused": return "paused";
    case "ended": return "finished";
    case "revoked": return "invalidated";
  }
}

export function shouldPulseAccessLinkStatus(_status: AccessLinkStatus): boolean {
  return false;
}

export function formatCompactDateTime(date: Date, now = new Date()): string {
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  return new Intl.DateTimeFormat(undefined, sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
  ).format(date);
}

export function toLocalDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function localDateTimeToIso(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      values.push(value.trim());
      value = "";
      continue;
    }
    value += char;
  }
  if (quoted) throw new Error("A selected-student row contains an unclosed quote.");
  values.push(value.trim());
  return values;
}

export function parseAccessLinkMembers(source: string): AccessLinkMemberInput[] {
  const rows = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const seen = new Set<string>();
  return rows.map((line, index) => {
    const [studentCode = "", studentName = "", studentEmail = "", ...extra] = parseCsvLine(line);
    if (extra.length) throw new Error(`Row ${index + 1} has more than three columns.`);
    const normalizedCode = studentCode.trim();
    if (!normalizedCode) throw new Error(`Row ${index + 1} needs a student code.`);
    const key = normalizedCode.toLocaleLowerCase();
    if (seen.has(key)) throw new Error(`Student code ${normalizedCode} appears more than once.`);
    seen.add(key);
    const email = studentEmail.trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error(`Row ${index + 1} has an invalid email address.`);
    }
    return {
      studentCode: normalizedCode,
      ...(studentName.trim() ? { studentName: studentName.trim() } : {}),
      ...(email ? { studentEmail: email.toLocaleLowerCase() } : {}),
    };
  });
}

export function serializeAccessLinkMembers(members: readonly AccessLinkMemberInput[]): string {
  const escape = (value: string) => /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return members.map((member) => [member.studentCode, member.studentName ?? "", member.studentEmail ?? ""].map(escape).join(", ")).join("\n");
}
