import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AuthoringPresence } from "../../../realtime/presenceTypes";
import {
  CONNECTION_COPY,
  FORBIDDEN_COPY_FRAGMENTS,
  SAVE_CONFLICT_COPY,
  connectionCopyFor,
  copyLeaksTransportDetail,
  saveBlockedCopy,
  saveStatusCopy,
} from "../../../realtime/connectionCopy";
import { classifyQuestionFields } from "../../../realtime/threeWayCompare";
import { makeRevision } from "../../../realtime/__tests__/divergenceFixtures";
import { CollaboratorStack } from "../CollaboratorStack";
import type { CollaborationParticipant } from "../collaborationParticipants";
import { ConflictResolver } from "../ConflictResolver";
import { QuestionPresenceBadge } from "../QuestionPresenceBadge";
import { RemoteUpdateNotice } from "../RemoteUpdateNotice";
import {
  CONFLICT_COPY,
  DELETION_COPY,
  FIELD_LABELS,
  PRESENCE_COPY,
  PUBLISH_COPY,
  REMOTE_UPDATE_COPY,
  STRUCTURAL_COPY,
  fieldFateLine,
} from "../collaborationCopy";

function presence(overrides: Partial<AuthoringPresence> = {}): AuthoringPresence {
  return {
    connectionId: "ap-1",
    userId: "user-alice",
    displayName: "Alice",
    examId: "exam-1",
    draftVersionId: "draft-7",
    selectedQuestionId: "eq-1",
    state: "viewing",
    lastSeenAt: "2026-09-13T12:00:00.000Z",
    ...overrides,
  };
}

describe("RemoteUpdateNotice (calm banner)", () => {
  it("shows the exact headline, the mandatory safety phrase, and Review", () => {
    render(
      <RemoteUpdateNotice
        remoteAuthorName="Alice"
        questionLabel="Q14"
        onReview={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const banner = screen.getByTestId("remote-update-notice");
    expect(banner.textContent).toContain(REMOTE_UPDATE_COPY.headline);
    expect(banner.textContent).toContain("Your changes are safe");
    expect(banner.textContent).toContain("Your changes are preserved.");
    expect(within(banner).getByRole("button", { name: REMOTE_UPDATE_COPY.review })).toBeTruthy();
  });

  it("is a non-modal status region, never a dialog, and offers no destructive action inline", () => {
    render(<RemoteUpdateNotice remoteAuthorName="Alice" onReview={vi.fn()} />);
    const banner = screen.getByTestId("remote-update-notice");
    expect(banner.getAttribute("role")).toBe("status");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // `Use latest` is deliberately one click deeper (inside Review).
    expect(within(banner).queryByText(CONFLICT_COPY.useLatest)).toBeNull();
  });

  it("uses the neutral wording when the author is unknown", () => {
    render(<RemoteUpdateNotice remoteAuthorName={null} onReview={vi.fn()} />);
    expect(screen.getByTestId("remote-update-notice").textContent).toContain(
      REMOTE_UPDATE_COPY.headline,
    );
    expect(screen.getByTestId("remote-update-notice").textContent).not.toContain(
      "Another author saved",
    );
  });

  it("wires Review and dismiss to their handlers", () => {
    const onReview = vi.fn();
    const onDismiss = vi.fn();
    render(<RemoteUpdateNotice remoteAuthorName="Alice" onReview={onReview} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: REMOTE_UPDATE_COPY.review }));
    expect(onReview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: REMOTE_UPDATE_COPY.dismissLabel }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps a 40-48px single-line reserved row so the editor never shifts", () => {
    render(<RemoteUpdateNotice remoteAuthorName="Alice" onReview={vi.fn()} />);
    const classes = screen.getByTestId("remote-update-notice").className;
    expect(classes).toContain("min-h-11");
    expect(classes).toContain("items-center");
  });

  it("never uses the reserved word 'conflict' for a possibly-disjoint divergence", () => {
    render(<RemoteUpdateNotice remoteAuthorName="Alice" onReview={vi.fn()} />);
    expect(
      screen.getByTestId("remote-update-notice").textContent?.toLowerCase(),
    ).not.toContain("conflict");
  });
});

describe("ConflictResolver (review sheet)", () => {
  const base = makeRevision();
  const local = { ...base, prompt: { type: "doc", content: [{ text: "mine" }] } } as ReturnType<
    typeof makeRevision
  >;
  const remote = { ...base, revision: 9, rationale: { type: "doc", content: [{ text: "theirs" }] } } as ReturnType<
    typeof makeRevision
  >;
  const classifications = classifyQuestionFields({ base, local, remote });

  function renderSheet(overrides: Record<string, unknown> = {}) {
    const handlers = {
      onUseLatest: vi.fn(),
      onKeepEditing: vi.fn(),
      onCopyLocal: vi.fn(),
      onClose: vi.fn(),
    };
    render(
      <ConflictResolver
        open
        base={base}
        local={local}
        remote={remote}
        classifications={classifications}
        remoteAuthorName="Alice"
        {...handlers}
        {...overrides}
      />,
    );
    return handlers;
  }

  it("renders one text-labelled row per field slice, in the fixed order", () => {
    renderSheet();
    const fields = Object.keys(FIELD_LABELS);
    let previous = -1;
    for (const field of fields) {
      const row = screen.getByTestId(`compare-row-${field}`);
      expect(row.textContent).toContain(FIELD_LABELS[field as keyof typeof FIELD_LABELS]);
      // Text + fate line, never colour-only.
      const position = screen.getByTestId("conflict-resolver").textContent!.indexOf(row.textContent!);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
  });

  it("describes fates in human language rather than jargon", () => {
    renderSheet();
    expect(screen.getByTestId("compare-row-prompt").textContent).toContain(
      fieldFateLine("local-only", "Alice"),
    );
    expect(screen.getByTestId("compare-row-rationale").textContent).toContain(
      fieldFateLine("remote-only", "Alice"),
    );
  });

  it("uses neutral amber, never the destructive palette, for a same-field conflict", () => {
    const conflicted = classifyQuestionFields({
      base,
      local,
      remote: { ...base, revision: 9, prompt: { type: "doc", content: [{ text: "theirs" }] } } as ReturnType<
        typeof makeRevision
      >,
    });
    renderSheet({ classifications: conflicted });
    const row = screen.getByTestId("compare-row-prompt");
    expect(row.getAttribute("data-fate")).toBe("conflict");
    expect(row.className).toContain("amber");
    expect(row.className).not.toContain("destructive");
    expect(row.className).not.toContain("red");
    // The word "conflict" IS correct here: both sides changed the same field.
    expect(screen.getByTestId("conflict-resolver").textContent).toContain(
      CONFLICT_COPY.conflictHeading,
    );
    expect(within(row).getByRole("button", { name: "Use Alice's" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Keep mine" })).toBeTruthy();
  });

  it("offers no inline destructive action on a NON-conflicting row", () => {
    renderSheet();
    const row = screen.getByTestId("compare-row-rationale");
    expect(within(row).queryByRole("button", { name: "Use Alice's" })).toBeNull();
  });

  it("passes the CURRENT remote revision on Use latest, not the mount snapshot", () => {
    const handlers = renderSheet();
    const refreshed = { ...remote, revision: 11 } as ReturnType<typeof makeRevision>;
    // Re-render with a newer remote, as the parent does after a fresh fetch.
    render(
      <ConflictResolver
        open
        base={base}
        local={local}
        remote={refreshed}
        classifications={classifications}
        remoteAuthorName="Alice"
        onUseLatest={handlers.onUseLatest}
        onKeepEditing={handlers.onKeepEditing}
        onCopyLocal={handlers.onCopyLocal}
        onClose={handlers.onClose}
      />,
    );
    const sheets = screen.getAllByTestId("conflict-resolver");
    fireEvent.click(within(sheets[sheets.length - 1]!).getByRole("button", { name: CONFLICT_COPY.useLatest }));
    expect(handlers.onUseLatest).toHaveBeenCalledWith(refreshed);
  });

  it("keeps the wholesale footer actions and never invents a partial-write path", () => {
    renderSheet();
    const sheet = screen.getByTestId("conflict-resolver");
    for (const action of [CONFLICT_COPY.useLatest, CONFLICT_COPY.keepEditing, CONFLICT_COPY.copyMyWork]) {
      expect(within(sheet).getAllByRole("button", { name: action }).length).toBeGreaterThan(0);
    }
    expect(sheet.textContent).not.toContain("Merge");
    expect(sheet.textContent).not.toContain("Apply selected");
  });

  it("reveals the read-only diff only on demand", () => {
    renderSheet();
    expect(screen.queryByTestId("compare-detail-prompt")).toBeNull();
    fireEvent.click(within(screen.getByTestId("compare-row-prompt")).getByRole("button", { name: /Details/ }));
    expect(screen.getByTestId("compare-detail-prompt")).toBeTruthy();
  });

  it("disables Use latest once the question was deleted remotely", () => {
    renderSheet({ deletedRemotely: true });
    const sheet = screen.getByTestId("conflict-resolver");
    expect(sheet.textContent).toContain("was deleted by Alice");
    expect(sheet.textContent).toContain("preserved on this device");
    expect(
      (within(sheet).getByRole("button", { name: CONFLICT_COPY.useLatest }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("closes on Escape", () => {
    const handlers = renderSheet();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(handlers.onClose).toHaveBeenCalled();
  });
});

describe("QuestionPresenceBadge (rail radar)", () => {
  it("renders nothing when nobody is on the row", () => {
    const { container } = render(<QuestionPresenceBadge occupants={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows initials plus an overflow count, with a text label for the state", () => {
    render(
      <QuestionPresenceBadge
        occupants={[
          presence({ connectionId: "a", displayName: "Alice", state: "editing" }),
          presence({ connectionId: "b", displayName: "Bob" }),
          presence({ connectionId: "c", displayName: "Ben" }),
        ]}
      />,
    );
    const badge = screen.getByTestId("question-presence-badge");
    expect(badge.textContent).toContain("AL");
    expect(badge.textContent).toContain("BO");
    expect(badge.textContent).toContain("+1");
    // Text identity, not colour-only: the accessible name names people + state.
    expect(badge.getAttribute("aria-label")).toBe(
      PRESENCE_COPY.badgeLabel("Alice, Bob, Ben", true),
    );
  });

  it("is not a live region, so presence churn never announces", () => {
    render(<QuestionPresenceBadge occupants={[presence({ displayName: "Alice" })]} />);
    const badge = screen.getByTestId("question-presence-badge");
    expect(badge.getAttribute("role")).toBeNull();
    expect(badge.getAttribute("aria-live")).toBeNull();
  });

  it("falls back to a neutral name instead of a raw user id", () => {
    render(
      <QuestionPresenceBadge
        occupants={[presence({ displayName: "", userId: "user-secret" })]}
      />,
    );
    const badge = screen.getByTestId("question-presence-badge");
    expect(badge.getAttribute("aria-label")).toContain("Another author");
    expect(badge.getAttribute("aria-label")).not.toContain("user-secret");
  });
});

describe("CollaboratorStack (WHO)", () => {
  it("caps the visible avatars and exposes the rest through the popover", () => {
    const occupants = Array.from({ length: 7 }, (_, index) =>
      presence({ connectionId: `ap-${index}`, displayName: `Person ${index}` }),
    );
    render(<CollaboratorStack occupants={occupants} />);
    const stack = screen.getByTestId("collaborator-stack");
    expect(stack.querySelectorAll("[data-presence-state]")).toHaveLength(4);
    fireEvent.click(within(stack).getByRole("button", { name: PRESENCE_COPY.overflow(3) }));
    expect(screen.getByTestId("collaborator-popover")).toBeTruthy();
  });

  it("renders nothing when the room is empty", () => {
    const { container } = render(<CollaboratorStack occupants={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("uses the co-edit roster with self included, three visible avatars, and no permanent WHO control", () => {
    const participants: CollaborationParticipant[] = [
      { id: "self", displayName: "You", initials: "YO", color: "#2563EB", state: "editing", isSelf: true },
      { id: "alice", displayName: "Alice", initials: "AL", color: "#7C3AED", state: "editing", isSelf: false },
      { id: "bob", displayName: "Bob", initials: "BO", color: "#DB2777", state: "idle", isSelf: false },
      { id: "cam", displayName: "Cam", initials: "CA", color: "#0891B2", state: "viewing", isSelf: false },
    ];
    render(<CollaboratorStack participants={participants} />);
    const stack = screen.getByTestId("collaborator-stack");
    expect(stack.querySelectorAll("[data-presence-state]")).toHaveLength(3);
    expect(within(stack).getByRole("button", { name: PRESENCE_COPY.overflow(1) })).toBeInTheDocument();
    expect(within(stack).queryByText("Who's here")).toBeNull();

    fireEvent.click(within(stack).getByRole("button", { name: PRESENCE_COPY.overflow(1) }));
    expect(screen.getByRole("heading", { name: PRESENCE_COPY.editingNow })).toBeInTheDocument();
    expect(screen.getByTestId("collaborator-popover")).toHaveTextContent("You");
  });

  it("opens Editing now from the avatar stack when there is no overflow", () => {
    render(
      <CollaboratorStack
        participants={[
          { id: "self", displayName: "You", initials: "YO", color: "#2563EB", state: "editing", isSelf: true },
          { id: "alice", displayName: "Alice", initials: "AL", color: "#7C3AED", state: "editing", isSelf: false },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: PRESENCE_COPY.editingNow }));
    expect(screen.getByRole("heading", { name: PRESENCE_COPY.editingNow })).toBeInTheDocument();
  });
});

describe("copy is the single source of truth", () => {
  it("uses the exact required connection strings", () => {
    expect(CONNECTION_COPY.saved).toBe("Saved");
    expect(CONNECTION_COPY.reconnecting).toBe("Reconnecting");
    expect(CONNECTION_COPY.offline).toBe("Offline - saved on this device");
    expect(CONNECTION_COPY.newerVersionAvailable).toBe("Newer version available");
  });

  it("prefers the divergence copy over the raw save status", () => {
    expect(saveStatusCopy({ status: "unsaved", diverged: true })).toBe(
      CONNECTION_COPY.newerVersionAvailable,
    );
    expect(saveStatusCopy({ status: "saved", diverged: false })).toBe("Saved");
    expect(saveStatusCopy({ status: "offline", diverged: false })).toBe(CONNECTION_COPY.offline);
  });

  it("only reports a connection problem while actually reconnecting", () => {
    expect(connectionCopyFor("reconnecting")).toBe(CONNECTION_COPY.reconnecting);
    expect(connectionCopyFor("connecting")).toBe(CONNECTION_COPY.reconnecting);
    // degraded-http is not a user-facing state: HTTP editing simply works.
    expect(connectionCopyFor("degraded-http")).toBeNull();
    expect(connectionCopyFor("live")).toBeNull();
    expect(connectionCopyFor("disabled")).toBeNull();
  });

  it("never leaks raw transport internals into user-visible copy", () => {
    const literals = (...groups: readonly Record<string, unknown>[]): string[] =>
      groups.flatMap((group) => Object.values(group).filter((v): v is string => typeof v === "string"));
    const everyString = [
      ...literals(CONNECTION_COPY, REMOTE_UPDATE_COPY, CONFLICT_COPY, DELETION_COPY, PUBLISH_COPY, STRUCTURAL_COPY),
      // Compose the templated strings too: the parts must be safe in context.
      DELETION_COPY.body("Alice"),
      STRUCTURAL_COPY.movedTo("Module 2"),
      PRESENCE_COPY.editingThisQuestion("Alice"),
      PRESENCE_COPY.updatedBy("Alice"),
      PRESENCE_COPY.overflow(3),
      fieldFateLine("conflict", "Alice"),
      connectionCopyFor("reconnecting") ?? "",
      saveStatusCopy({ status: "conflict", diverged: false }),
      saveStatusCopy({ status: "offline", diverged: false }),
      saveStatusCopy({ status: "saved", diverged: true }),
      // The fenced/diverged family is reachable with the socket OFF, so its
      // strings must be self-contained rather than leaning on transport context.
      ...literals(SAVE_CONFLICT_COPY),
      saveBlockedCopy(false),
      saveBlockedCopy(true),
    ];
    for (const text of everyString) {
      expect(typeof text, text).toBe("string");
    }
    for (const text of everyString) {
      expect(copyLeaksTransportDetail(text)).toBe(false);
    }
    expect(FORBIDDEN_COPY_FRAGMENTS).toContain("1006");
    expect(copyLeaksTransportDetail("closed with 1006")).toBe(true);
  });
});

describe("collaboration source gates (NOT-YET list)", () => {
  const dir = path.resolve(__dirname, "..");
  const sources = readdirSync(dir)
    .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
    .map((file) => ({ file, text: readFileSync(path.join(dir, file), "utf8") }));

  it("has source files to check", () => {
    expect(sources.length).toBeGreaterThan(3);
  });

  it("never uses alert-caps wording or a live-cursor/typing-indicator affordance", () => {
    for (const { file, text } of sources) {
      // Editing presence is informational, so the alarm vocabulary (matched
      // case-insensitively, as the plan's grep gate does) is banned outright.
      expect(text, file).not.toMatch(/warning/i);
      expect(text, file).not.toMatch(/live[-\s]?cursor|remote[-\s]?caret/);
      expect(text, file).not.toMatch(/typing[-\s]?indicator/);
      expect(text, file).not.toMatch(/acquirelock|\.lock\(/);
      expect(text, file).not.toMatch(/continue\s+anyway/);
    }
  });

  it("never imports or renders a toast, a blocking confirm, or an auto-merge writer", () => {
    for (const { file, text } of sources) {
      // The NOT-YET rule bans a save-notification component and an auto-merge
      // WRITE, not the words themselves in prose — so this asserts on the
      // mechanisms (imports, JSX, calls) rather than with a naive word search.
      expect(text, file).not.toMatch(/from\s+["'][^"']*toast/i);
      expect(text, file).not.toMatch(/<Toast|\btoast\(|useToast/);
      expect(text, file).not.toMatch(/window\.confirm/);
      expect(text, file).not.toMatch(/autoMerge|writeMerged|applyMerged/);
    }
  });
});
