import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SatSessionControls } from "../SatSessionControls";
import { SatSessionRoomConfirmDialog } from "../SatSessionRoomConfirmDialog";

const noop = () => undefined;

function controls(runtimeStatus: string, evaOpen: boolean, onComplete = vi.fn()) {
  render(
    <SatSessionControls
      runtimeStatus={runtimeStatus}
      pendingActions={new Set()}
      blocked={false}
      onPause={noop}
      onResume={noop}
      onExtend={noop}
      onComplete={onComplete}
      evaOpen={evaOpen}
    />
  );
  return onComplete;
}

describe("End exam while Eva SIM is open", () => {
  it("keeps End exam on an automatically completed room, without Pause or Extend", () => {
    const onComplete = controls("completed", true);
    fireEvent.click(screen.getByRole("button", { name: "End exam" }));
    expect(onComplete).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Pause exam/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /More/ })).not.toBeInTheDocument();
  });

  it("offers no End exam on a completed room once Eva is closed", () => {
    controls("completed", false);
    expect(screen.queryByRole("button", { name: "End exam" })).not.toBeInTheDocument();
  });

  it.each([
    ["native", false, "closes Eva SIM. Students can no longer submit or edit Eva SIM. Recorded responses remain available."],
    ["embed", false, "closes Eva SIM access here. External tabs or previously opened links may still accept responses."],
    ["native", true, "The exam is already completed. Ending it now closes Eva SIM"],
  ] as const)("names what closes (%s, completed=%s)", (evaMode, runtimeCompleted, copy) => {
    render(
      <SatSessionRoomConfirmDialog confirm={{ kind: "complete", evaMode, runtimeCompleted }} onCancel={noop} onConfirm={noop} />
    );
    expect(screen.getByText(new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End exam" })).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
  });
});
