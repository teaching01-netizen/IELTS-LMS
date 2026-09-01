import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  let providerKey: "sat" | "ielts" = "sat";
  return {
    getProviderKey: () => providerKey,
    setProviderKey: (next: "sat" | "ielts") => {
      providerKey = next;
    },
    loads: {
      config: 0,
      sat: 0,
    },
  };
});

vi.mock("../../api/examQueries", () => ({
  useExamQuery: () => ({
    isLoading: false,
    error: null,
    data: {
      id: "exam-1",
      title: "Digital SAT",
      providerKey: harness.getProviderKey(),
    },
  }),
}));

vi.mock("../../../builder/routes/ExamConfigRoute", () => {
  harness.loads.config += 1;
  return {
    ExamConfigRoute: () => <div>generic authoring</div>,
  };
});

vi.mock("../SatAuthoringRoute", () => {
  harness.loads.sat += 1;
  return {
    SatAuthoringRoute: () => <div>SAT authoring</div>,
  };
});

import { ProviderBuilderRoute } from "../ProviderBuilderRoute";

describe("ProviderBuilderRoute branch loading", () => {
  it("loads only the selected provider authoring branch", async () => {
    render(<ProviderBuilderRoute />);

    expect(await screen.findByText("SAT authoring")).toBeInTheDocument();
    expect(harness.loads.sat).toBe(1);
    expect(harness.loads.config).toBe(0);
  });
});
