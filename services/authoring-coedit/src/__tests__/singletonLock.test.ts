import { afterEach, describe, expect, it, vi } from "vitest";
import { SingletonLock } from "../singletonLock.js";

const createConnection = vi.hoisted(() => vi.fn());
vi.mock("mysql2/promise", () => ({ default: { createConnection } }));

function connection(id: number) {
  return {
    query: vi.fn(async (sql: string): Promise<[Record<string, number | null>[], never[]]> => [
      [sql.includes("GET_LOCK") ? { acquired: 1 } : { owner: id, self: id }],
      [],
    ]),
    on: vi.fn(),
    end: vi.fn(async () => {}),
    destroy: vi.fn(),
  };
}
const options = {
  dsn: "mysql://unused",
  lockName: "test",
  lockTimeoutSeconds: 1,
  confirmIntervalMs: 10,
};
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("singleton lock parking", () => {
  it("closes the session, stops confirmations and safely acquires a fresh lock", async () => {
    vi.useFakeTimers();
    const first = connection(1),
      second = connection(2);
    createConnection.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const lock = new SingletonLock(options);
    lock.onLost = vi.fn();
    await lock.acquire();
    await vi.advanceTimersByTimeAsync(10);
    await lock.release();
    const queries = first.query.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(first.query).toHaveBeenCalledTimes(queries);
    expect(first.end).toHaveBeenCalledOnce();
    expect(lock.isReady()).toBe(false);
    await lock.acquire();
    const oldErrorHandler = first.on.mock.calls[0]?.[1] as (error: Error) => void;
    oldErrorHandler(new Error("old parked socket closed"));
    expect(lock.onLost).not.toHaveBeenCalled();
    expect(lock.isReady()).toBe(true);
    await lock.release();
  });

  it("ignores a last confirmation that finishes after release", async () => {
    const conn = connection(1);
    createConnection.mockResolvedValueOnce(conn);
    const lock = new SingletonLock(options);
    lock.onLost = vi.fn();
    await lock.acquire();
    let finish!: (value: [Record<string, number | null>[], never[]]) => void;
    conn.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const confirmation = lock.confirmOwnership();
    await lock.release();
    finish([[{ owner: null, self: 1 }], []]);
    await confirmation;
    expect(lock.onLost).not.toHaveBeenCalled();
  });

  it("fails closed when a held lock belongs to another session", async () => {
    const conn = connection(1);
    createConnection.mockResolvedValueOnce(conn);
    const lock = new SingletonLock(options);
    lock.onLost = vi.fn();
    await lock.acquire();
    conn.query.mockResolvedValueOnce([[{ owner: 2, self: 1 }], []]);
    await lock.confirmOwnership();
    expect(lock.isReady()).toBe(false);
    expect(lock.onLost).toHaveBeenCalledOnce();
    await lock.release();
  });
});
