/** One record in the log. `hash` covers every other field except `mac`. */
export interface Entry {
  /** Position in the log, from 0. */
  seq: number;
  /** Milliseconds since the epoch. Never lower than the entry before. */
  ts: number;
  actor: string;
  kind: string;
  /** Plain JSON, after redaction. */
  data: unknown;
  /** The `hash` of the entry before, or GENESIS for the first entry. */
  prev: string;
  /** SHA-256 hex of the canonical JSON of the six fields above. */
  hash: string;
  /** HMAC-SHA-256 hex of `hash`. Needs the key. */
  mac: string;
}

/** Where a Log keeps its entries. */
export interface Store {
  count(): Promise<number>;
  last(): Promise<Entry | undefined>;
  all(): Promise<Entry[]>;
  /**
   * Add one entry at the end. The store must check, in one atomic step, that
   * `entry.seq` equals the count and `entry.prev` equals the last hash. It
   * throws ConflictError when not.
   */
  append(entry: Entry): Promise<void>;
}

export type VerifyReason =
  | "malformed"
  | "bad-sequence"
  | "bad-prev"
  | "bad-hash"
  | "bad-mac"
  | "bad-time"
  | "truncated"
  | "checkpoint-mismatch"
  | "bad-checkpoint";

export type VerifyResult =
  | { ok: true; count: number; head: string }
  /** `index` is the 0-based position of the first bad entry. */
  | { ok: false; index: number; reason: VerifyReason; message: string };
