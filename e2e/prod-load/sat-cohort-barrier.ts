export interface SatCohortBarrierResult {
  ready: boolean;
  arrivals: number;
  expected: number;
  reason?: string;
}

/** Releases a SAT browser cohort after every requested participant reaches a phase. */
export class SatCohortBarrier {
  private readonly participants = new Set<number>();
  private readonly result: Promise<SatCohortBarrierResult>;
  private resolveResult!: (result: SatCohortBarrierResult) => void;
  private readonly timeoutMs: number;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private settled = false;
  private successful = false;

  constructor(
    readonly expected: number,
    timeoutMs: number,
    private readonly arrivalLabel = "students exam-ready",
  ) {
    if (!Number.isInteger(expected) || expected < 1) {
      throw new Error("SAT cohort barrier expected count must be a positive integer.");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
      throw new Error("SAT cohort barrier timeout must be positive.");
    }
    this.timeoutMs = Math.trunc(timeoutMs);
    this.result = new Promise((resolve) => {
      this.resolveResult = resolve;
    });
  }

  get arrivals(): number {
    return this.participants.size;
  }

  get isSettled(): boolean {
    return this.settled;
  }

  get passed(): boolean {
    return this.settled && this.successful;
  }

  arrive(participant: number): Promise<SatCohortBarrierResult> {
    if (!Number.isInteger(participant) || participant < 0 || participant >= this.expected) {
      this.fail("A participant ID was outside the requested cohort.");
      return this.result;
    }
    if (!this.settled) {
      this.participants.add(participant);
      if (this.participants.size === 1) this.startTimeout();
      if (this.participants.size === this.expected) {
        this.settle({ ready: true, arrivals: this.participants.size, expected: this.expected });
      }
    }
    return this.result;
  }

  fail(reason: string): void {
    if (this.settled) return;
    this.settle({
      ready: false,
      arrivals: this.participants.size,
      expected: this.expected,
      reason,
    });
  }

  dispose(): void {
    if (this.timeout !== undefined) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
  }

  private settle(result: SatCohortBarrierResult): void {
    if (this.settled) return;
    this.settled = true;
    this.successful = result.ready;
    this.dispose();
    this.resolveResult(result);
  }

  private startTimeout(): void {
    if (this.timeout !== undefined || this.settled) return;
    this.timeout = setTimeout(() => {
      this.fail(`Timed out with ${this.participants.size}/${this.expected} ${this.arrivalLabel}.`);
    }, this.timeoutMs);
  }
}
