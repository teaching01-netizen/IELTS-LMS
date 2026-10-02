import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../apiClient";
import { shouldRetryQuery } from "../queryClient";
import { connectionRecovery } from "../connectionRecovery";

function response(status: number) {
  return new Response(JSON.stringify({ ok: true }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("bounded cold-start recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    connectionRecovery.finish("test", "", false);
  });

  it("recovers reads from gateway failures with at most three retries", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(502))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(504))
      .mockResolvedValueOnce(response(200));
    vi.stubGlobal("fetch", fetch);
    const request = apiClient.get("/cold-read");
    await vi.advanceTimersByTimeAsync(0);
    expect(connectionRecovery.getSnapshot()).toBe("connecting");
    await vi.advanceTimersByTimeAsync(7_000);
    await expect(request).resolves.toMatchObject({ success: true });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(connectionRecovery.getSnapshot()).toBe("connected");
  });

  it("marks exhaustion so React Query cannot start another sequence", async () => {
    const fetch = vi.fn().mockResolvedValue(response(503));
    vi.stubGlobal("fetch", fetch);
    const failure = apiClient
      .get("/cold-exhausted", { retries: 50 })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(7_000);
    const error = await failure;
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(error).toMatchObject({ transportRetryHandled: true, requestMethod: "GET" });
    expect(shouldRetryQuery(0, error)).toBe(false);
    expect(connectionRecovery.getSnapshot()).toBe("unavailable");
  });

  it("cancels during backoff without another fetch", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("network"));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const failure = apiClient
      .get("/cold-cancel", { signal: controller.signal })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await failure).toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(connectionRecovery.getSnapshot()).toBe("connected");
  });

  it("bounds hanging attempts and backoff together to sixty seconds", async () => {
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("timeout", "AbortError"))
          );
        })
    );
    vi.stubGlobal("fetch", fetch);
    const started = Date.now();
    const failure = apiClient.get("/cold-timeout").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await failure).toMatchObject({ status: 0, transportRetryHandled: true });
    expect(Date.now() - started).toBe(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not repeat an ambiguous write, even when retries are requested", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("response lost after commit"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      apiClient.post("/cold-write", { value: "answer" }, { retries: 3 })
    ).rejects.toMatchObject({ status: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reuses the exact operation body only when a write is explicitly retry safe", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(502)).mockResolvedValueOnce(response(200));
    vi.stubGlobal("fetch", fetch);
    const body = { operationId: "stable-operation", value: "answer" };
    const request = apiClient.post("/idempotent-write", body, { retrySafe: true });
    body.operationId = "changed-after-dispatch";
    await vi.advanceTimersByTimeAsync(1_000);
    await request;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map((call) => (call[1] as RequestInit).body)).toEqual([
      '{"operationId":"stable-operation","value":"answer"}',
      '{"operationId":"stable-operation","value":"answer"}',
    ]);
  });
});
