import { ConflictError } from "./errors.js";
import { GENESIS } from "./constants.js";
import type { Entry, Store } from "./types.js";

/** A store in memory. It copies entries in and out, so callers cannot change them. */
export class MemoryStore implements Store {
  readonly #entries: Entry[];

  constructor(entries: Entry[] = []) {
    this.#entries = structuredClone(entries);
  }

  async count(): Promise<number> {
    return this.#entries.length;
  }

  async last(): Promise<Entry | undefined> {
    const entry = this.#entries.at(-1);
    return entry && structuredClone(entry);
  }

  async all(): Promise<Entry[]> {
    return structuredClone(this.#entries);
  }

  async append(entry: Entry): Promise<void> {
    const prev = this.#entries.at(-1)?.hash ?? GENESIS;
    if (entry.seq !== this.#entries.length || entry.prev !== prev) {
      throw new ConflictError(`The log has ${this.#entries.length} entries. Entry ${entry.seq} does not fit.`);
    }
    this.#entries.push(structuredClone(entry));
  }
}
