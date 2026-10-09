import { canonicalize } from "./canonical.js";
import { CHECKPOINT_DOMAIN, ENTRY_DOMAIN, GENESIS } from "./constants.js";
import { hmacHex, sha256Hex } from "./crypto.js";
import { ConflictError, EntryTooLargeError, InvalidEntryError } from "./errors.js";
import { resolveKey, type Key } from "./keys.js";
import type { Checkpoint, Entry, Store, VerifyResult } from "./types.js";
import { verify } from "./verify.js";

const MAX_RETRIES = 100;
const encoder = new TextEncoder();

export interface LogOptions {
  store: Store;
  key: Key;
  /** The clock in milliseconds. Default: Date.now. */
  now?: () => number;
  /** The largest entry in bytes of canonical JSON. Default: 1 MiB. */
  maxEntryBytes?: number;
}

export interface NewEntry {
  actor: string;
  kind: string;
  data?: unknown;
}

export class Log {
  readonly #store: Store;
  readonly #key: Promise<CryptoKey>;
  readonly #now: () => number;
  readonly #max: number;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: LogOptions) {
    this.#store = options.store;
    this.#now = options.now ?? Date.now;
    this.#max = options.maxEntryBytes ?? 1_048_576;
    this.#key = resolveKey(options.key);
    this.#key.catch(() => {});
  }

  /** Add one entry. Calls run one at a time, in call order. */
  append(input: NewEntry): Promise<Entry> {
    const run = this.#queue.then(() => this.#append(input));
    this.#queue = run.catch(() => {});
    return run;
  }

  async #append(input: NewEntry): Promise<Entry> {
    if (typeof input.actor !== "string" || input.actor === "") throw new InvalidEntryError("The actor must be a non-empty string.");
    if (typeof input.kind !== "string" || input.kind === "") throw new InvalidEntryError("The kind must be a non-empty string.");
    const data = structuredClone(input.data ?? null);
    const key = await this.#key;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const last = await this.#store.last();
      const body = {
        seq: last ? last.seq + 1 : 0,
        ts: Math.max(Math.trunc(this.#now()), last?.ts ?? 0),
        actor: input.actor,
        kind: input.kind,
        data,
        prev: last?.hash ?? GENESIS,
      };
      const text = canonicalize(body);
      const size = encoder.encode(text).length;
      if (size > this.#max) throw new EntryTooLargeError(`The entry has ${size} bytes. The limit is ${this.#max}.`);
      const hash = await sha256Hex(text);
      const entry: Entry = { ...body, hash, mac: await hmacHex(key, ENTRY_DOMAIN + hash) };
      try {
        await this.#store.append(entry);
        return entry;
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
      }
    }
    throw new ConflictError(`The log kept changing. Gave up after ${MAX_RETRIES} tries.`);
  }

  entries(): Promise<Entry[]> {
    return this.#store.all();
  }

  /** Sign the head of the log. Store the result somewhere else to detect a cut tail. */
  async checkpoint(): Promise<Checkpoint> {
    const last = await this.#store.last();
    const body = { count: last ? last.seq + 1 : 0, head: last?.hash ?? GENESIS, ts: Math.trunc(this.#now()) };
    return { ...body, mac: await hmacHex(await this.#key, CHECKPOINT_DOMAIN + canonicalize(body)) };
  }

  async verify(options: { checkpoint?: Checkpoint } = {}): Promise<VerifyResult> {
    return verify(await this.#store.all(), { key: await this.#key, ...options });
  }
}
