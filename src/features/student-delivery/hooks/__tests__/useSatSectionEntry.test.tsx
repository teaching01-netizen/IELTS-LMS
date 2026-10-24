import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SectionEntryState } from "@/src/features/assessment-forms/api/assessmentForms";
import { useSatSectionEntry } from "../useSatSectionEntry";
const form = (state: SectionEntryState["state"]): SectionEntryState => ({
  state,
  versionId: "v",
  sectionKey: "math",
  formKey: "math_entry",
  moduleId: "m",
  canSubmit: state === "required",
  canStart: state === "submitted",
});

describe("SAT section entry gate", () => {
  it.each(["required", "waiting", "closed"] as const)(
    "holds module entry while %s",
    async (state) => {
      const read = vi.fn().mockResolvedValue(form(state));
      const { result } = renderHook(() => useSatSectionEntry("s", "a", "m", "math", read));
      expect(result.current.ready).toBe(false);
      await waitFor(() => expect(result.current.state?.state).toBe(state));
      expect(result.current.ready).toBe(false);
    }
  );
  it("opens only after accepted submission is read back", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(form("required"))
      .mockResolvedValue(form("submitted"));
    const { result } = renderHook(() => useSatSectionEntry("s", "a", "m", "math", read));
    await waitFor(() => expect(result.current.state?.state).toBe("required"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.ready).toBe(true);
  });
  it("holds entry after a read failure and recovers explicitly", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue(form("not_applicable"));
    const { result } = renderHook(() => useSatSectionEntry("s", "a", "m", "math", read));
    await waitFor(() => expect(result.current.error).toBe("Offline"));
    expect(result.current.ready).toBe(false);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.ready).toBe(true);
  });
  it("discards a delayed result for the previous attempt", async () => {
    let finish!: (state: SectionEntryState) => void;
    const read = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<SectionEntryState>((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue(form("required"));
    const { result, rerender } = renderHook(
      ({ attempt }) => useSatSectionEntry("s", attempt, "m", "math", read),
      { initialProps: { attempt: "old" } }
    );
    rerender({ attempt: "new" });
    await waitFor(() => expect(result.current.state?.state).toBe("required"));
    await act(async () => {
      finish(form("submitted"));
    });
    expect(result.current.ready).toBe(false);
    expect(result.current.state?.state).toBe("required");
  });
});
