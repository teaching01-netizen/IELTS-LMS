import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LinksToolbar } from "../LinksToolbar";

const counts = { live: 1, upcoming: 1, ended: 0, paused: 0, revoked: 0 };

describe("LinksToolbar", () => {
  it("announces the result count and toggles the status filter", () => {
    const onStatusFilterChange = vi.fn();
    render(
      <LinksToolbar
        search=""
        onSearchChange={vi.fn()}
        statusFilter="all"
        onStatusFilterChange={onStatusFilterChange}
        counts={counts}
        total={2}
        resultCount={2}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2 links");
    fireEvent.click(screen.getByRole("button", { name: /Live 1/ }));
    expect(onStatusFilterChange).toHaveBeenCalledWith("live");
  });

  it("supports Escape-to-clear search", () => {
    const onSearchChange = vi.fn();
    render(
      <LinksToolbar
        search="Monday"
        onSearchChange={onSearchChange}
        statusFilter="all"
        onStatusFilterChange={vi.fn()}
        counts={counts}
        total={2}
        resultCount={1}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("Search Student Links"), { key: "Escape" });
    expect(onSearchChange).toHaveBeenCalledWith("");
  });
});
