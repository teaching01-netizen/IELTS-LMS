import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { COEDIT_STALE_CACHE_MESSAGE } from "../../../realtime/coedit/contracts";
import { CoeditRecoverySurface } from "../CoeditRecoverySurface";
import { COEDIT_RECOVERY_COPY, PUBLISH_COPY } from "../collaborationCopy";

describe("CoeditRecoverySurface", () => {
  it("offers the destructive action only when there is a local copy to discard", () => {
    const { rerender } = render(
      <CoeditRecoverySurface body={COEDIT_RECOVERY_COPY.closed} onCopyMyChanges={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: PUBLISH_COPY.discardLocalCopy })).toBeNull();

    rerender(
      <CoeditRecoverySurface
        body={COEDIT_RECOVERY_COPY.stale_cache}
        onCopyMyChanges={() => {}}
        onDiscardLocalCopy={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: PUBLISH_COPY.discardLocalCopy })).toBeInTheDocument();
  });

  it("confirms before discarding a copy the room does not hold", () => {
    const onDiscardLocalCopy = vi.fn();
    render(
      <CoeditRecoverySurface
        body={COEDIT_RECOVERY_COPY.stale_cache}
        onCopyMyChanges={() => {}}
        onDiscardLocalCopy={onDiscardLocalCopy}
      />,
    );

    // The first click only asks: the copy exists because the server never
    // received it, so discarding it is the one irreversible action here.
    fireEvent.click(screen.getByRole("button", { name: PUBLISH_COPY.discardLocalCopy }));
    expect(onDiscardLocalCopy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: PUBLISH_COPY.confirmDiscardLocalCopy })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: PUBLISH_COPY.confirmDiscardLocalCopy }));
    expect(onDiscardLocalCopy).toHaveBeenCalledTimes(1);
  });

  it("describes a preserved copy without transport detail", () => {
    render(
      <CoeditRecoverySurface
        body={COEDIT_RECOVERY_COPY.stale_cache}
        onCopyMyChanges={() => {}}
        onDiscardLocalCopy={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(COEDIT_STALE_CACHE_MESSAGE);
    expect(COEDIT_RECOVERY_COPY.stale_cache).not.toMatch(/stateEpoch|indexeddb|409|1006/i);
  });
});
