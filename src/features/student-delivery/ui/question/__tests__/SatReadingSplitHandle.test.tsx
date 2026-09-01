import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SAT_READING_SPLIT_MAX,
  SAT_READING_SPLIT_MIN,
} from "../../../domain/satReadingPreferences";
import { SatReadingSplitHandle } from "../SatReadingSplitHandle";

describe("SatReadingSplitHandle", () => {
  it("moves to the minimum passage width with Home", () => {
    const onChange = vi.fn();

    render(
      <SatReadingSplitHandle
        containerRef={{ current: null }}
        ratio={0.5}
        onChange={onChange}
      />
    );

    fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });

    expect(onChange).toHaveBeenCalledWith(SAT_READING_SPLIT_MIN);
  });

  it("moves to the maximum passage width with End", () => {
    const onChange = vi.fn();

    render(
      <SatReadingSplitHandle
        containerRef={{ current: null }}
        ratio={0.5}
        onChange={onChange}
      />
    );

    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });

    expect(onChange).toHaveBeenCalledWith(SAT_READING_SPLIT_MAX);
  });
});
