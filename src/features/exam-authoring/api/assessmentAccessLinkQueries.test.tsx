import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import type { AccessDistributionOverview, AssessmentAccessLink } from "../contracts/accessLinks";
import { accessLinkKeys } from "./accessLinkKeys";

const create = vi.hoisted(() => vi.fn());
vi.mock("./assessmentAccessLinksApi", () => ({ assessmentAccessLinksApi: { create } }));

import { useCreateAccessLink } from "./assessmentAccessLinkQueries";

it("adds a confirmed new group to the overview before the server refresh finishes", async () => {
  const client = new QueryClient();
  const link = { id: "new-link", examId: "exam-1", publishedVersionId: "v-3" } as AssessmentAccessLink;
  const overview = { currentPublishedVersion: { id: "v-3" }, links: [] } as unknown as AccessDistributionOverview;
  client.setQueryData(accessLinkKeys.overview("exam-1"), overview);
  create.mockResolvedValue(link);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useCreateAccessLink("exam-1"), { wrapper });

  await act(async () => { await result.current.mutateAsync({ name: "Morning class", audienceType: "anyone", accessMode: "student_code", availabilityType: "anytime", selectedStudents: [] }); });

  expect(client.getQueryData<AccessDistributionOverview>(accessLinkKeys.overview("exam-1"))?.links).toEqual([link]);
  expect(client.getQueryData(accessLinkKeys.link(link.id))).toEqual(link);
  client.clear();
});
