import { open, readFile, stat, unlink } from "node:fs/promises";
import { GENESIS } from "./constants.js";
import { ConflictError, StoreError } from "./errors.js";
import { parseJsonl } from "./jsonl.js";
import type { Entry, Store } from "./types.js";

const CHUNK = 64 * 1024;
const STALE_LOCK_MS = 10_000;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** A JSONL file that only grows. A lock file next to it orders writers. */
export class FileStore implements Store {
  readonly #path: string;
  readonly #timeout: number;

  constructor(path: string, options: { lockTimeoutMs?: number } = {}) {
    this.#path = path;
    this.#timeout = options.lockTimeoutMs ?? 5_000;
  }

  async all(): Promise<Entry[]> {
    let text: string;
    try {
      text = await readFile(this.#path, "utf8");
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    if (text !== "" && !text.endsWith("\n")) throw new StoreError("The last line has no newline. A write was cut short.");
    const parsed = parseJsonl(text);
    if (!parsed.ok) throw new StoreError(parsed.message);
    return parsed.entries;
  }

  async count(): Promise<number> {
    const last = await this.last();
    return last ? last.seq + 1 : 0;
  }

  /** Reads the file from the end, so the cost does not grow with the log. */
  async last(): Promise<Entry | undefined> {
    let handle;
    try {
      handle = await open(this.#path, "r");
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
    try {
      const { size } = await handle.stat();
      if (size === 0) return undefined;
      const tail = Buffer.alloc(1);
      await handle.read(tail, 0, 1, size - 1);
      if (tail[0] !== 10) throw new StoreError("The last line has no newline. A write was cut short.");
      let start = size - 1;
      let bytes = Buffer.alloc(0);
      while (start > 0 && !bytes.includes(10)) {
        const n = Math.min(CHUNK, start);
        start -= n;
        const chunk = Buffer.alloc(n);
        await handle.read(chunk, 0, n, start);
        bytes = Buffer.concat([chunk, bytes]);
      }
      const line = bytes.subarray(bytes.lastIndexOf(10) + 1).toString("utf8");
      try {
        return JSON.parse(line) as Entry;
      } catch {
        throw new StoreError("The last line is not valid JSON.");
      }
    } finally {
      await handle.close();
    }
  }

  async append(entry: Entry): Promise<void> {
    await this.#lock();
    try {
      const last = await this.last();
      if (entry.seq !== (last ? last.seq + 1 : 0) || entry.prev !== (last?.hash ?? GENESIS)) {
        throw new ConflictError(`Entry ${entry.seq} does not fit the file.`);
      }
      const handle = await open(this.#path, "a", 0o600);
      try {
        await handle.write(`${JSON.stringify(entry)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } finally {
      await unlink(`${this.#path}.lock`).catch(() => {});
    }
  }

  async #lock(): Promise<void> {
    const lock = `${this.#path}.lock`;
    const deadline = Date.now() + this.#timeout;
    for (;;) {
      try {
        await (await open(lock, "wx", 0o600)).close();
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const age = await stat(lock).then((s) => Date.now() - s.mtimeMs, () => 0);
      if (age > STALE_LOCK_MS) await unlink(lock).catch(() => {});
      else if (Date.now() > deadline) throw new StoreError(`The lock file ${lock} stays. Remove it if no process uses the log.`);
      else await sleep(5 + Math.random() * 20);
    }
  }
}
