export interface StudentDraftBuffer {
  commit(): void | Promise<void>;
  flushDurability(): Promise<void>;
}

export interface DraftCommitPort {
  commitAll(): Promise<void>;
  flushDurability(): Promise<void>;
}
